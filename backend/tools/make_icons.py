"""Draw the Android app icons from the project's logo (client/src/components/ui/Logo.jsx: a shield with a pulse line), deterministically.

    cd backend && .venv/bin/python tools/make_icons.py [--out ../client/public/icons]

icon-192.png and icon-512.png (purpose 'any') and icon-maskable-512.png: the launcher crops a maskable icon to a circle or squircle, so the picture
there sits inside the centre 60% of the square. Uses Pillow and numpy (already dependencies).
"""
import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

BG = (5, 7, 13)          # --bg #05070d
CYAN, VIOLET = (34, 211, 238), (139, 92, 246)
SS = 4                   # supersampling for smooth edges


def _bezier(p0, p1, p2, p3, n=24):
    return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3)) for t in (i / n for i in range(n + 1))]


def shield():
    """The Logo.jsx shield path in its 32x32 box: M16 2.5 4.5 7 v8.2 c0 7 4.7 12.2 11.5 14.3 6.8-2.1 11.5-7.3 11.5-14.3 V7 Z."""
    pts = [(16, 2.5), (4.5, 7), (4.5, 15.2)]
    pts += _bezier((4.5, 15.2), (4.5, 22.2), (9.2, 27.4), (16, 29.5))[1:]
    pts += _bezier((16, 29.5), (22.8, 27.4), (27.5, 22.2), (27.5, 15.2))[1:]
    pts += [(27.5, 7), (16, 2.5)]
    return pts


PULSE = [(10, 14), (14, 14), (16, 18), (19, 10), (20.5, 14), (23, 14)]


def draw_icon(size: int, content: float) -> Image.Image:
    """content: the share of the square the 32x32 logo occupies (1.0 = edge to edge; 0.6 for a maskable icon)."""
    big = size * SS
    scale = big * content / 32.0
    off = (big - 32 * scale) / 2.0
    xy = lambda p: (off + p[0] * scale, off + p[1] * scale)  # noqa: E731

    mask = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(mask)
    d.line([xy(p) for p in shield()], fill=255, width=max(2, int(1.8 * scale)), joint="curve")
    x0, y0 = xy((16, 2.5))  # close the outline cleanly where it starts and ends (a plain line join leaves a notch)
    r0 = max(1, int(1.8 * scale)) / 2
    d.ellipse([x0 - r0, y0 - r0, x0 + r0, y0 + r0], fill=255)
    d.line([xy(p) for p in PULSE], fill=255, width=max(2, int(1.6 * scale)), joint="curve")
    for c in ((10, 14), (23, 14)):
        x, y = xy(c)
        r = 1.4 * scale
        d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    # the diagonal cyan -> violet gradient of the logo (from (4,2) to (28,30) in logo units)
    yy, xx = np.mgrid[0:big, 0:big].astype(np.float32)
    ax, ay, bx, by = (off + 4 * scale), (off + 2 * scale), (off + 28 * scale), (off + 30 * scale)
    t = np.clip(((xx - ax) * (bx - ax) + (yy - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2), 0, 1)[..., None]
    grad = (np.array(CYAN, np.float32) * (1 - t) + np.array(VIOLET, np.float32) * t).astype(np.uint8)
    layer = Image.fromarray(grad, "RGB")
    base = Image.new("RGB", (big, big), BG)
    # a faint cyan fill inside the shield, as in the logo
    fill = Image.new("L", (big, big), 0)
    ImageDraw.Draw(fill).polygon([xy(p) for p in shield()], fill=22)
    base.paste(Image.new("RGB", (big, big), CYAN), (0, 0), fill)
    base.paste(layer, (0, 0), mask)
    return base.resize((size, size), Image.LANCZOS)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[2] / "client" / "public" / "icons"))
    a = ap.parse_args(argv)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for name, size, content in (("icon-192.png", 192, 0.86), ("icon-512.png", 512, 0.86), ("icon-maskable-512.png", 512, 0.58), ("apple-touch-icon.png", 180, 0.86)):
        draw_icon(size, content).save(out / name, optimize=True)
        print(f"wrote {out / name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
