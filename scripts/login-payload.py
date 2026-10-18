"""Measure what the Login page actually has to download to render.

A single chunk size is the wrong number: what a visitor waits for is the entry
script plus every chunk statically reachable from it plus the stylesheet. Those
are exactly the `<script>` and `<link rel=modulepreload|stylesheet>` entries Vite
writes into index.html, so the number can be read straight out of the build
output rather than guessed at.

This exists because chunk-level numbers mislead. Making `Dashboard` lazy grew the
entry chunk from 187 KB to 269 KB and looked like a regression, while the actual
critical path fell 1096 KB -> 1077 KB because a 102 KB shared chunk left it.
Reading index.html settles that without a browser.

Run from the repo root:  python scripts/login-payload.py [dist]
"""

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DIST = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "frontend-new" / "dist"
if not DIST.is_absolute():
    DIST = (REPO / DIST).resolve()


def kb(n: int) -> str:
    return f"{n / 1024:8.1f} KB"


def main() -> None:
    index = DIST / "index.html"
    if not index.is_file():
        raise SystemExit(f"no build found at {index}")
    html = index.read_text(encoding="utf-8")

    # Everything the browser must have before the first paint of the entry route.
    critical: list[Path] = []
    for m in re.finditer(r'<script[^>]+src="([^"]+)"', html):
        critical.append(DIST / m.group(1).lstrip("/"))
    for m in re.finditer(r'<link[^>]+rel="(?:modulepreload|preload)"[^>]+href="([^"]+)"', html):
        critical.append(DIST / m.group(1).lstrip("/"))
    for m in re.finditer(r'<link[^>]+href="([^"]+\.css)"[^>]*rel="stylesheet"', html):
        critical.append(DIST / m.group(1).lstrip("/"))
    # rel can precede href; catch the other order too
    for m in re.finditer(r'<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"', html):
        critical.append(DIST / m.group(1).lstrip("/"))

    seen: list[Path] = []
    for p in critical:
        if p not in seen:
            seen.append(p)

    print(f"Login-page critical path ({DIST}):\n")
    raw = 0
    for p in sorted(seen, key=lambda x: -x.stat().st_size if x.exists() else 0):
        if not p.exists():
            print(f"  MISSING  {p}")
            continue
        size = p.stat().st_size
        raw += size
        print(f"  {kb(size)}  {p.name}")
    print(f"  {kb(raw)}  TOTAL raw")

    total = sum(f.stat().st_size for f in DIST.rglob("*") if f.is_file())
    print(f"\n  {kb(total)}  whole build, all routes")

    lazy = sorted(
        (f for f in (DIST / "assets").glob("*.js") if f not in seen),
        key=lambda x: -x.stat().st_size,
    )
    if lazy:
        print(f"\n  deferred to route navigation ({kb(sum(f.stat().st_size for f in lazy))}):")
        for f in lazy[:8]:
            print(f"  {kb(f.stat().st_size)}  {f.name}")
        if len(lazy) > 8:
            print(f"  ... and {len(lazy) - 8} more")

    print("\n  NOTE: raw bytes. Cloudflare serves Brotli, so the wire cost is")
    print("  roughly a third of these numbers -- the ratios are what matter.")


if __name__ == "__main__":
    main()