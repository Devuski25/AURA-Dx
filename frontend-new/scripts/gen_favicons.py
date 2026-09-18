"""Generate the AURA-Dx favicon set from the actual hero artwork
(webdes.png — lungs + stethoscope illustration from the Home page hero).

The hero art was designed against the dark-green hero background, so it is
composed onto a matching deep-forest rounded tile (#0E2E24) to preserve its
native contrast in both light and dark browser chrome. The artwork itself is
never recolored or redrawn — only cropped, scaled, and framed.

Outputs (frontend-new/public/):
  favicon.ico            16 + 32 + 48 multi-resolution
  favicon-32x32.png
  favicon-16x16.png
  apple-touch-icon.png   180x180, full-bleed background (iOS rounds corners)

Run:  backend/venv/Scripts/python.exe frontend-new/scripts/gen_favicons.py
"""
from pathlib import Path

import base64
import io

from PIL import Image, ImageDraw

S = 4                          # supersample factor (draw tile at 4x)
CANVAS = 512 * S
TILE_RADIUS = 115 * S
BG = (14, 46, 36, 255)         # #0E2E24 — hero dark green

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "public"
ART_SRC = HERE.parent / "src" / "assets" / "public" / "webdes.png"
ART_FILL = 0.86                # artwork fills 86% of the tile


def load_artwork() -> Image.Image:
    """Hero art cropped to its alpha bounding box (trim transparent margins)."""
    art = Image.open(ART_SRC).convert("RGBA")
    bbox = art.getbbox()
    if bbox:
        art = art.crop(bbox)
    return art


def compose(full_bleed: bool) -> Image.Image:
    img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(
        [0, 0, CANVAS - 1, CANVAS - 1],
        radius=0 if full_bleed else TILE_RADIUS,
        fill=BG,
    )

    art = load_artwork()
    # Fit the artwork inside a square slot at ART_FILL of the tile
    slot = int(CANVAS * ART_FILL)
    art.thumbnail((slot, slot), Image.LANCZOS)
    x = (CANVAS - art.width) // 2
    y = (CANVAS - art.height) // 2
    img.alpha_composite(art, (x, y))
    return img


def write_svg(icon: Image.Image, path: Path, px: int = 144) -> None:
    """favicon.svg that embeds the ACTUAL hero artwork as a data URI.

    Modern browsers (Chrome/Firefox/Edge) prefer the SVG link over the ICO,
    so the SVG must carry the real lungs+stethoscope image — not a redrawn
    vector approximation. The composed tile is rendered to `px` PNG and
    wrapped; its own alpha supplies the rounded corners.
    """
    small = icon.resize((px, px), Image.LANCZOS)
    buf = io.BytesIO()
    small.save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    path.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        '<title>AURA-Dx</title>'
        f'<image width="512" height="512" href="data:image/png;base64,{b64}"/>'
        '</svg>',
        encoding="ascii",
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icon = compose(full_bleed=False)
    apple = compose(full_bleed=True)

    base512 = icon.resize((512, 512), Image.LANCZOS)
    base512.save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    for size in (16, 32):
        icon.resize((size, size), Image.LANCZOS).save(OUT / f"favicon-{size}x{size}.png")

    apple.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")

    write_svg(icon, OUT / "favicon.svg")

    # Sanity report + preview strip (256/48/32/16) on light and dark ground
    ico = Image.open(OUT / "favicon.ico")
    sizes = sorted(ico.info.get("sizes") or [])
    print("ICO frame sizes:", sizes if sizes else "(PIL reports base only)")

    strip_w = (256 + 48 + 32 + 16) + 5 * 12
    preview = Image.new("RGB", (strip_w, 560), (250, 249, 245))
    dark_row = Image.new("RGB", (strip_w, 280), (30, 30, 30))
    preview.paste(dark_row, (0, 280))
    for row_y, bg_row in ((0, preview), (280, None)):
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
