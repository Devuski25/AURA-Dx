"""Generate backend/.env.local from SERVICE_CONFIGURATION.md.

Why this exists
---------------
`backend/.env.local` is gitignored, so `git pull` never transfers it. Every
machine that runs the backend needs its own copy, and the obvious workaround -
copying keys out of SERVICE_CONFIGURATION.md by hand - is exactly the process
that produces transcription errors, and puts live credentials into a chat
transcript or a screenshot.

This reads the reference document on disk and writes the file directly. No
secret value is ever printed, logged, or passed through stdout. Only key names
and value LENGTHS are reported, which is enough to confirm a key was found
without revealing it.

    python scripts/make-backend-env.py             # refuse to overwrite
    python scripts/make-backend-env.py --force     # replace an existing file
    python scripts/make-backend-env.py --check     # validate, write nothing
"""
import argparse
import re
import secrets
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / "SERVICE_CONFIGURATION.md"
TARGET = REPO / "backend" / ".env.local"
INFER_ENV = REPO / "packages" / "inference" / ".env.local"

# Keys backend/config.py defines, in the order they should appear in the file.
# Anything in SERVICE_CONFIGURATION.md that is not listed here is deliberately
# dropped: SMTP_PASS is not read (RESEND_API_KEY is the SMTP password) and
# SMTP_STARTTLS is not read either (email_service.py calls starttls
# unconditionally), so writing them would imply they do something.
WANTED = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_KEY",
    "INFERENCE_SERVICE_URL",
    "INFERENCE_API_KEY",
    "API_HOST",
    "API_PORT",
    "CORS_ORIGINS",
    "JWT_SECRET",
    "JWT_ALGORITHM",
    "RESEND_API_KEY",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_FROM",
]

# The document repeats keys across sections. The block that documents
# backend/.env.local is the authoritative one for this purpose; anything else is
# a fallback.
PREFERRED_SECTION = "environment variables"

ASSIGN = re.compile(r"^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)\s*=\s*(\S.*?)\s*$")
PLACEHOLDER = re.compile(r"^(your-|<|changeme|placeholder|xxx)", re.I)


def production_origins() -> list:
    """Production origins, read from the Cloudflare routes in wrangler.jsonc.

    CORS has to list every hostname the frontend is actually served from. Those
    are declared in one place only - wrangler.jsonc - so deriving from there
    means adding a route there cannot leave the backend silently rejecting that
    domain's requests. The reference document drifted: it listed auradx.xyz but
    not www.auradx.xyz, while both were deployed, so anyone on the www version
    would have failed CORS preflight on every API call.

    Localhost dev origins are added separately, since they are useful on a
    developer machine and harmless in production.
    """
    config = REPO / "wrangler.jsonc"
    origins = []
    if config.exists():
        for match in re.finditer(r'"pattern"\s*:\s*"([^"]+)"', config.read_text(encoding="utf-8")):
            origin = match.group(1).strip().rstrip("/")
            # A wrangler route pattern is a bare hostname, but a CORS Origin is
            # always scheme://host[:port]. These are Cloudflare custom domains,
            # which are HTTPS only, and the Worker redirects http -> https.
            if origin and "://" not in origin:
                origin = "https://" + origin
            if origin and origin not in origins:
                origins.append(origin)
    if not origins:
        origins = ["https://auradx.xyz", "https://www.auradx.xyz"]
    return origins


