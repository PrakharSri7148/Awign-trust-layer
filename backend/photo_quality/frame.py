import io
import math
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageOps

try:  # iPhones save HEIC; browsers usually convert it on upload, but a file picker can deliver it as is
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # optional: without it HEIC photos are rejected as undecodable
    pass

ANALYSIS_MAX = 1280
PATCH_SIZE = 384
MAX_PIXELS = 100_000_000  # refuse decompression bombs


class ImageDecodeError(ValueError):
    pass


@dataclass
class Frame:
    width: int
    height: int
    rgba: np.ndarray  # (h, w, 4) uint8
    gray: np.ndarray  # (h, w) float32 luma 0..255
    native_width: int
    native_height: int
    native_bytes: int | None
    native_mime: str | None
    patches: list = field(default_factory=list)  # native-resolution gray patches (float32 2-D)


def rgb_to_gray(rgb):
    r = rgb[..., 0].astype(np.float32)
    g = rgb[..., 1].astype(np.float32)
    b = rgb[..., 2].astype(np.float32)
    return np.float32(0.299) * r + np.float32(0.587) * g + np.float32(0.114) * b


def analysis_size(width, height, max_side=ANALYSIS_MAX):
    scale = min(1.0, max_side / max(width, height))
    return max(1, int(math.floor(width * scale + 0.5))), max(1, int(math.floor(height * scale + 0.5)))


def patch_origins(width, height, size=PATCH_SIZE):
    pw, ph = min(size, width), min(size, height)

    def snap(v):
        return max(0, int(math.floor(v / 8)) * 8)

    spots = [
        ((width - pw) / 2, (height - ph) / 2),
        (width / 3 - pw / 2, height / 3 - ph / 2),
        (2 * width / 3 - pw / 2, 2 * height / 3 - ph / 2),
    ]
    seen, out = set(), []
    for x, y in spots:
        ox = min(snap(x), max(0, width - pw))
        oy = min(snap(y), max(0, height - ph))
        if (ox, oy) in seen:
            continue
        seen.add((ox, oy))
        out.append((ox, oy, pw, ph))
    return out


def open_image(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        if img.width * img.height > MAX_PIXELS:
            raise ImageDecodeError("Image is too large")
        img.load()
    except ImageDecodeError:
        raise
    except Exception as exc:  # Pillow raises many types for bad input
        raise ImageDecodeError("Could not decode image") from exc
    # Browsers apply EXIF orientation when decoding; do the same.
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")


def build_frame(data: bytes, mime: str | None = None) -> Frame:
    img = open_image(data)
    nw, nh = img.size
    w, h = analysis_size(nw, nh)
    small = img.resize((w, h), Image.Resampling.BILINEAR) if (w, h) != (nw, nh) else img
    rgb = np.asarray(small, dtype=np.uint8)
    rgba = np.dstack([rgb, np.full((h, w), 255, dtype=np.uint8)])
    patches = []
    for ox, oy, pw, ph in patch_origins(nw, nh):
        patches.append(rgb_to_gray(np.asarray(img.crop((ox, oy, ox + pw, oy + ph)), dtype=np.uint8)))
    return Frame(w, h, rgba, rgb_to_gray(rgb), nw, nh, len(data), mime, patches)
