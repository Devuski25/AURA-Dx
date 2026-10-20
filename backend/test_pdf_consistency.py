"""The report's heading and its recommendation must not contradict each other.

    python backend/test_pdf_consistency.py

The report leads with the reported verdict -- the fused interpretation and its
confidence. The clinical recommendation further down answers "what now, given
what was found". If the two are derived from different fields they can
disagree, and a page that says "Healthy" and then advises spirometry and a
pulmonology referral invites a referral nobody needed.

That is not hypothetical: the recommendation was keyed on the raw classifier
column while the heading used the fused interpretation, and on a real
screening the two read COPD and HEALTHY respectively. The page contradicted
itself.

This renders the export for every screening in the database, reads the verdict
and the recommendation off each page, and checks they agree. A page with no
recommendation is allowed -- a class the copy file does not cover prints no
advice rather than wrong advice.

Needs a reachable database. Safe anywhere else: no model loading.
"""

import asyncio
import base64
import re
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from database import supabase  # noqa: E402
from models import ExportRequest  # noqa: E402
from routes.api import export_screenings_pdf  # noqa: E402

# What each class's advice has to be recognisable as.
CLASS_OF_ADVICE = {
    "No urgent action required": "Healthy",
    "Consider spirometry": "COPD",
    "chest imaging": "Pneumonia",
}


def page_streams(body: bytes):
    """The decoded content stream of every page."""
    out = []
    for m in re.finditer(rb"stream\n(.*?)endstream", body, re.S):
        raw = m.group(1).strip()
        try:
            out.append(zlib.decompress(base64.a85decode(raw, adobe=True)).decode("latin-1", "replace"))
        except Exception:
            pass
    return out


def main():
    rows = (
        supabase.table("screening_history_view")
        .select("id,interpretation_status,confidence_level,respiratory_result")
        .order("created_at", desc=True).limit(25).execute().data or []
    )
    if not rows:
        print("  no screenings available")
        return 0

    resp = asyncio.run(export_screenings_pdf(
        ExportRequest(screening_ids=[r["id"] for r in rows]),
        {"role": "super_admin", "clinic_id": None, "sub": "x"}))

    async def drain(x):
        out = []
        async for c in x.body_iterator:
            out.append(c if isinstance(c, bytes) else c.encode("utf-8", "replace"))
        return b"".join(out)

    body = asyncio.run(drain(resp))
    failures = []
    checked = 0

    for i, s in enumerate(page_streams(body)):
        vm = re.search(r"\((Healthy|COPD|Pneumonia)\) Tj", s)
        if not vm:
            continue
        heading = vm.group(1)

        rm = re.search(r"\(CLINICAL RECOMMENDATION:\) Tj", s)
        if not rm:
            print(f"  page {i + 1}: heading={heading:<10} no recommendation printed")
            continue

        tm = re.search(r"\(([^)]*)\) Tj", s[rm.end():])
        advice = tm.group(1) if tm else ""
        advice_class = next(
            (cls for needle, cls in CLASS_OF_ADVICE.items() if needle in advice), None)
        if advice_class is None:
            print(f"  page {i + 1}: heading={heading:<10} advice not recognised")
            continue

        checked += 1
        ok = advice_class == heading
        print(f"  page {i + 1}: heading={heading:<10} advice={advice_class:<10} "
              f"{'consistent' if ok else '*** CONTRADICTION ***'}")
        if not ok:
            failures.append(f"page {i + 1}: heading says {heading}, advice is {advice_class}")

    print(f"\n  {checked} page(s) checked")
    if failures:
        print("  FAILURES:\n    " + "\n    ".join(failures))
        return 1
    print("  PASS: every page's recommendation agrees with its heading")
    return 0


if __name__ == "__main__":
    sys.exit(main())
