"""Static responsive audit.

Finds the failures that produce horizontal scroll, cramped tap targets and
unreachable columns on a phone, without needing a browser. Run it after any
layout change.

    python scripts/check-responsive.py

It reads class strings, so it catches what is written, not what is rendered.
It cannot prove a layout looks right -- that still needs a real device.
"""
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "frontend-new" / "src"

BREAKPOINTS = ("sm", "md", "lg", "xl", "2xl")

issues = []


def add(path: Path, line: int, rule: str, detail: str) -> None:
    issues.append((path.relative_to(REPO).as_posix(), line, rule, detail))


# ---------------------------------------------------------------------------
# 1. Fixed widths that can force horizontal scroll on a 375px phone
# ---------------------------------------------------------------------------
SAFE_WIDTH = 340  # 375 minus typical 16px gutters each side

for f in sorted(SRC.rglob("*.tsx")):
    if "node_modules" in f.parts:
        continue
    for i, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
        # A min-w that exceeds the phone width, without a responsive override.
        for m in re.finditer(r"(?<![-\w])min-w-\[(\d+)px\]", line):
            width = int(m.group(1))
            if width <= SAFE_WIDTH:
                continue
            has_override = re.search(r"(sm|md|lg):min-w-\[", line)
            # A wide table inside an overflow-x-auto wrapper is the correct
            # pattern: it scrolls sideways instead of stretching the page.
            before = "\n".join(
                f.read_text(encoding="utf-8", errors="ignore").splitlines()[max(0, i - 6):i]
            )
            wrapped = "overflow-x-auto" in before
            if not has_override and not wrapped:
                add(f, i, "min-width", f"min-w-[{width}px] exceeds {SAFE_WIDTH}px phone width")

        # Fixed px width on an element with no breakpoint escape.
        for m in re.finditer(r"(?<![-\w])w-\[(\d{3,})px\]", line):
            width = int(m.group(1))
            if width > SAFE_WIDTH:
                add(f, i, "fixed-width", f"w-[{width}px] is wider than a phone")

# ---------------------------------------------------------------------------
# 2. Multi-column grids with no responsive escape
# ---------------------------------------------------------------------------
for f in sorted(SRC.rglob("*.tsx")):
    for i, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
        m = re.search(r'className="([^"]*grid-cols-([234])[^"]*)"', line)
        if not m:
            continue
        classes, cols = m.group(1), m.group(2)
        # Single-column-on-mobile is expressed as grid-cols-1 with an override.
        if f"grid-cols-{cols}" in classes and not any(
            f"{bp}:grid-cols" in classes for bp in BREAKPOINTS
        ):
            add(f, i, "grid", f"grid-cols-{cols} with no responsive override")

# ---------------------------------------------------------------------------
# 3. Icon-only buttons below the 44px tap target floor
# ---------------------------------------------------------------------------
SMALL_TAP = re.compile(r"(?<![-\w])h-(\d+)(?:\.5)?(?=[\"\s]|$)")

for f in sorted(SRC.rglob("*.tsx")):
    text = f.read_text(encoding="utf-8", errors="ignore")
    for m in re.finditer(r"<Button\b[^>]*size=\"icon\"[^>]*>", text, re.S):
        tag = m.group(0)
        line = text[: m.start()].count("\n") + 1
        # touch-target or an explicit >=44px height means someone handled it.
        if "touch-target" in tag or "h-11" in tag or "h-12" in tag:
            continue
        hm = SMALL_TAP.search(tag)
        if hm and float(hm.group(1)) < 11:
            add(f, line, "tap-target", f"icon button at h-{hm.group(1)} (<44px) with no touch-target")

