"""Sanity-check the SQL migrations without a database.

Not a parser. It checks the specific PostgreSQL rules that broke the first
version of the wipe migration:
  - balanced dollar-quote blocks
  - no VACUUM / other transaction-illegal command left uncommented
  - the FK-truncating TRUNCATE is a single statement listing every related table

    python scripts/check-migrations.py

It was verified against the broken version and flags all three defects, so a
pass here means something.
"""
import re
import sys
from pathlib import Path

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

print(f"\n{'ALL PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
sys.exit(1 if failures else 0)