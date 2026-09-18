"""Generate the AURA-Dx favicon set from the lung brand mark.

Design: deep forest rounded square (#0E2E24) with a simplified two-lobe lung
silhouette in mint (#EAF6F0) — matches the hero illustration's palette while
staying legible at 16px (spec: clean silhouette over fine detail).

Outputs (frontend-new/public/):
  favicon.ico            16 + 32 + 48 multi-resolution
  favicon-32x32.png
  favicon-16x16.png
  apple-touch-icon.png   180x180, full-bleed background (iOS rounds corners)

Run:  backend/venv/Scripts/python.exe frontend-new/scripts/gen_favicons.py
Geometry mirrors frontend-new/public/favicon.svg (hand-authored vector) so the
SVG and raster sets render the same mark.
"""
from pathlib import Path

from PIL import Image, ImageDraw

S = 4                      # supersample factor (draw at 4x, downscale with LANCZOS)
CANVAS = 512 * S
BG = (14, 46, 36, 255)     # #0E2E24 deep brand forest
LUNG = (234, 246, 240, 255)  # #EAF6F0 mint

OUT = Path(__file__).resolve().parent.parent / "public"


def rounded_rect_layer(rect, radius, angle, center):
    """Draw a rounded rect on its own layer and rotate it about `center`."""
    layer = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([c * S for c in rect], radius=radius * S, fill=LUNG)
    if angle:
        layer = layer.rotate(angle, resample=Image.BICUBIC, center=center)
    return layer


def build_icon(full_bleed: bool) -> Image.Image:
    img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Background tile (apple-touch variant is full-bleed; iOS rounds it itself)
    d.rounded_rectangle(
        [0, 0, CANVAS - 1, CANVAS - 1],
        radius=0 if full_bleed else 115 * S,
        fill=BG,
    )

    center = (CANVAS / 2, CANVAS / 2)

    # Lobes: capsules rotated so the apices converge toward the trachea
    # (classic lung silhouette) and the bases splay outward.
    lobe_w, lobe_h, lobe_r = 150, 250, 75
    img.alpha_composite(
        rounded_rect_layer(
            (172 - lobe_w / 2, 330 - lobe_h / 2, 172 + lobe_w / 2, 330 + lobe_h / 2),
            lobe_r, -18, (172 * S, 330 * S),
        )
    )
    img.alpha_composite(
        rounded_rect_layer(
            (340 - lobe_w / 2, 330 - lobe_h / 2, 340 + lobe_w / 2, 330 + lobe_h / 2),
            lobe_r, 18, (340 * S, 330 * S),
        )
    )

    # Bronchi branching from the trachea base into each lobe (same tilt as
    # their lobe so the shapes read as connected)
    bw, bh, br = 34, 92, 17
    img.alpha_composite(
        rounded_rect_layer(
            (233 - bw / 2, 262 - bh / 2, 233 + bw / 2, 262 + bh / 2),
            br, -28, (233 * S, 262 * S),
        )
    )
    img.alpha_composite(
        rounded_rect_layer(
            (279 - bw / 2, 262 - bh / 2, 279 + bw / 2, 262 + bh / 2),
            br, 28, (279 * S, 262 * S),
        )
    )

    # Trachea (drawn last so it reads as one connected shape)
    d.rounded_rectangle([234 * S, 88 * S, 278 * S, 250 * S], radius=22 * S, fill=LUNG)

    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icon = build_icon(full_bleed=False)
    apple = build_icon(full_bleed=True)

    base512 = icon.resize((512, 512), Image.LANCZOS)

    # Multi-resolution ICO: browsers pick the best frame per context
    base512.save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    for size in (16, 32):
        icon.resize((size, size), Image.LANCZOS).save(OUT / f"favicon-{size}x{size}.png")

    apple.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")

    # Sanity report
    ico = Image.open(OUT / "favicon.ico")
    sizes = sorted(ico.info.get("sizes") or [])
    print("ICO frame sizes:", sizes if sizes else "(PIL reports base only)")

    # Preview strip: 256 / 48 / 32 / 16 side by side on both light and dark
    strip_w = (256 + 48 + 32 + 16) + 5 * 12
    preview = Image.new("RGB", (strip_w, 280), (250, 249, 245))
    x = 12
    for size in (256, 48, 32, 16):
        frame = icon.resize((size, size), Image.LANCZOS)
        preview.paste(frame, (x, (280 - size) // 2), frame)
        x += size + 12
    preview.save(OUT.parent / "favicon-preview.png")
    print("Preview: frontend-new/favicon-preview.png")

    for name in ("favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png"):
        p = OUT / name
        with Image.open(p) as im:
            print(f"{name:24} {im.size} {im.mode} {p.stat().st_size} bytes")


if __name__ == "__main__":
    main()
