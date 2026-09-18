"""Generate the AURA-Dx favicon set from the hero artwork (webdes.png —
the lungs + stethoscope illustration from the Home page hero).

Per request: the RAW artwork IS the icon. No tile, no background, no redraw —
the image is only alpha-cropped (transparent margins trimmed), centered on a
transparent square canvas, and exported.

Outputs (frontend-new/public/):
  favicon.ico            16 + 32 + 48 multi-resolution
  favicon-32x32.png
  favicon-16x16.png
  apple-touch-icon.png   180x180
  favicon.svg            the artwork embedded as a data URI (modern browsers
                         prefer the SVG link, so it must carry the real image)

Run:  backend/venv/Scripts/python.exe frontend-new/scripts/gen_favicons.py
"""
from pathlib import Path

import base64
import io

from PIL import Image

S = 4                     # supersample factor
CANVAS = 512 * S
ART_FILL = 0.94           # artwork fills 94% of the (transparent) canvas

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "public"
ART_SRC = HERE.parent / "src" / "assets" / "public" / "webdes.png"


def load_artwork() -> Image.Image:
    """Hero art cropped to its alpha bounding box (trim transparent margins)."""
    art = Image.open(ART_SRC).convert("RGBA")
    bbox = art.getbbox()
    if bbox:
        art = art.crop(bbox)
    return art


def compose() -> Image.Image:
    """Transparent square canvas with the raw artwork centered."""
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    art = load_artwork()
    slot = int(CANVAS * ART_FILL)
    art.thumbnail((slot, slot), Image.LANCZOS)
    canvas.alpha_composite(art, ((CANVAS - art.width) // 2, (CANVAS - art.height) // 2))
    return canvas


def write_svg(art: Image.Image, path: Path, px: int = 144) -> None:
    """favicon.svg embedding the ACTUAL artwork as a data URI.

    Keeps the artwork's native aspect ratio (no square padding) — browsers
    letterbox favicons fine. Rendered to PNG then wrapped in a minimal SVG.
    """
    small = art.copy()
    small.thumbnail((px, px), Image.LANCZOS)
    buf = io.BytesIO()
    small.save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    path.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {small.width} {small.height}">'
        '<title>AURA-Dx</title>'
        f'<image width="{small.width}" height="{small.height}" '
        f'href="data:image/png;base64,{b64}"/>'
        "</svg>",
        encoding="ascii",
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icon = compose()
    art = load_artwork()

    icon.resize((512, 512), Image.LANCZOS).save(
        OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
    )
    for size in (16, 32):
        icon.resize((size, size), Image.LANCZOS).save(OUT / f"favicon-{size}x{size}.png")

    icon.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")

    write_svg(art, OUT / "favicon.svg")

    # Sanity report + preview strip (256/48/32/16) on light and dark ground
    ico = Image.open(OUT / "favicon.ico")
    sizes = sorted(ico.info.get("sizes") or [])
    print("ICO frame sizes:", sizes if sizes else "(PIL reports base only)")

    strip_w = (256 + 48 + 32 + 16) + 5 * 12
    preview = Image.new("RGB", (strip_w, 560), (250, 249, 245))
    dark_row = Image.new("RGB", (strip_w, 280), (30, 30, 30))
    preview.paste(dark_row, (0, 280))
    for row_y in (0, 280):
        x = 12
        for size in (256, 48, 32, 16):
            frame = icon.resize((size, size), Image.LANCZOS)
            preview.paste(frame, (x, row_y + 140 - size // 2), frame)
            x += size + 12
    preview.save(HERE.parent / "favicon-preview.png")
    print("Preview: frontend-new/favicon-preview.png")

    for name in ("favicon.ico", "favicon.svg", "favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png"):
        p = OUT / name
        if p.suffix == ".svg":
            print(f"{name:24} {'svg (embedded artwork)':22} {p.stat().st_size} bytes")
            continue
        with Image.open(p) as im:
            print(f"{name:24} {str(im.size):22} {im.mode} {p.stat().st_size} bytes")


if __name__ == "__main__":
    main()