# ---------------------------------------------------------------------------
# 4. Raw <table> without an overflow wrapper
# ---------------------------------------------------------------------------
for f in sorted(SRC.rglob("*.tsx")):
    if f.name == "table.tsx":
        continue  # the shadcn primitive wraps itself
    text = f.read_text(encoding="utf-8", errors="ignore")
    for m in re.finditer(r"<table\b", text):
        window = text[max(0, m.start() - 400): m.start()]
        if "overflow-x-auto" not in window:
            add(f, text[: m.start()].count("\n") + 1, "table",
                "raw <table> with no overflow-x-auto ancestor")

# ---------------------------------------------------------------------------
# 4b. Both-axis table scrollers that reach the phone breakpoint
#
# A container with `overflow-auto` looks responsive and is not: on a 375px
# screen a five-column table still renders five columns, each about 60px wide,
# with the email breaking mid-string and a 32px action target. The user has to
# discover they can scroll sideways. `overflow-x-auto` is the same story, but
# that case is a legitimate choice for a genuinely tabular readout, so only the
# both-axis form is flagged here.
#
# The fix is not a wider scroller -- it is a card layout below `md`, which is
# what Admin.tsx now does. This rule exists so the next table does not quietly
# reintroduce the pattern.
# ---------------------------------------------------------------------------
for f in sorted(SRC.rglob("*.tsx")):
    if f.name == "table.tsx":
        continue
    text = f.read_text(encoding="utf-8", errors="ignore")
    for m in re.finditer(r'className="[^"]*\boverflow-auto\b[^"]*"', text):
        # The window is generous on purpose. The card list is a full ~100-line
        # sibling, so a tight lookback window never sees it and flags a page
        # that is already correct. Widening only makes this rule more
        # permissive -- it will miss a real problem in a file where some
        # unrelated `md:hidden` happens to be nearby -- which is the right
        # trade against crying wolf on every table page.
        before = text[max(0, m.start() - 6000): m.start()]
        after = text[m.start(): m.start() + 6000]
        if "<Table" not in after and "<table" not in after:
            continue  # not a table scroller
        # A mobile alternative may sit on either side of the scroller: Admin.tsx
        # hides the table and follows it with the card list, Screenings.tsx does
        # the reverse. Checking one direction only let Screenings through.
        has_mobile_alternative = (
            "hidden md:block" in before
            or "hidden md:table" in before
            or re.search(r'\bmd:hidden\b', before)
            or re.search(r'\bmd:hidden\b', after)
        )
        if not has_mobile_alternative:
            line = text[: m.start()].count("\n") + 1
            add(f, line, "table-mobile",
                "table in an overflow-auto scroller with no mobile alternative; "
                "below md it needs a card list")

# ---------------------------------------------------------------------------
# 5. Global CSS guarantees
# ---------------------------------------------------------------------------
css = (SRC / "index.css").read_text(encoding="utf-8")
if "overflow-x: clip" not in css:
    add(SRC / "index.css", 0, "overflow", "html/body lost the overflow-x: clip guard")
if "safe-area-inset" not in css:
    add(SRC / "index.css", 0, "safe-area", "no env(safe-area-inset-*) declared")
if "prefers-reduced-motion" not in css:
    add(SRC / "index.css", 0, "motion", "no prefers-reduced-motion block")

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
by_rule = {}
for path, line, rule, detail in issues:
    by_rule.setdefault(rule, []).append((path, line, detail))

if not issues:
    print("NO RESPONSIVE ISSUES FOUND")
    print()
    print("Caveat: this reads class strings. It cannot prove a layout renders")
    print("correctly at 375px, 768px or 1536px. A real device still has to check it.")
    sys.exit(0)

for rule in sorted(by_rule):
    print(f"=== {rule} ({len(by_rule[rule])}) ===")
    for path, line, detail in by_rule[rule]:
        print(f"  {path}:{line}  {detail}")
    print()

total = len(issues)
print(f"{total} RESPONSIVE ISSUE(S)")
print()
print("Caveat: static analysis of class strings only. It cannot prove a layout")
print("renders correctly. Verify on a real phone, tablet and monitor.")
sys.exit(1)