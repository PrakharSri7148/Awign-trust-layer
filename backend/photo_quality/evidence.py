"""Facts about the photo file itself: identity (hash / perceptual hash) and EXIF."""
import hashlib
import io
from datetime import datetime, timedelta, timezone

import numpy as np
from PIL import Image

from .frame import open_image

EXIF_IFD = 0x8769
TAG_MAKE, TAG_MODEL, TAG_DATETIME = 271, 272, 306
TAG_DATETIME_ORIGINAL = 0x9003
OLD_PHOTO_AFTER = timedelta(hours=48)
NEAR_DUPLICATE_BITS = 5


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def dhash_hex(data: bytes) -> str:
    """64-bit difference hash: survives resizing, recompression and small edits."""
    img = open_image(data).convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    a = np.asarray(img, dtype=np.int16)
    bits = (a[:, 1:] > a[:, :-1]).ravel()
    return f"{int(''.join('1' if b else '0' for b in bits), 2):016x}"


def hamming_hex(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def _parse_exif_time(value):
    try:
        return datetime.strptime(str(value).strip(), "%Y:%m:%d %H:%M:%S")
    except (ValueError, TypeError):
        return None


def read_exif(data: bytes) -> dict:
    try:
        exif = Image.open(io.BytesIO(data)).getexif()
        sub = exif.get_ifd(EXIF_IFD) if exif else {}
    except Exception:
        return {"present": False}
    make = (exif.get(TAG_MAKE) or "").strip() if exif else ""
    model = (exif.get(TAG_MODEL) or "").strip() if exif else ""
    taken = _parse_exif_time(sub.get(TAG_DATETIME_ORIGINAL) or (exif.get(TAG_DATETIME) if exif else None))
    return {
        "present": bool(make or model or taken),
        "make": make or None,
        "model": model or None,
        "taken_at": taken.isoformat() if taken else None,  # camera-local, no timezone in EXIF
    }


def exif_flags(exif: dict, now: datetime | None = None) -> list[str]:
    flags = []
    if not exif.get("present"):
        flags.append("no_exif")  # screenshots, edited or forwarded copies strip it
    elif exif.get("taken_at"):
        now = now or datetime.now(timezone.utc).replace(tzinfo=None)
        taken = datetime.fromisoformat(exif["taken_at"])
        # EXIF time has no timezone: allow for up to +-14h before calling a photo old.
        if now - taken > OLD_PHOTO_AFTER + timedelta(hours=14):
            flags.append("old_photo")
    return flags
