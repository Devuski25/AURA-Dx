"""The patient picker's header row and its data rows must agree on the columns.

    python scripts/check-picker-grid.py

The picker's header is a grid with the same class as the rows, and every cell
in it is a grid item. When the header had more visible cells than the row had
tracks, the surplus wrapped onto a second line: the list showed an "Action"
heading broken across two lines as "Acti on", over a row that was clipped.

That is not obvious to an editor, because the header and the row look like
parallel markup and nothing complains. This counts the tracks in the grid
definition and the cells that are actually visible at each breakpoint, for
both the header and a row, and asserts they match.

A cell is hidden below `sm` when its class list contains `hidden` together
with an `sm:` override -- that is how "this column only exists on wider
screens" is expressed here.
"""

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / "frontend-new/src/pages/Screening.tsx"

# A JSX tag's attributes. The `=>` in an inline arrow function has to be
# allowed through, or the tag is cut short at the arrow and the className
# after it is never seen.
TAG = re.compile(
    r"<(/?)([A-Za-z][\w.]*)((?:\"[^\"]*\"|'[^']*'|=>|[^>])*?)(/?)>", re.S
)


def tracks(spec: str) -> int:
    """How many grid tracks a grid-cols-[...] specification declares."""
    inner = spec.strip()[1:-1]
    depth = 0
    count = 1
    for ch in inner:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "_" and depth == 0:
            count += 1
    return count


def mobile_visible(class_name: str) -> bool:
    """Is this cell shown on a phone?

    `hidden` together with an `sm:` override means "wider screens only".
    """
    if "hidden" not in class_name:
        return True
    return "sm:" not in class_name.split("hidden", 1)[1]


def direct_children(src: str, open_tag_end: int) -> list[str]:
    """The class list of every direct child element of an element.

    `open_tag_end` is the index just past the '>' that closed the parent's
    opening tag. Depth counts the elements open *inside* the parent, so a child
    that contains other elements is still counted once, and the parent's own
    closing tag is what ends the walk.

    Absolutely positioned children are dropped: they are taken out of flow and
    occupy no grid track. The row's stretched click target is one of those.
    """
    out: list[str] = []
    depth = 0
    for m in TAG.finditer(src, open_tag_end):
        closing, name, attrs, self_closing = m.groups()
        if closing:
            depth -= 1
            if depth < 0:
                # The parent's own closing tag.
                break
            continue
        if depth == 0:
            cm = re.search(r'className=(?:"([^"]*)"|\{([^{}]*)\})', attrs)
            cls = (cm.group(1) or cm.group(2) or "") if cm else ""
            if "absolute" not in cls:
                out.append(cls)
        if not self_closing:
            depth += 1
    return out


def block_after(src: str, marker: str, occurrence: int = 0) -> list[str]:
    """The direct children of the first element that follows `marker`."""
    i = -1
    for _ in range(occurrence + 1):
        i = src.index(marker, i + 1)
    # Find the opening tag of the element that contains the marker.
    lt = src.rindex("<", 0, i)
    gt = src.index(">", lt)
    return direct_children(src, gt + 1)


def main():
    src = SOURCE.read_text(encoding="utf-8")

    gm = re.search(r'const PATIENT_GRID\s*=\s*\\?\s*\n?\s*"([^"]+)"', src)
    if not gm:
        print("  could not find PATIENT_GRID")
        return 1
    grid_classes = gm.group(1)

    mobile = re.search(r"grid-cols-\[([^\]]+)\]", grid_classes)
    desktop = re.search(r"sm:grid-cols-\[([^\]]+)\]", grid_classes)
    if not mobile or not desktop:
        print("  could not read the grid tracks")
        return 1
    mobile_tracks = tracks(mobile.group(1))
    desktop_tracks = tracks(desktop.group(1))
    print(f"  PATIENT_GRID: {mobile_tracks} track(s) on a phone, {desktop_tracks} from sm up")

    # The header is the sticky row that carries the column labels. It is found
    # by its own class rather than by `aria-hidden`, which every icon in the
    # file also carries.
    header_cells = block_after(src, "sticky top-0 z-10 border-b border-aura-border-soft")
    row_cells = block_after(src, "key={patient.id}")

    problems = []
    for label, cells in (("header", header_cells), ("row", row_cells)):
        vis_phone = [c for c in cells if mobile_visible(c)]
        print(f"  {label}: {len(cells)} cell(s), {len(vis_phone)} visible on a phone")
        if len(vis_phone) != mobile_tracks:
            problems.append(
                f"{label} shows {len(vis_phone)} cell(s) on a phone but the grid has "
                f"{mobile_tracks} track(s) -- the surplus wraps onto a second line")
        if len(cells) != desktop_tracks:
            problems.append(
                f"{label} shows {len(cells)} cell(s) from sm up but the grid has "
                f"{desktop_tracks} track(s)")

    if problems:
        print("\n  PROBLEMS:")
        for p in problems:
            print(f"    {p}")
        return 1

    print("\n  PASS: the header and the rows occupy the same tracks at every width")
    return 0


if __name__ == "__main__":
    sys.exit(main())
