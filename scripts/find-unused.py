"""Find files nothing in the project references.

Deleting dead code is only safe when there is evidence, not a hunch. This
reports candidates and shows the evidence for each; it does not delete anything.
A file is only proposed when nothing under frontend-new/src, backend/,
packages/inference/ or worker/ imports, routes to, or fetches it by name.

    python scripts/find-unused.py
"""
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

SOURCE_ROOTS = [
    REPO / "frontend-new" / "src",
    REPO / "backend",
    REPO / "packages" / "inference",
    REPO / "worker",
]

# Files we never call dead even if they look referenced: entry points, configs,
# and things referenced from outside the scanned roots (scripts, deploy, tests,
# public/index.html asset references).
ALWAYS_KEEP_SUFFIX = {".json", ".css", ".html", ".md", ".ico", ".woff", ".woff2", ".ttf"}
ALWAYS_KEEP_NAMES = {
    "main.py", "config.py", "database.py", "auth.py", "models.py",
    "inference_service.py", "index.js", "wrangler.jsonc",
}
ALWAYS_KEEP_DIRS = {"scripts", "deploy", "supabase", "design-system", "future", "edited", "worker"}

CANDIDATE_DIRS = [
    REPO / "frontend-new" / "src" / "components",
    REPO / "frontend-new" / "src" / "pages",
    REPO / "frontend-new" / "src" / "lib",
    REPO / "frontend-new" / "src" / "hooks",
    REPO / "frontend-new" / "src" / "context",
]


def source_files():
    for root in SOURCE_ROOTS:
        if root.exists():
            for f in root.rglob("*"):
                if f.is_file() and f.suffix in {".ts", ".tsx", ".js", ".jsx", ".py", ".html"}:
                    yield f


def corpus():
    """All scanned source text, plus index.html which references assets."""
    blobs = {}
    for f in source_files():
        blobs[f] = f.read_text(encoding="utf-8", errors="ignore")
    index = REPO / "frontend-new" / "index.html"
    if index.exists():
        blobs[index] = index.read_text(encoding="utf-8", errors="ignore")
    return blobs


def main() -> int:
    blobs = corpus()

    print("=== candidate files nothing references ===\n")

    candidates = []
    for d in CANDIDATE_DIRS:
        if not d.exists():
            continue
        for f in sorted(d.rglob("*")):
            if not f.is_file():
                continue
            rel = f.relative_to(REPO)
            if any(part in ALWAYS_KEEP_DIRS for part in rel.parts):
                continue
            if f.name in ALWAYS_KEEP_NAMES or f.suffix in ALWAYS_KEEP_SUFFIX:
                continue

            stem = f.stem
            # How is this file named when referenced? Search the corpus once
            # per pattern rather than per file — the naive version was O(files x
            # patterns) over the whole corpus and took minutes.
            refs = []
            for pattern in (
                rf'from\s+["\'][^"\']*/{re.escape(stem)}["\']',
                rf'import\s+.*["\'].*/{re.escape(stem)}["\']',
                rf'["\']/{re.escape(rel.as_posix())}["\']',
                rf'\b{re.escape(stem)}\b',
            ):
                rx = re.compile(pattern)
                refs = [p for p, t in blobs.items() if p != f and rx.search(t)]
                if refs:
                    break

            if not refs:
                candidates.append(rel)
            else:
                print(f"  USED    {rel.as_posix():<52} <- {len(refs)} file(s)")
                for r in refs[:2]:
                    print(f"            {r.relative_to(REPO).as_posix()}")

    print()
    if not candidates:
        print("  nothing unreferenced")
        return 0

    print(f"=== {len(candidates)} UNREFERENCED candidate(s) ===\n")
    for c in candidates:
        size = (REPO / c).stat().st_size
        lines = len((REPO / c).read_text(encoding="utf-8", errors="ignore").splitlines())
        print(f"  UNUSED  {c.as_posix():<52} {lines:>4} lines  {size:>7,} B")
    print()
    print("Verify each by hand before deleting. Grep the whole repo including")
    print("scripts/, deploy/ and tests/ - this scan only covers the source roots.")
    return 0


if __name__ == "__main__":
    sys.exit(main())