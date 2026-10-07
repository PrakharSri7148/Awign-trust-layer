"""Server-side handling of a submitted photo: re-check it, fingerprint it, store it."""
import io
import json
import os
from pathlib import Path

from PIL import Image
from sqlmodel import Session, select

from models import Submission
from photo_quality import analyze_image
from photo_quality.compare import compare_reports
from photo_quality.config import THRESHOLDS, V_BLOCK, task_config
from photo_quality.evidence import (
    NEAR_DUPLICATE_BITS,
    dhash_hex,
    exif_flags,
    hamming_hex,
    read_exif,
    sha256_hex,
)

UPLOAD_DIR = Path(os.environ.get("PHOTO_DIR", Path(__file__).resolve().parent / "uploads"))
MAX_PHOTO_BYTES = int(os.environ.get("MAX_PHOTO_BYTES", 25 * 1024 * 1024))
# 1 (default): a submission without a photo cannot be verified and is flagged.
# 0: legacy mode, trust the device's own photo_quality_pass boolean.
PHOTO_REQUIRED = os.environ.get("PHOTO_REQUIRED", "1") != "0"

_EXT = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif", "BMP": ".bmp"}


def _clean(obj):
    """Make a report JSON-safe (numpy scalars -> Python)."""
    return json.loads(json.dumps(obj, default=lambda o: o.item() if hasattr(o, "item") else str(o)))


def process_photo(data, mime, payload, session: Session) -> dict:
    """Returns the photo-related columns for a new Submission."""
    if data is None:
        return _without_photo(payload)

    client = payload.photo_quality
    server = analyze_image(data, mime, task_config(payload.task_id))  # raises ImageDecodeError on bad input
    verdict = server["verdict"]
    sha = sha256_hex(data)
    dhash = dhash_hex(data)
    exif = read_exif(data)

    task = task_config(payload.task_id)
    from_camera = payload.capture_source == "camera"
    flags = [i["id"] for i in server["issues"]]
    if (server["checks"].get("face") or {}).get("details", {}).get("unchecked"):
        flags.append("face_unchecked")  # no detector on the server: the claim is unverified
    # Frames grabbed from the in-app camera are canvas-encoded and carry no EXIF: that is expected.
    flags += [f for f in exif_flags(exif) if not (from_camera and f == "no_exif")]
    sensor = (client or {}).get("sensor") if client else None
    if sensor:
        t = THRESHOLDS["shake"]["sensor"]
        if (sensor.get("rotation_rms") or 0) >= t["rotWarn"] or (sensor.get("accel_rms") or 0) >= t["accWarn"]:
            flags.append("camera_shake_reported")  # the phone's own sensors say it was moving (device-reported)
    if task.get("live") and not from_camera:
        flags.append("not_live_capture")  # a live-capture task answered with a picked file
    flags += _duplicate_flags(session, sha, dhash, payload)
    mismatch = [f for f in compare_reports(client, server) if f != "client_report_missing"] if client else ["client_report_missing"]
    flags += mismatch
    if payload.photo_override and verdict != V_BLOCK:
        flags.append("submitted_anyway")

    path = _store(data, sha)
    return {
        "photo_quality_pass": verdict != V_BLOCK,
        "photo_verdict": verdict,
        "photo_quality_score": float(server["qualityScore"]),
        "quality_flags": json.dumps(list(dict.fromkeys(flags))),
        "photo_override": bool(payload.photo_override),
        "client_mismatch": any(f.startswith("client_") and f != "client_report_missing" for f in mismatch),
        "photo_report": json.dumps(_clean({
            "server": server,
            "client": client,
            "evidence": {"exif": exif, "capture": {"source": payload.capture_source, "burst": payload.capture_burst}},
        })),
        "photo_path": str(path),
        "photo_sha256": sha,
        "photo_dhash": dhash,
    }


def _without_photo(payload) -> dict:
    if PHOTO_REQUIRED:
        passed, flag = False, "photo_missing"
    else:
        passed, flag = bool(payload.photo_quality_pass), "photo_unverified"
    return {
        "photo_quality_pass": passed,
        "photo_verdict": "unverified",
        # Legacy trust mode: the device's pass/fail stands in for the score. Otherwise nothing is known.
        "photo_quality_score": 1.0 if passed else 0.0,
        "quality_flags": json.dumps([flag]),
        "photo_override": bool(payload.photo_override),
        "client_mismatch": False,
        "photo_report": json.dumps({"server": None, "client": payload.photo_quality, "evidence": {}}),
        "photo_path": None,
        "photo_sha256": None,
        "photo_dhash": None,
    }


def _duplicate_flags(session: Session, sha: str, dhash: str, payload) -> list[str]:
    """Same photo seen before. The same worker re-sending the same photo for the same
    task and site is a retry (e.g. a lost response), not reuse."""
    flags = []
    prior = session.exec(select(Submission).where(Submission.photo_sha256.is_not(None))).all()
    for s in prior:
        retry = (s.worker_id, s.task_id, s.site_id) == (payload.worker_id, payload.task_id, payload.site_id)
        if s.photo_sha256 == sha:
            if not retry:
                flags.append("duplicate_photo")
        elif s.photo_dhash and not retry and hamming_hex(s.photo_dhash, dhash) <= NEAR_DUPLICATE_BITS:
            flags.append("near_duplicate_photo")
    return flags


def _store(data: bytes, sha: str) -> Path:
    ext = _EXT.get(Image.open(io.BytesIO(data)).format or "", ".jpg")
    folder = UPLOAD_DIR / sha[:2]
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{sha}{ext}"
    if not path.exists():
        path.write_bytes(data)
    return path
