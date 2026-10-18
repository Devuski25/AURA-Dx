"""Trace what actually pulls the form stack (zod + react-hook-form) into the
entry bundle.

Run from the repo root:  python scripts/entry_graph.py

Used during the performance audit to explain why `forms-*.js` was modulepreloaded
from index.html -- i.e. fetched by the Login page, which never touches
react-hook-form. A static walk, deliberately NOT following dynamic import(),
because lazy() routes are not part of the entry graph no matter how they are
written. An earlier version of this analysis followed them and produced a false
path through Screening.tsx.

Answer as of this writing: the form stack is NOT in the static entry graph, and
no eager module mentions zod / react-hook-form / @hookform by any import style.
The preload is therefore an artefact of `manualChunks` naming a chunk "forms",
not a real dependency -- rolldown treats that chunk as shared and pulls it in.
Left alone rather than fought: it is ~29 KB gzipped and a refactor risks the
route loading that currently works.
"""

import collections
import os
import re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(REPO, "frontend-new")
SRC = os.path.join(FRONTEND, "src")


def resolve(spec: str, frm: str) -> str | None:
    if spec.startswith("@/"):
        p = os.path.join(SRC, spec[2:])
    elif spec.startswith("."):
        p = os.path.normpath(os.path.join(os.path.dirname(frm), spec))
    else:
        return None
    for c in (p, p + ".ts", p + ".tsx", os.path.join(p, "index.ts"), os.path.join(p, "index.tsx")):
        if os.path.isfile(c):
            return c
    return None


def read(f: str) -> str:
    # errors="replace" rather than a hard failure: the walker only needs import
    # lines, and one file with a stray byte (some shadcn components carry one in
    # a comment) must not abort the whole traversal.
    try:
        return open(f, encoding="utf-8", errors="replace").read()
    except OSError:
        return ""


def static_imports(f: str) -> list[str]:
    """Only `from "..."` / `import "..."`. Dynamic import() is excluded."""
    t = read(f)
    out = []
    for m in re.finditer(r'from\s+["\']([^"\']+)["\']', t):
        r = resolve(m.group(1), f)
        if r:
            out.append(r)
    return out


def dynamic_imports(f: str) -> list[str]:
    t = read(f)
    out = []
    for m in re.finditer(r'import\(\s*["\']([^"\']+)["\']', t):
        r = resolve(m.group(1), f)
        if r:
            out.append(r)
    return out


def walk(entry: str) -> tuple[set[str], dict[str, str | None]]:
    seen = {entry}
    queue = collections.deque([entry])
    parent: dict[str, str | None] = {entry: None}
    while queue:
        cur = queue.popleft()
        for nxt in static_imports(cur):
            if nxt in seen:
                continue
            seen.add(nxt)
            parent[nxt] = cur
            queue.append(nxt)
    return seen, parent


def path_to(target: str, parent: dict[str, str | None]) -> list[str]:
    path, cur = [], target
    while cur:
        path.append(cur)
        cur = parent[cur]
    return list(reversed(path))


def main() -> None:
    entry = os.path.join(FRONTEND, "src", "App.tsx")
    seen, parent = walk(entry)

    def rel(p: str) -> str:
        return os.path.relpath(p, REPO).replace("\\", "/")

    heavy = {
        "zod / react-hook-form": ("react-hook-form", "@hookform", "zod"),
    }
    print(f"static entry graph: {len(seen)} modules\n")

    for label, markers in heavy.items():
        hits = sorted(f for f in seen if any(m in f for m in markers) or "ui/form.tsx" in f)
        if not hits:
            print(f"{label}: NOT in the static entry graph")
        else:
            print(f"{label}: REACHED")
            for h in hits:
                for i, step in enumerate(path_to(h, parent)):
                    print(f"  {'  ' * i}{i}. {rel(step)}")
                print()

    # A module can reach the form stack without naming it -- an import that
    # resolves through a barrel, or a side-effect import this walker does not
    # follow. So also scan every eager module's own text for the markers, which
    # catches the case the graph walk misses.
    print("eager modules mentioning a form-stack marker (any import style):")
    any_hit = False
    for f in sorted(seen):
        t = read(f)
        found = [m for m in ("react-hook-form", "@hookform", "zod") if m in t]
        if found:
            any_hit = True
            print(f"  {rel(f)}  -> {', '.join(found)}")
    if not any_hit:
        print("  none")

    print("\nlazy-loaded routes (not in the entry graph):")
    for r in sorted(dynamic_imports(entry)):
        print(f"  {rel(r)}")


if __name__ == "__main__":
    main()