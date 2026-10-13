"""Environment-gating regression test.

`Settings.is_production` decides two things that must never be true in a deployed
environment:

  1. whether `POST /api/auth/send-otp` puts the verification code in its JSON
     response, which lets anyone read the code for any address and skip email
     verification;
  2. whether an email send failure is raised or swallowed.

It previously read `app_env == "production"`, which fails OPEN. APP_ENV was
unset on the deployed machine, so the comparison was False, production behaved
like development, and the live endpoint returned the code:

    POST https://api.auradx.xyz/api/auth/send-otp
    -> {"success":true,"dev_code":"935612"}

An allowlist fixes that -- every value that is not recognisably a dev environment
resolves to production -- but only if it stays an allowlist. This test pins the
fail-closed behaviour for every value that could plausibly be misconfigured.

    python backend/test_app_env.py

Pydantic only. Safe anywhere.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import Settings  # noqa: E402

# Anything in here must resolve to development behaviour.
DEV = ["development", "Development", "DEVELOPMENT", " dev ", "dev", "local", "local "]

# Everything else must resolve to production, including the values that caused
# the original bug: unset, blank, and plausible typos of "production".
PROD = [
    "",
    "   ",
    "production",
    "Production",
    "PROD",
    "prod",
    "prod ",
    "staging",
    "test",
    "testing",
    "development-ish",
    "dev2",
    "localhost",
    "auradx",
    "mini-pc",
    "none",
    "null",
    "true",
]


def main() -> int:
    failures = []

    for value in DEV:
        s = Settings(app_env=value)
        if s.is_production:
            failures.append(f"  {value!r} -> production, should be development")

    for value in PROD:
        s = Settings(app_env=value)
        if not s.is_production:
            failures.append(f"  {value!r} -> development, should be production")

    if failures:
        print("APP_ENV GATING FAILURES")
        print("\n".join(failures))
        print()
        print("Any value resolving to 'development' can leak the verification code.")
        return 1

    print("ALL PASS")
    print(f"  {len(DEV)} named dev environment(s) -> development behaviour")
    print(f"  {len(PROD)} other value(s) -> production behaviour (fail closed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