def read_kv(path: Path) -> dict:
    """Read a KEY=value file. Used for the inference machine-local env file."""
    out = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def parse_reference(text: str):
    """Return {key: (value, from_preferred_section)} for every KEY = value line."""
    preferred, fallback, section = {}, {}, ""
    for line in text.splitlines():
        if line.startswith("#"):
            lowered = line.lower()
            if PREFERRED_SECTION in lowered:
                section = "preferred"
            elif line.startswith("## ") or line.startswith("### "):
                # Any other heading ends the preferred block.
                if PREFERRED_SECTION not in lowered:
                    section = ""
            continue
        m = ASSIGN.match(line)
        if not m:
            continue
        key, value = m.group(1), m.group(2).strip().strip("`").strip()
        # Strip trailing markdown, e.g. "value" or value <!-- note -->
        value = re.sub(r"\s*(<!--.*?-->|`)\s*$", "", value).strip().strip("`")
        if section == "preferred":
            preferred.setdefault(key, value)
        else:
            fallback.setdefault(key, value)

    merged = dict(fallback)
    merged.update(preferred)
    return merged


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="overwrite an existing file")
    ap.add_argument("--check", action="store_true", help="report only, write nothing")
    args = ap.parse_args()

    if not SOURCE.exists():
        print(f"FAIL: {SOURCE.name} not found at {SOURCE}")
        return 1

    values = parse_reference(SOURCE.read_text(encoding="utf-8"))

    found, missing, placeholdered = {}, [], []
    for key in WANTED:
        value = values.get(key, "")
        if not value:
            missing.append(key)
        elif PLACEHOLDER.match(value):
            placeholdered.append(key)
        else:
            found[key] = value

    print("=== source ===")
    print(f"  {SOURCE.relative_to(REPO)}")
    print("")
    print("=== keys resolved (values never printed) ===")
    for key in WANTED:
        if key in found:
            print(f"  OK       {key:<24} {len(found[key]):>4} chars")
        elif key in placeholdered:
            print(f"  PLACEHLD {key:<24} still a template value")
        else:
            print(f"  MISSING  {key}")
    print("")

    # INFERENCE_API_KEY is the one placeholder that matters but is not fatal to
    # starting. The reference document has never had a real value in it, which
    # means the inference service has been running unauthenticated - it only
    # enforces X-API-Key when its own INFERENCE_API_KEY env var is set, and it
    # never was. Generating a key here closes that, and the same value is written
    # to the inference machine-local file so the inference service reads it into the
    # service process. Both sides then present the same secret.
    infer_key_existing = ""
    if INFER_ENV.exists():
        infer_key_existing = read_kv(INFER_ENV).get("INFERENCE_API_KEY", "")

    if "INFERENCE_API_KEY" in placeholdered or not found.get("INFERENCE_API_KEY"):
        if infer_key_existing:
            found["INFERENCE_API_KEY"] = infer_key_existing
            print("NOTE  reusing the existing machine-local inference key")
        else:
            found["INFERENCE_API_KEY"] = secrets.token_urlsafe(32)
            print("NOTE  generating a new INFERENCE_API_KEY. The reference document "
                  "never had a real one, so inference was unauthenticated.")
        print("      The same key goes in backend/.env.local and "
              "packages/inference/.env.local; the service reads the latter into the")
        print("      inference process. Delete INFERENCE_API_KEY from "
              "SERVICE_CONFIGURATION.md afterwards.")
        print("")

    # CORS is a union, never a copy. Whatever the reference document says, the
    # production origins from wrangler.jsonc are guaranteed present.
    prod = production_origins()
    current = [o.strip().rstrip("/") for o in found.get("CORS_ORIGINS", "").split(",") if o.strip()]
    added = [o for o in prod if o not in current]
    for origin in prod:
        if origin not in current:
            current.append(origin)
    if current:
        found["CORS_ORIGINS"] = ",".join(current)
    if added:
        print(f"FIX    CORS_ORIGINS was missing {', '.join(added)}")
        print(f"       now: {found['CORS_ORIGINS']}")
        print("")

    # Only the keys the backend refuses to start without are fatal.
    critical = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY") if k in missing]
    if critical:
        print(f"FAIL: the backend cannot start without {', '.join(critical)}.")
        print("      That is the error you hit. Add them to SERVICE_CONFIGURATION.md")
        print("      and re-run, or set them manually.")
        return 1

    if args.check:
        print("--check given, nothing written.")
        return 0

    if TARGET.exists() and not args.force:
        print(f"REFUSING to overwrite existing {TARGET.relative_to(REPO)}.")
        print("  Re-run with --force to replace it.")
        return 1

    lines = [
        "# Generated by scripts/make-backend-env.py from SERVICE_CONFIGURATION.md",
        "# Machine-local. Never commit this file - it is gitignored for that reason.",
        "# Regenerate with:  python scripts/make-backend-env.py --force",
        "",
    ]
    for key in WANTED:
        if key in found:
            lines.append(f"{key}={found[key]}")

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"WROTE {TARGET.relative_to(REPO)}  ({len(found)} keys, 0 values shown)")

    # Mirror the inference key to the side that has to present it. Keep any
    # other keys already in that file.
    existing = read_kv(INFER_ENV) if INFER_ENV.exists() else {}
    existing["INFERENCE_API_KEY"] = found["INFERENCE_API_KEY"]
    infer_lines = [
        "# Generated by scripts/make-backend-env.py",
        "# Machine-local. Read by inference_service.py at startup for INFERENCE_API_KEY.",
        "# The service is launched through WMI from deploy/mini-pc/start-aura-services.ps1,",
        "# and a WMI-spawned process does not inherit the launching shell's environment,",
        "# so the service loads this file itself rather than relying on env injection.",
        "",
    ]
    infer_lines += [f"{k}={v}" for k, v in sorted(existing.items())]
    INFER_ENV.parent.mkdir(parents=True, exist_ok=True)
    INFER_ENV.write_text("\n".join(infer_lines) + "\n", encoding="utf-8")
    print(f"WROTE {INFER_ENV.relative_to(REPO)}  (1 key, 0 values shown)")

    if missing:
        print("")
        print(f"  Omitted, not in the reference: {', '.join(missing)}")
        print("  The backend uses its defaults for those. Check the startup")
        print("  diagnostics in backend.err.log if something misbehaves.")
    return 0


if __name__ == "__main__":
    sys.exit(main())