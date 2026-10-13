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

# --- sitemap / robots cross-check ------------------------------------------
# Public routes are client-side paths in a React Router SPA, so the sitemap is
# the only machine-readable list of what should be indexed. It drifts silently:
# rename a route and the sitemap keeps advertising a URL that now 404s into the
# SPA fallback. Cheap to check, and the failure mode is silent in both
# directions -- a stale entry and a missing page look identical to a crawler.

SITEMAP = REPO / "frontend-new" / "public" / "sitemap.xml"
ROBOTS = REPO / "frontend-new" / "public" / "robots.txt"

if not SITEMAP.exists():
    report("sitemap.xml exists", False, "no sitemap - Search Console has no URL list")
else:
    report("sitemap.xml exists", True)
    listed = set(re.findall(r"<loc>https://auradx\.xyz([^<]*)</loc>", SITEMAP.read_text(encoding="utf-8")))
    listed = {p if p.startswith("/") else "/" + p for p in listed}

    # Public = top-level path, not behind auth, not an OAuth receiving end.
    #
    # Routes are declared two ways in App.tsx: top-level ones carry a leading
    # slash ("/about"), while children of the /dashboard layout route are
    # relative ("screening", "patient-records", "admin"). Requiring the leading
    # slash is what separates the public set from the app's, so a child route
    # cannot be mistaken for a public page.
    #
    # The site root is an *index* route -- `<Route index element={<Home />} />`,
    # inside the PublicLayout route -- so it has no path attribute to match on
    # and has to be detected separately.
    private = {"/dashboard", "/login", "/register", "/reset-password", "/auth/callback"}
    public = {
        p for p in route_paths
        if p.startswith("/") and p != "*" and p not in private
    }
    if "<Route index" in app:
        public.add("/")

    for pth in sorted(listed):
        report(f"sitemap {pth} is a real route", pth in public,
               "listed but not a public route - it will 404 into the SPA fallback")
    for pth in sorted(public):
        report(f"route {pth} is in the sitemap", pth in listed,
               "public route missing from the sitemap")

    # Only the <loc> hosts, not the file's prose -- an explanatory comment that
    # mentions www.auradx.xyz while explaining why it is absent would otherwise
    # fail the very check it documents.
    sitemap_hosts = set(re.findall(r"<loc>https://([^/<]+)", SITEMAP.read_text(encoding="utf-8")))
    report("sitemap uses the apex host only", sitemap_hosts == {"auradx.xyz"},
           f"hosts listed are {sorted(sitemap_hosts)}; apex and www serve identical "
           "bytes, so listing both tells crawlers the content exists twice")

if ROBOTS.exists():
    text = ROBOTS.read_text(encoding="utf-8")
    report("robots.txt blocks /dashboard", "/dashboard" in text)
    report("robots.txt points at the sitemap", "sitemap" in text.lower())
else:
    report("robots.txt exists", False, "missing - crawlers get the SPA shell for /robots.txt")

# The canonical and the sitemap must agree, or the two contradict each other.
index_html = (REPO / "frontend-new" / "index.html").read_text(encoding="utf-8")
canonical = re.search(r'<link\s+rel="canonical"\s+href="([^"]+)"', index_html)
report("index.html has a canonical", canonical is not None,
       "apex and www both serve this content with no redirect; without a "
       "canonical every public page has two URLs")
if canonical:
    href = canonical.group(1)
    report("canonical host is the apex", href.startswith("https://auradx.xyz"),
           f"canonical is {href}; it should name the apex host")
    # Read the href, not the file: a comment explaining that the domain has no
    # hyphen necessarily contains the hyphenated form, and would fail this.
    report("canonical host has no hyphen", "aura-dx" not in href,
           f"canonical is {href}; the domain is auradx.xyz - no hyphen")
    report("canonical does not point at www", "www." not in href,
           "canonical should name one host; www and apex serve identical bytes")

print()
print("NO ORPHANED PAGES" if failures == 0 else f"{failures} PROBLEM(S)")
sys.exit(1 if failures else 0)