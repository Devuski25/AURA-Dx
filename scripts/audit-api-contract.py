"""Cross-check the frontend against the backend.

Every API path the frontend calls must exist as a backend route, and every
backend route the frontend depends on must be reachable. A mismatch here is the
difference between a button that works and one that 404s in production.

    python scripts/audit-api-contract.py
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FE = REPO / "frontend-new" / "src"
BE = REPO / "backend" / "routes" / "api.py"

# ---------------------------------------------------------------------------
# Backend routes
# ---------------------------------------------------------------------------
route_re = re.compile(r'@router\.(get|post|patch|delete|put)\(\s*"([^"]+)"')
backend = defaultdict(set)
for method, path in route_re.findall(BE.read_text(encoding="utf-8")):
    backend[path].add(method.upper())

# ---------------------------------------------------------------------------
# Frontend calls
# ---------------------------------------------------------------------------
call_re = re.compile(r'(getApiUrl\(\s*[`"\']([^`"\']+)|fetch\(\s*`?\$\{?API_BASE\}?([^`"\')\s,]*))')
paths = defaultdict(set)

for f in FE.rglob("*.ts*"):
    text = f.read_text(encoding="utf-8", errors="ignore")
    rel = f.relative_to(REPO).as_posix()

    # getApiUrl("/api/foo") -> /api/foo
    for m in re.finditer(r'getApiUrl\(\s*[`"\']([^`"\']+)', text):
        path = m.group(1)
        # getApiUrl is itself defined as a template literal over `${path}`.
        # That is the function signature, not a route anyone calls.
        if "${" in path and not path.startswith("/"):
            continue
        paths[path].add(rel)

    # Direct `${API_BASE}/api/foo` style
    for m in re.finditer(r'\$\{API_BASE\}([^`"\')\s]*)', text):
        paths[m.group(1)].add(rel)

    # Bare "/api/..." literals in fetch()
    for m in re.finditer(r'fetch\(\s*[`"\'](/api/[^`"\']*)', text):
        paths[m.group(1)].add(rel)

# ---------------------------------------------------------------------------
# Compare
# ---------------------------------------------------------------------------
def normalise(path: str) -> str:
    """Strip interpolation, query strings and trailing slashes for comparison."""
    path = path.split("?", 1)[0].split("#", 1)[0]
    path = re.sub(r"\$\{[^}]+\}", "{p}", path)
    path = re.sub(r"\{[^}]+\}", "{p}", path)
    if not path.endswith("/"):
        path += "/"
    return path


# Only absolute /api/... literals describe a real endpoint. "${API_BASE}${path}"
# yields a bare "${path}", which is getApiUrl's own template rather than a route.
paths = {p: v for p, v in paths.items() if p.startswith("/api/")}

backend_norm = {normalise(p): m for p, m in backend.items()}
# The router is mounted under /api, so /api/x in the frontend maps to /x here.
backend_bare = {normalise(p[len("/api"):]) if p.startswith("/api") else normalise(p): m
                for p, m in backend.items()}

print("=== backend routes found ===")
for p in sorted(backend):
    print(f"  {','.join(sorted(backend[p])):<22} {p}")
print()
print("=== frontend -> backend contract ===")

failures = 0
for path in sorted(paths):
    norm = normalise(path)
    bare = norm[len("/api"):] if norm.startswith("/api/") else norm
    hit = backend_bare.get(bare)
    where = ", ".join(sorted(paths[path])[:2])
    if hit:
        print(f"  OK    {path:<34} -> {','.join(sorted(hit))}")
    else:
        failures += 1
        print(f"  MISS  {path:<34} (called by {where})")
        print(f"        no backend route matches /{bare.lstrip('/')}")

print()
print("=== backend routes the frontend never calls (informational) ===")
called_bare = set()
for p in paths:
    n = normalise(p)
    called_bare.add(n[len("/api"):] if n.startswith("/api/") else n)
for p in sorted(backend):
    bare = p[len("/api"):] if p.startswith("/api") else p
    if normalise(bare) not in called_bare:
        print(f"  unused  {','.join(sorted(backend[p])):<20} {p}")

print()
print("ALL CONTRACTS MATCH" if failures == 0 else f"{failures} MISMATCH(ES)")
sys.exit(1 if failures else 0)