"""Find orphaned pages: files in src/pages that no route renders.

TypeScript already proves every import and every lazy() path resolves, so this
does not re-check resolution. It checks the thing tsc cannot: a page component
that exists and compiles but is never referenced by App.tsx, which ships in the
source tree and is silently unreachable at runtime.

    python scripts/audit-routes.py
"""
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "frontend-new" / "src"
APP = SRC / "App.tsx"

failures = 0


def report(label, ok, detail=""):
    global failures
    if ok:
        print(f"[PASS] {label}")
    else:
        failures += 1
        print(f"[FAIL] {label}")
        if detail:
            print(f"         {detail}")


app = APP.read_text(encoding="utf-8")

# ---------------------------------------------------------------------------
# Every component name App.tsx brings in, by either mechanism.
# ---------------------------------------------------------------------------
referenced = {}

# import { A, B } from "..."
for names, module in re.findall(
    r"import\s*\{([^}]+)\}\s*from\s*[\"']([^\"']+)[\"']", app
):
    for raw in names.split(","):
        name = raw.split(" as ")[-1].strip()
        if name:
            referenced[name] = module

# const X = lazy(() => import("@/pages/Foo").then(m => ({ default: m.Bar })))
for local, module, exported in re.findall(
    r"const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\(\s*[\"']([^\"']+)[\"']\s*\)"
    r"\.then\(\s*\w+\s*=>\s*\(\{\s*default:\s*\w+\.(\w+)\s*\}\)\s*\)\)",
    app,
):
    referenced[exported] = f"{module} (lazy as {local})"

# Components declared in App.tsx itself, which are legitimate route elements.
local_components = set(re.findall(r"function\s+(\w+)\s*\(", app))
# React Router primitives are never pages.
framework = {"Navigate", "Route", "Routes", "Suspense", "BrowserRouter", "Outlet",
             "Link", "useLocation", "useNavigate", "useParams", "Navigate",
             "ErrorBoundary", "Toaster"}

print("=== components App.tsx renders ===")
route_paths = re.findall(r'path="([^"]*)"', app)
for name in sorted(referenced):
    module = referenced[name]
    if name in framework:
        continue
    routed = any(name in line for line in app.splitlines() if "<Route" in line or "element=" in line)
    print(f"  {'routed' if routed else 'UNROUTED':<9} <{name}>  <- {module}")

print()
print("=== page files: is each exported component imported anywhere? ===")
# A page counts as reachable if ANY file under src imports it. App.tsx is only
# the entry point; PatientRecords renders Screenings, so checking App.tsx alone
# reports Screenings as orphaned when it is not.
importers = {}
for f in SRC.rglob("*.ts*"):
    text = f.read_text(encoding="utf-8")
    for names_raw, module in re.findall(
        r"import\s*\{([^}]+)\}\s*from\s*[\"']([^\"']+)[\"']", text
    ):
        for raw in names_raw.split(","):
            name = raw.split(" as ")[-1].strip()
            if name:
                importers.setdefault(name, []).append(
                    (f.relative_to(REPO).as_posix(), module)
                )

page_files = {}
for p in sorted(SRC.rglob("*.tsx")):
    rel = p.relative_to(SRC)
    if "pages" not in rel.parts or p.name == "App.tsx":
        continue
    text = p.read_text(encoding="utf-8")
    names = re.findall(r"export\s+(?:default\s+)?function\s+(\w+)", text)
    if not names:
        names = re.findall(r"export\s+const\s+(\w+)", text)
    if names:
        page_files[p] = names

for p, names in page_files.items():
    rel = p.relative_to(REPO).as_posix()
    for name in names:
        # Self-references do not count, and App.tsx counts as the root entry.
        users = [(src, mod) for src, mod in importers.get(name, []) if src != rel]
        direct = name in referenced or name in local_components
        ok = bool(users) or direct
        who = users[0] if users else ("App.tsx" if direct else "nobody")
        report(f"{rel} <{name}> imported by {who}", ok,
               "orphaned page - compiles and ships, but nothing imports it")

print()
print("=== route paths declared ===")
for pth in route_paths:
    print(f"  {pth}")

print()
print("=== auth guard ===")
report("PrivateRoute guard defined", "function PrivateRoute" in app)
report("guarded routes exist", "<PrivateRoute" in app)
report("redirects unauthenticated to /login", 'to="/login"' in app)
report("blocks non-approved users", 'status !== "approved"' in app)
report("role check present", "allowedRoles" in app)

print()
print("NO ORPHANED PAGES" if failures == 0 else f"{failures} PROBLEM(S)")
sys.exit(1 if failures else 0)