"""Synthetic test photos."""
import io

import numpy as np
from PIL import Image
from scipy import ndimage


def scene(w=1600, h=1200, seed=1):
    r = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w]
    g = 110 + 40 * xx / w + 20 * yy / h
    for _ in range(50):
        level = r.uniform(30, 230)
        cx, cy = r.uniform(0, w), r.uniform(0, h)
        sw, sh = r.uniform(0.04, 0.24) * w, r.uniform(0.04, 0.24) * h
        if r.random() < 0.35:
            m = ((xx - cx) / (sw / 2)) ** 2 + ((yy - cy) / (sh / 2)) ** 2 <= 1
        else:
            m = (abs(xx - cx) <= sw / 2) & (abs(yy - cy) <= sh / 2)
        g = np.where(m, level + 12 * np.sin(xx * 0.9) * np.cos(yy * 0.7), g)
    return np.clip(g, 0, 255)


def rgb(gray):
    tint = np.array([1.05, 0.98, 0.9])
    return np.clip(gray[..., None] * tint, 0, 255).astype(np.uint8)


def jpeg(arr, quality=92, exif=None):
    buf = io.BytesIO()
    kwargs = {"exif": exif} if exif is not None else {}
    Image.fromarray(arr).save(buf, "JPEG", quality=quality, **kwargs)
    return buf.getvalue()


def good(seed=1, **kw):
    return jpeg(rgb(scene(seed=seed)), **kw)


def blurry(seed=1, **kw):
    return jpeg(rgb(ndimage.uniform_filter(ndimage.uniform_filter(scene(seed=seed), 25), 25)), **kw)


def dark(seed=1, **kw):
    return jpeg(rgb(scene(seed=seed) * 0.15), **kw)


def exif_bytes(taken: str | None, make="Acme", model="Phone 1"):
    e = Image.Exif()
    e[271] = make
    e[272] = model
    if taken:
        e.get_ifd(0x8769)[0x9003] = taken
    return e.tobytes()


FIXTURES = __import__("pathlib").Path(__file__).resolve().parents[2] / "client" / "src" / "lib" / "photoQuality" / "testing" / "fixtures"


def face_photo(size=1200, quality=95):
    """NASA's public-domain astronaut portrait (a real face), enlarged to a realistic size."""
    img = Image.open(FIXTURES / "astronaut.png").convert("RGB").resize((size, size), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()
