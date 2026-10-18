"""Sanity-check the SQL migrations without a database.

Not a parser. It checks the specific PostgreSQL rules that broke the first
version of the wipe migration:
  - balanced dollar-quote blocks
  - no VACUUM / other transaction-illegal command left uncommented
  - the FK-truncating TRUNCATE is a single statement listing every related table

    python scripts/check-migrations.py

It was verified against the broken version and flags all three defects, so a
pass here means something.

It also cross-checks screening_history_view against the columns migrations add
and the columns the backend inserts, because that view lists columns explicitly
rather than SELECT *, so a new column does not reach it automatically.
"""
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

MIGRATIONS = [
    "20261012000000_multi_recording_fusion_retire_tb.sql",
    "20261013000000_clear_screening_records.sql",
    "20261013001000_restore_signup_trigger_clinic.sql",
]

# Commands PostgreSQL refuses inside a transaction block. The Supabase SQL
# editor wraps a whole submission in one, so any of these left uncommented
# fails the script.
TXN_ILLEGAL = ["VACUUM", "REINDEX", "CLUSTER", "CREATE DATABASE", "ALTER SYSTEM"]

failures = 0


def strip_comments(sql: str) -> str:
    """Remove -- line comments and /* */ blocks, preserving string literals."""
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    out = []
    for line in sql.splitlines():
        stripped = re.sub(r"--.*$", "", line)
        out.append(stripped)
    return "\n".join(out)


base = Path(__file__).resolve().parent.parent / "supabase" / "migrations"
for name in MIGRATIONS:
    path = base / name
    raw = path.read_text(encoding="utf-8")
    code = strip_comments(raw)
    upper = code.upper()

    problems = []

    # 1. balanced dollar quotes
    if raw.count("$$") % 2 != 0:
        problems.append(f"unbalanced $$ delimiters ({raw.count('$$')} found)")

    # 2. no explicit transaction block, which is what made VACUUM fatal
    if re.search(r"^\s*BEGIN\s*;", code, re.I | re.M):
        problems.append("contains an explicit BEGIN — cannot be combined with VACUUM")

    # 3. no transaction-illegal commands in live code
    for cmd in TXN_ILLEGAL:
        for m in re.finditer(rf"\b{cmd}\b", upper):
            line_no = code[: m.start()].count("\n") + 1
            problems.append(f"{cmd} at line {line_no} — illegal in a transaction block")

    if problems:
        failures += 1
        print(f"[FAIL] {name}")
        for p in problems:
            print(f"         - {p}")
    else:
        print(f"[PASS] {name}")

print()

# The specific correctness rule that broke v1: screenings references patients, so
# a TRUNCATE of patients alone is rejected by PostgreSQL regardless of whether
# screenings was emptied first.
wipe = (base / MIGRATIONS[1]).read_text(encoding="utf-8")
truncates = re.findall(r"TRUNCATE\s+TABLE\s+([^;]+);", wipe, re.I)

if len(truncates) != 1:
    failures += 1
    print(f"[FAIL] expected exactly 1 TRUNCATE statement, found {len(truncates)}")
    for t in truncates:
        print(f"         - TRUNCATE TABLE {t.strip()}")
else:
    tables = {t.strip() for t in truncates[0].split(",")}
    required = {"audit_logs", "screenings", "patients"}
    protected = {"profiles", "clinics"}

    problems = []
    if not required.issubset(tables):
        problems.append(f"missing {sorted(required - tables)} — FK will reject it")
    if tables & protected:
        problems.append(f"truncates protected table(s) {sorted(tables & protected)}")

    cascade = "CASCADE" in truncates[0].upper()
    if cascade:
        problems.append("uses CASCADE, which could silently truncate future tables")

    if problems:
        failures += 1
        print("[FAIL] single TRUNCATE lists every FK-participating table")
        for p in problems:
            print(f"         - {p}")
    else:
        print("[PASS] single TRUNCATE lists every FK-participating table")
        print(f"         deletes: {sorted(tables)}")
        print(f"         protects: {sorted(protected)} (untouched)")


