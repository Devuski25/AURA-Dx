"""Find every place a PostgREST result is read as if it were a single row.

`.single()` returns a dict. `.limit(1)` returns a list of one row. The two
look the same at the call site and nothing warns you when they are confused,
so `**res.data` on a limit(1) query raises "argument after ** must be a
mapping, not list" and the endpoint 500s.

It stays hidden while the table is empty, because the empty case is guarded
with `if not res.data: raise 404` and the error is only reached once a row
exists. That is how a broken patient-record page survived a reset and a
refactor.

This walks the source with the ast module rather than grepping, because the
question is not "does this line mention .data" but "is this row guaranteed to
be a dict".
"""

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "backend"

# The PostgREST builder methods that make the response a single object
# rather than a list of rows.
SINGLE_METHODS = {"single", "maybeSingle"}


class Scan(ast.NodeVisitor):
    def __init__(self, path):
        self.path = path
        self.findings = []
        # var name -> True when the query used .single()
        self.query_is_single = {}
        # var name -> the line the query was assigned on
        self.query_line = {}

    # ------------------------------------------------------------------
    def visit_Assign(self, node):
        # `x = supabase.table(...).select(...).execute()`
        if isinstance(node.value, ast.Call) and self._is_execute(node.value):
            name = self._target_name(node.targets[0])
            chain = node.value.func
            single = False
            # The chain is `supabase.table(...).select(...).eq(...).single()
            # .execute()` -- so it alternates Attribute and Call as it is
            # unwound. Both have to be followed, or `.single()` is never seen.
            while True:
                if isinstance(chain, ast.Attribute):
                    if chain.attr in SINGLE_METHODS:
                        single = True
                    chain = chain.value
                elif isinstance(chain, ast.Call):
                    chain = chain.func
                else:
                    break
            if name:
                self.query_is_single[name] = single
                self.query_line[name] = node.lineno
        self.generic_visit(node)

    # ------------------------------------------------------------------
    def visit_Call(self, node):
        # `PatientResponse(**res.data)`
        if (
            isinstance(node.func, ast.Name)
            and node.func.id.endswith("Response")
            and node.keywords
        ):
            for kw in node.keywords:
                if kw.arg is None:  # **kwargs
                    self._check_splat(node, kw.value)
        self.generic_visit(node)

    # ------------------------------------------------------------------
    def visit_Attribute(self, node):
        # `res.data.get("x")` and `res.data["x"]` -- reading a row's field
        # straight off the response.
        if node.attr in ("get", "keys", "items", "values") and isinstance(node.value, ast.Attribute):
            if node.value.attr == "data" and isinstance(node.value.value, ast.Name):
                self._check_read(node, node.value.value.id, f".data.{node.attr}(...)")
        if isinstance(node.ctx, ast.Subscript) and isinstance(node.value, ast.Attribute):
            if node.value.attr == "data" and isinstance(node.value.value, ast.Name):
                self._check_read(node, node.value.value.id, ".data[...]")
        self.generic_visit(node)

    # ------------------------------------------------------------------
    def _check_read(self, node, var, how):
        if var in self.query_is_single and not self.query_is_single[var]:
            self.findings.append((node.lineno, var, self.query_line.get(var), how))

    # ------------------------------------------------------------------
    def _check_splat(self, node, value):
        # value is something like `res.data`
        if (
            isinstance(value, ast.Attribute)
            and value.attr == "data"
            and isinstance(value.value, ast.Name)
        ):
            var = value.value.id
            if var in self.query_is_single and not self.query_is_single[var]:
                self.findings.append(
                    (node.lineno, var, self.query_line.get(var), "**data")
                )

    # ------------------------------------------------------------------
    @staticmethod
    def _is_execute(node):
        return isinstance(node.func, ast.Attribute) and node.func.attr == "execute"

    @staticmethod
    def _target_name(target):
        if isinstance(target, ast.Name):
            return target.id
        return None

    # ------------------------------------------------------------------
    def run(self, tree):
        self.visit(tree)
        return self.findings


def main():
    files = sorted(ROOT.rglob("*.py"))
    files = [f for f in files if "venv" not in f.parts and "node_modules" not in f.parts]

    total = 0
    for path in files:
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError as e:
            print(f"  could not parse {path.name}: {e}")
            continue
        scan = Scan(path)
        findings = scan.run(tree)
        for lineno, var, qline, how in findings:
            total += 1
            print(f"  BUG  {path.relative_to(ROOT.parent)}:{lineno}")
            print(f"        {var!r} is the result of a .limit(1) query (line {qline}),")
            print(f"        so .data is a LIST of rows, not one row.")
            print(f"        Used as {how} -- use {var}.data[0]{how if how != '**data' else ''} instead.")

    print()
    if total:
        print(f"  FAIL: {total} place(s) read a list as a row")
        return 1
    print("  PASS: every response is built from a single row, not a list")
    return 0


sys.exit(main())
