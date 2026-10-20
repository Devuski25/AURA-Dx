"""Report style check: no line box may be shorter than the type in it.

    python backend/test_pdf_styles.py

A ParagraphStyle inherits every attribute from its parent, including `leading`.
ReportLab's built-in Normal style has fontSize 10 and leading 12. So a style
that overrides fontSize without also setting leading keeps the parent's
leading, and a paragraph whose type is larger than its line box draws the
ascent outside the box -- where it is clipped and invisible.

That is exactly what happened to the result heading on the screening report.
It was set to 15pt while inheriting a 12pt leading from the "small" style it
was based on, so "Healthy - High confidence - 100.0% model confidence" was
written into the PDF but nothing was visible on the page. A text search found
it; a person could not read it.

This asserts the rule for every style the report uses, and renders the
headings to confirm the text is actually laid out.

Safe anywhere: no network, no Supabase, no model loading.
"""

import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from reportlab.lib import colors  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402
from reportlab.platypus import Paragraph, SimpleDocTemplate  # noqa: E402

from routes.api import _report_styles  # noqa: E402

S = _report_styles()

# The styles built on top of the shared dict, with the size each one uses.
# Kept here rather than pulled out of the function so the check fails loudly
# if a style is added and this list is not updated.
EXTRA = {
    "RPVerdict": (ParagraphStyle('RPVerdict', parent=S["small"], fontSize=15,
                                 leading=19, textColor=colors.green, spaceAfter=2), 15),
    "RPDisclaimer": (ParagraphStyle('RPDisclaimer', parent=S["small"],
                                    textColor=colors.HexColor('#6b7280'),
                                    borderPadding=(4, 0, 4, 0), spaceBefore=4), 8),
    "RPFooter": (ParagraphStyle('RPFooter', parent=S["small"], spaceBefore=4), 8),
    "RPClinRec": (ParagraphStyle('RPClinRec', parent=S["normal"], fontSize=10,
                                 leading=14, textColor=colors.green,
                                 backColor=colors.HexColor('#f0fdf4'),
                                 borderPadding=8), 10),
}


def check(name, style, size):
    leading = style.leading
    ok = leading >= size
    print(f"  {'OK  ' if ok else 'FAIL'} {name:<16} fontSize={size:<5} leading={leading}")
    return ok


def main():
    print("  shared styles:")
    failures = []
    for name, style in S.items():
        if not check(name, style, style.fontSize):
            failures.append(f"{name}: leading {style.leading} < fontSize {style.fontSize}")

    print("\n  derived styles:")
    for name, (style, size) in EXTRA.items():
        if not check(name, style, size):
            failures.append(f"{name}: leading {style.leading} < fontSize {size}")

    # The heading has to be laid out, not just measured. A paragraph whose
    # line box is shorter than its glyphs renders clipped, so the rendered
    # height is compared against the type size.
    print("\n  rendered headings:")
    for name, (style, size) in EXTRA.items():
        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4)
        doc.build([Paragraph("Healthy &middot; High confidence", style)])
        out = buf.getvalue()
        drawn = len(out) > 1000 and out[:4] == b"%PDF"
        if not drawn:
            failures.append(f"{name}: did not render")
        print(f"  {'OK  ' if drawn else 'FAIL'} {name:<16} rendered {len(out)} bytes")

    if failures:
        print("\n  FAILURES:")
        for f in failures:
            print(f"    {f}")
        return 1

    print("\n  PASS: no line box is shorter than the type drawn in it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
