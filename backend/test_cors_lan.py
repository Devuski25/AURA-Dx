"""CORS scoping test for cross-device development.

`Settings.cors_lan_origin_regex` admits origins on the clinic LAN so the dev
site works from a phone or a second laptop. This asserts exactly what it does
and does not match -- the value of the pattern is entirely in what it refuses,
so the refusals are the part that needs pinning down.

    python backend/test_cors_lan.py

Imports config directly. Safe anywhere: no network, no Supabase, no model
loading. Pydantic only.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import settings  # noqa: E402

PATTERN = re.compile(settings.cors_lan_origin_regex)

# Origins that MUST be admitted. These are the whole reason the pattern exists:
# a phone on the same network as the dev server.
ALLOW = [
    "http://localhost:5174",
    "http://localhost:3000",
    "http://127.0.0.1:5174",
    "http://[::1]:5174",
    "http://192.168.1.42:5174",
    "http://192.168.100.7:3000",
    "http://10.0.0.5:5174",
    "http://172.16.3.9:5174",
    "http://172.31.255.1:5174",
    "http://devbox.local:5174",
    "http://192.168.1.42",  # no port
]

# Origins that MUST be refused. The production surface is the important one:
# those are matched by the explicit `allow_origins` list, not by this pattern,
# so a bug here cannot silently widen it.
DENY = [
    "https://auradx.xyz",
    "https://www.auradx.xyz",
    "https://api.auradx.xyz",
    "https://infer.auradx.xyz",
    "http://8.8.8.8:5174",  # public address
    "http://172.32.0.1:5174",  # just past 172.31
    "http://172.15.0.1:5174",  # just below 172.16
    "http://11.0.0.1:5174",  # 11.x is not RFC1918
    "https://192.168.1.42:5174",  # https LAN is deliberately excluded
    "http://evil.example.com",
    "http://notlocalhost:5174",  # substring, not a label
    "http://192.168.1.42.evil.com:5174",  # suffix smuggling
    "http://localhost.evil.com:5174",
    "null",  # opaque origin, e.g. a sandboxed iframe or a file:// page
    "",
]


def main() -> int:
    failures = []

    for origin in ALLOW:
        if not PATTERN.match(origin):
            failures.append(f"  REFUSED but should be allowed: {origin!r}")

    for origin in DENY:
        if PATTERN.match(origin):
            failures.append(f"  ALLOWED but should be refused: {origin!r}")

    if failures:
        print("CORS LAN PATTERN FAILURES")
        print("\n".join(failures))
        print()
        print("Pattern under test:")
        print(f"  {settings.cors_lan_origin_regex}")
        return 1

    print("ALL PASS")
    print(f"  {len(ALLOW)} LAN origins allowed, {len(DENY)} refused")
    print(f"  production origins ({len(settings.cors_origin_list)}) match by name in allow_origins")
    for origin in settings.cors_origin_list:
        print(f"    {origin}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
