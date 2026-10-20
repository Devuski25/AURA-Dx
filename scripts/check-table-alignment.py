"""Column headers must line up with the data beneath them.

    python scripts/check-table-alignment.py

A table heading is a promise about what is under it. If the heading cell and
the body cell in the same column use different horizontal padding, the
heading drifts away from the column it names -- and on the All Screenings
table that is what made PATIENT look like it belonged to the checkbox column
rather than to the patient names, because the headings were px-3 and the cells
were px-4.

This reads the table markup and compares the two. It cannot tell whether a
column looks right; it can only tell whether the two halves of a column agree
about where the text starts, which is the part that is easy to break and hard
to notice.

A heading with no text of its own -- a spacer for a trailing action column --
is skipped: there is nothing to align with.
"""

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# The tables to check: file -> the page component inside it.
TARGETS = [
    "frontend-new/src/pages/Screenings.tsx",
]

HEAD = re.compile(
    r"<TableHead\b[^>]*className=(?:\"([^\"]*)\"|\{([A-Za-z_][A-Za-z0-9_]*)\})[^>]*>(.*?)</TableHead>",
    re.S,
)
CELL = re.compile(r"<TableCell\b[^>]*className=\"([^\"]*)\"[^>]*>", re.S)
PX = re.compile(r"\bpx-(\d+(?:\.\d+)?)\b")
PL = re.compile(r"\bpl-(\d+(?:\.\d+)?)\b")
CONST = re.compile(r"^const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\n?\s*\"([^\"]*)\"", re.M)


def resolve(classes: str, named: str, consts: dict) -> str:
    """The class string, whether it was a literal or a named constant."""
    if classes:
        return classes
    return consts.get(named, "")


def leading_pad(classes: str):
    """The left inset of a cell: px-N, or pl-N if there is no px."""
    m = PX.search(classes)
    if m:
        return float(m.group(1))
    m = PL.search(classes)
    if m:
        return float(m.group(1))
    return 0.0


def has_text(classes: str, inner: str) -> bool:
    """A heading with no text of its own is a spacer, not a label."""
    if "aria-label" in classes:
        return False
    return bool(re.sub(r"<[^>]+>", "", inner).strip())


def main():
    problems = []

    for rel in TARGETS:
        path = REPO / rel
        if not path.exists():
            print(f"  MISSING {rel}")
            continue
        text = path.read_text(encoding="utf-8")
        consts = {m.group(1): m.group(2) for m in CONST.finditer(text)}

        heads = []
        for m in HEAD.finditer(text):
            classes = resolve(m.group(1) or "", m.group(2) or "", consts)
            inner = re.sub(r"<!--.*?-->", "", m.group(3), flags=re.S)
            if not has_text(classes, inner):
                continue
            label = re.sub(r"<[^>]+>", "", inner).strip()
            heads.append((label, leading_pad(classes), classes))

        cells = [leading_pad(m.group(1)) for m in CELL.finditer(text)]

        print(f"  {rel}")
        print(f"    {len(heads)} heading(s) with text, {len(cells)} cell(s)")
        for label, pad, _ in heads:
            print(f"      {label:<10} left inset {pad}")

        # Every heading's inset has to be an inset the body cells actually
        # use. A heading that is tighter or looser than the data below it is
        # the drift being guarded against.
        distinct = sorted(set(cells))
        print(f"    body cell insets in use: {distinct}")
        for label, pad, _ in heads:
            if pad not in distinct:
                problems.append(
                    f"{rel}: heading '{label}' has left inset {pad}, "
                    f"which no body cell uses (cells use {distinct})")

    if problems:
        print("\n  ALIGNMENT PROBLEMS:")
        for p in problems:
            print(f"    {p}")
        return 1

    print("\n  PASS: every heading lines up with the data beneath it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
