"""Server-side handling of a submitted photo: re-check it, fingerprint it, store it."""
import io
import json
import os
from datetime import timedelta
from pathlib import Path

from PIL import Image
from sqlmodel import Session, select

from sqlalchemy import update

from models import LivenessChallenge, Submission
from photo_quality import analyze_image
from photo_quality import liveness as liveness_mod
from photo_quality.analyze import with_check
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
    live_flags, live_info = [], None
    if task.get("face", "off") != "off":
        server, live_flags, live_info = _liveness(server, task, payload, session, sha)
        verdict = server["verdict"]
    flags = [i["id"] for i in server["issues"]]
    flags += live_flags
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
            "evidence": {"exif": exif, "capture": {"source": payload.capture_source, "burst": payload.capture_burst}, "liveness": live_info},
        })),
        "photo_path": str(path),
        "photo_sha256": sha,
        "photo_dhash": dhash,
    }


def _idempotent_retry(session, issued, payload, sha):
    """The time the nonce was first used, when THIS request is a re-send of that very submission (same worker, task, site and
    the identical photo bytes, e.g. after a lost response); else None. A different photo with a spent nonce is still a replay."""
    if issued is None or sha is None or issued.used_at is None or issued.used_by_submission is None:
        return None
    prior = session.get(Submission, issued.used_by_submission)
    if prior is None or prior.photo_sha256 != sha:
        return None
    if (prior.worker_id, prior.task_id, prior.site_id) != (payload.worker_id, payload.task_id, payload.site_id):
        return None
    return liveness_mod.naive_utc(issued.used_at)


def _liveness(server, task, payload, session, sha=None):
    """Validate the liveness evidence against the nonce we issued, add the server's `liveness` check to the report.
    -> (report, flags, info for the case file)"""
    evidence = payload.liveness_evidence
    issued, claimed, retry_at = None, None, None
    nonce = evidence.get("nonce") if isinstance(evidence, dict) else None
    if isinstance(nonce, str) and nonce:
        issued = session.get(LivenessChallenge, nonce)
        retry_at = _idempotent_retry(session, issued, payload, sha)
        if retry_at is not None:
            claimed = None  # already consumed by the SAME photo from the SAME worker/task/site: a retry after a lost response, not a replay
        elif issued and (issued.worker_id, issued.task_id) == (payload.worker_id, payload.task_id) and liveness_mod.utcnow() <= liveness_mod.naive_utc(issued.expires_at) \
                and evidence.get("status") in ("passed", "review"):
            # Atomic single use: only one submission can flip used_at from NULL.
            res = session.execute(update(LivenessChallenge).where(LivenessChallenge.id == nonce, LivenessChallenge.used_at.is_(None))
                                  .values(used_at=liveness_mod.aware_now()))
            claimed = res.rowcount == 1
    # A retry is judged as of the moment the nonce was first used (it was valid then), not as of now.
    validation = liveness_mod.validate_evidence(evidence, issued, worker_id=payload.worker_id, task_id=payload.task_id,
                                                claimed_used=(claimed is False), now=retry_at)
    review_earned = False
    if isinstance(evidence, dict) and evidence.get("status") == "review":
        # "Send for review" must be earned: the server must have issued at least `maxAttempts` challenges to this worker/task recently.
        since = liveness_mod.aware_now() - timedelta(minutes=15)
        n = len(session.exec(select(LivenessChallenge).where(LivenessChallenge.worker_id == payload.worker_id,
                                                              LivenessChallenge.task_id == payload.task_id,
                                                              LivenessChallenge.issued_at >= since)).all())
        review_earned = n >= THRESHOLDS["liveness"]["maxAttempts"]
    check, flags = liveness_mod.build_check(task, payload.capture_source, evidence if isinstance(evidence, dict) else None, validation,
                                            server.get("passive"), review_earned)
    info = {"validation": validation, "nonce_claimed": claimed, "review_earned": review_earned, "idempotent_retry": retry_at is not None,
            "evidence": evidence if isinstance(evidence, dict) else None,  # incl. the signal timeline (a few KB): real captures can be re-evaluated later
            "client_passive": payload.passive_evidence}
    if check is not None:
        server = with_check(server, check, task)
        if claimed and issued is not None:
            pass  # used_by_submission is filled in by the endpoint once the row has an id
    return server, flags, info


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
