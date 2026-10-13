"""Generate the Open Graph / Twitter card image.

Referenced from index.html as /og-image.png. A link shared on Facebook,
LinkedIn or X renders as a bare URL without it, so it has to exist and be the
right shape -- 1200x630, under the ~5MB most scrapers accept, and under 8MB so
the whole card is fetched cheaply.

Run after changing the brand green or the wordmark:

    python frontend-new/scripts/gen_og_image.py

Pillow. Writes to frontend-new/public/og-image.png, which Vite copies verbatim
into dist. No network, no fonts to install -- it draws with the shapes Pillow
provides and falls back to the bundled default bitmap font, because a card whose
typeface differs from the site is better than a card that fails to build.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
OUT = Path(__file__).resolve().parent.parent / "public" / "og-image.png"

# From index.css @theme. Keeping these here rather than reading the CSS avoids a
# Tailwind build dependency in a script that has to run standalone.
FOREST = (14, 46, 36)      # --aura-forest, the darkest brand green
FOREST_LIGHT = (47, 107, 84)
MINT = (60, 184, 122)      # brand green #3cb87a
MINT_SOFT = (158, 223, 193)
WHITE = (255, 255, 255)


def font(size: int):
    """Largest available font at `size`, or None if Pillow has no font at all."""
    for name in (
        "arialbd.ttf", "arial.ttf",          # Windows
        "DejaVuSans-Bold.ttf", "DejaVuSans.ttf",  # Linux
        "Helvetica.ttc",                      # macOS
    ):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main() -> None:
    img = Image.new("RGB", (W, H), FOREST)
    d = ImageDraw.Draw(img)

    # Vertical gradient, deepest at the bottom so the wordmark sits on the
    # lighter end and stays legible.
    for y in range(H):
        t = y / (H - 1)
        d.line(
            [(0, y), (W, y)],
            fill=tuple(
                int(FOREST_LIGHT[i] + (FOREST[i] - FOREST_LIGHT[i]) * t)
                for i in range(3)
            ),
        )

    # Decorative dot field on the right, matching the .aura-dots pattern in
    # index.css. Fades out toward the text block so it reads as texture rather
    # than as noise behind the words.
    spacing, radius = 34, 5
    for gy in range(0, H, spacing):
        for gx in range(int(W * 0.55), W, spacing):
            dx = (gx - W * 0.55) / (W * 0.45)
            dy = abs(gy - H * 0.42) / (H * 0.58)
            falloff = max(0.0, 1.0 - (dx + dy) / 1.6)
            if falloff <= 0.05:
                continue
            a = int(90 * falloff)
            d.ellipse(
                [gx - radius, gy - radius, gx + radius, gy + radius],
                fill=tuple(int(c + (MINT[i] - c) * (a / 255)) for i, c in enumerate(FOREST)),
            )

    # Breath waveform across the lower third -- the app's core visual motif.
    centre, amp, wavelength = int(H * 0.70), 62, 150
    points = []
    for x in range(0, W + 1, 3):
        import math
        envelope = math.sin(math.pi * x / W) ** 0.6
        v = (
            math.sin(x / wavelength * 2 * math.pi) * 0.55
            + math.sin(x / (wavelength * 0.42) * 2 * math.pi) * 0.30
            + math.sin(x / (wavelength * 0.18) * 2 * math.pi) * 0.15
        )
        points.append((x, centre - int(v * amp * envelope)))
    d.line(points, fill=MINT_SOFT, width=5, joint="curve")

    wordmark = font(104)
    tagline_f = font(40)
    sub_f = font(27)

    x = 84

    # Accent bar above the wordmark, so the eye lands there first.
    d.rectangle([x, 96, x + 92, 104], fill=MINT)

    d.text((x, 140), "AURA-Dx", font=wordmark, fill=WHITE)
    d.text((x, 274), "Acoustic Unit for Respiratory Assessment", font=tagline_f, fill=MINT_SOFT)
    d.text((x, 348), "AI-assisted screening for COPD, Pneumonia and healthy lungs", font=sub_f, fill=MINT)

    d.rectangle([x, H - 118, x + 320, H - 114], fill=(60, 90, 78))
    d.text((x, H - 96), "University of Rizal System  ·  Research prototype", font=sub_f, fill=MINT_SOFT)

    img.save(OUT, "PNG", optimize=True)
    size = OUT.stat().st_size
    print(f"wrote {OUT.relative_to(OUT.parents[3])}  {W}x{H}  {size // 1024} KB")
    if size > 5 * 1024 * 1024:
        print("WARNING: over 5MB; some scrapers will drop the card.")


if __name__ == "__main__":
    main()
