import json
import mimetypes
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ValidationError
from sqlmodel import Session, select

from classifier import score_submission
from db import get_session, init_db
from models import SiteFingerprint, Submission
from photo_quality.face import warm_up as warm_up_face_detector
from photo_quality.frame import ImageDecodeError
from photo_service import MAX_PHOTO_BYTES, process_photo
from signals import compute_ambient_score, compute_motion_score


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    threading.Thread(target=warm_up_face_detector, daemon=True).start()
    yield


app = FastAPI(title="trust-layer", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    # Also allow the Vite dev server when opened via a LAN IP from a phone.
    allow_origin_regex=r"https?://(\d{1,3}\.){3}\d{1,3}:517[34]",
    allow_methods=["*"],
    allow_headers=["*"],
)


class GPS(BaseModel):
    lat: float
    lng: float


class MotionSample(BaseModel):
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    t: Optional[float] = None


class NetworkInfo(BaseModel):
    effectiveType: Optional[str] = None
    downlink: Optional[float] = None
    rtt: Optional[float] = None


class SubmissionIn(BaseModel):
    worker_id: str
    task_id: str
    site_id: str
    # Legacy: only used when the server has no photo to check and PHOTO_REQUIRED=0.
    photo_quality_pass: bool = False
    # What the device measured about its own photo (advisory; the server re-checks).
    photo_quality: Optional[dict] = None
    photo_override: bool = False  # worker pressed "Submit anyway" on a warning
    # Where the photo came from: 'camera' (the in-app live viewfinder) or 'file' (system
    # picker). Self-reported by the device, so advisory like the rest of photo_quality.
    capture_source: str = "file"
    capture_burst: Optional[dict] = None
    gps: Optional[GPS] = None
    motion_samples: List[MotionSample] = []
    network_info: Optional[NetworkInfo] = None


def to_response(sub: Submission, full: bool = False) -> dict:
    data = sub.model_dump(exclude={"photo_path", "photo_sha256", "photo_dhash", "photo_report", "quality_flags"})
    data["feature_importances"] = json.loads(sub.feature_importances)
    data["quality_flags"] = json.loads(sub.quality_flags or "[]")
    data["has_photo"] = bool(sub.photo_path)
    data["photo_url"] = f"/submissions/{sub.id}/photo" if sub.photo_path else None
    if full:
        # The per-check report is large; the list endpoint leaves it out.
        data["photo_quality"] = json.loads(sub.photo_report or "{}")
    if sub.timestamp is not None:
        # SQLite drops tzinfo; timestamps are stored as UTC.
        data["timestamp"] = sub.timestamp.replace(tzinfo=None).isoformat() + "Z"
    return data


async def read_submission(request: Request):
    """Accepts a form (JSON `payload` field + optional `photo` file) or a plain JSON body (no photo)."""
    try:
        ctype = request.headers.get("content-type", "")
        if ctype.startswith(("multipart/form-data", "application/x-www-form-urlencoded")):
            form = await request.form()
            raw = form.get("payload")
            if raw is None:
                raise HTTPException(422, "Missing 'payload' form field")
            payload = SubmissionIn.model_validate_json(raw)
            upload = form.get("photo")
            data = None
            if upload is not None and hasattr(upload, "read"):
                data = await upload.read(MAX_PHOTO_BYTES + 1)
                if len(data) > MAX_PHOTO_BYTES:
                    raise HTTPException(413, f"Photo is larger than {MAX_PHOTO_BYTES // (1024 * 1024)} MB")
                return payload, data or None, upload.content_type
            return payload, None, None
        return SubmissionIn.model_validate(await request.json()), None, None
    except ValidationError as exc:
        raise HTTPException(422, json.loads(exc.json())) from exc


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/submissions")
async def create_submission(request: Request, session: Session = Depends(get_session)):
    payload, photo_bytes, photo_mime = await read_submission(request)
    samples = [s.model_dump() for s in payload.motion_samples]
    gps = payload.gps.model_dump() if payload.gps else None
    network_info = payload.network_info.model_dump() if payload.network_info else {}

    try:
        # CPU-bound (decode + checks): keep it off the event loop.
        photo = await run_in_threadpool(process_photo, photo_bytes, photo_mime, payload, session)
    except ImageDecodeError as exc:
        raise HTTPException(422, f"Photo could not be read: {exc}") from exc

    motion_score = compute_motion_score(samples, gps)
    ambient_score = compute_ambient_score(payload.site_id, network_info, session)
    # The model sees the SERVER's photo verdict, not the device's claim.
    result = score_submission(
        photo["photo_quality_score"], motion_score, ambient_score,
        photo_issues=json.loads(photo["quality_flags"]),
    )

    sub = Submission(
        worker_id=payload.worker_id,
        task_id=payload.task_id,
        site_id=payload.site_id,
        motion_score=motion_score,
        ambient_score=ambient_score,
        fraud_probability=result["fraud_probability"],
        top_reason=result["top_reason"],
        feature_importances=json.dumps(result["feature_importances"]),
        status="flagged" if result["fraud_probability"] > 0.5 else "accepted",
        **photo,
    )
    session.add(sub)
    session.commit()
    session.refresh(sub)
    return to_response(sub, full=True)


@app.get("/submissions")
def list_submissions(session: Session = Depends(get_session)):
    rows = session.exec(select(Submission).order_by(Submission.timestamp.desc())).all()
    return [to_response(r) for r in rows]


@app.get("/submissions/{submission_id}")
def get_submission(submission_id: int, session: Session = Depends(get_session)):
    sub = session.get(Submission, submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return to_response(sub, full=True)


@app.get("/submissions/{submission_id}/photo")
def get_submission_photo(submission_id: int, session: Session = Depends(get_session)):
    sub = session.get(Submission, submission_id)
    if sub is None or not sub.photo_path or not Path(sub.photo_path).is_file():
        raise HTTPException(status_code=404, detail="No photo stored for this submission")
    return FileResponse(sub.photo_path, media_type=mimetypes.guess_type(sub.photo_path)[0] or "application/octet-stream")


@app.post("/sites/{site_id}/reset-fingerprint")
def reset_fingerprint(site_id: str, session: Session = Depends(get_session)):
    fp = session.get(SiteFingerprint, site_id)
    if fp is None:
        return {"site_id": site_id, "deleted": False}
    session.delete(fp)
    session.commit()
    return {"site_id": site_id, "deleted": True}