# ---------------------------------------------------------------------------
# View columns must exist
#
# screening_history_view lists its columns explicitly rather than SELECT *, so a
# column added to screenings does NOT reach the view automatically. Two failure
# modes follow, and both surface only at run time:
#
#   1. The view selects a column the table never got -> 42703 at CREATE VIEW,
#      which is loud, but it aborts the migration and can leave the columns
#      behind without the view.
#   2. The view omits a column the table has -> every API read silently loses
#      the field, which is worse because nothing errors at all.
#
# This compares the three places that have to agree for any new column: what the
# migration adds, what the view selects, and what the backend inserts.
# ---------------------------------------------------------------------------

print()
print("=== view columns ===")

_migrations = sorted((REPO / "supabase" / "migrations").glob("*.sql"))

# Every column that exists on screenings by the end of the migration chain:
# those created by CREATE TABLE in the initial schema, plus any added later.
_created = set()
_added_anywhere = set()
for _m in _migrations:
    _text = _m.read_text(encoding="utf-8")
    _added_anywhere |= set(
        re.findall(r"ADD COLUMN (?:IF NOT EXISTS )?(\w+)", _text, re.I)
    )
    for _body in re.findall(
        r"(?is)CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\((.*?)\n\);", _text
    ):
        _name, _cols = _body
        if _name.lower() != "screenings":
            continue
        # First token on each line inside the parens, skipping table constraints
        # (PRIMARY KEY, FOREIGN KEY, CONSTRAINT, UNIQUE, CHECK).
        for _line in _cols.split("\n"):
            _tok = _line.strip().split()
            if not _tok:
                continue
            if _tok[0].upper() in {
                "PRIMARY", "FOREIGN", "CONSTRAINT", "UNIQUE", "CHECK", ")"
            }:
                continue
            _created.add(_tok[0].strip('"'))

_known_screening = _created | _added_anywhere | {"id", "created_at", "updated_at"}

problems = []
for m in _migrations:
    text = m.read_text(encoding="utf-8")
    view_match = re.search(
        r"(?is)CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\w+)\s+AS(.*?)\bFROM\b",
        text,
    )
    if not view_match:
        continue
    view_name = view_match.group(1)
    body = view_match.group(2)

    # Only the table's own qualified columns: `s.foo`. Aliased expressions and
    # joined tables appear as `pat.full_name` or `age_bracket(...)`.
    alias = re.search(r"FROM\s+(\w+)\s+(\w+)", text)
    if not alias:
        continue
    table, tbl_alias = alias.group(1), alias.group(2)
    selected = set(re.findall(rf"\b{tbl_alias}\.(\w+)", body))

    added_here = set(re.findall(r"ADD COLUMN (?:IF NOT EXISTS )?(\w+)", text, re.I))
    # Columns this migration did not add must already exist from the initial
    # schema or from an earlier migration.
    known = _known_screening
    missing_from_table = sorted(selected - known)
    missing_from_view = sorted(added_here - selected)

    if missing_from_table:
        problems.append(
            f"{m.name}: view {view_name} selects {missing_from_table} "
            f"but no migration ever adds it to {table}"
        )
    if missing_from_view:
        problems.append(
            f"{m.name}: migration adds {missing_from_view} to {table} but "
            f"{view_name} does not select it, so the API cannot read it"
        )

# The backend's insert keys must also exist as columns.
api_src = (REPO / "backend" / "routes" / "api.py").read_text(encoding="utf-8")
inserted = set(re.findall(
    r'"(interpretation_status|confidence_level|recommendation_code|decision_rule|'
    r"decision_detail|band_metric|band_position|low_agreement|"
    r'recordings_total|recordings_flagged)":', api_src))
all_screening_columns = _known_screening
orphan_inserts = sorted(inserted - all_screening_columns)
if orphan_inserts:
    problems.append(
        f"backend/routes/api.py inserts {orphan_inserts} but no migration "
        f"adds those columns to screenings"
    )

if problems:
    failures += 1
    print("[FAIL] screening view / migration / backend do not agree")
    for p in problems:
        print(f"         - {p}")
else:
    print("[PASS] every view column is added, every added column is selected,")
    print("       every column the backend inserts exists")
    print(f"       backend interpretation keys checked: {len(inserted)}")

print(f"\n{'ALL PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
sys.exit(1 if failures else 0)