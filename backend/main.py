import json
import mimetypes
import secrets
import threading
from datetime import timedelta
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ValidationError
from sqlmodel import Session, select

from classifier import score_submission
from db import get_session, init_db
import hardening
import reviews as reviews_mod
from models import LivenessChallenge, Review, Site, SiteFingerprint, Submission, Visit
from photo_quality import liveness as liveness_mod
from photo_quality.config import THRESHOLDS, task_config
from photo_quality.face import warm_up as warm_up_face_detector
from photo_quality.frame import ImageDecodeError
from photo_service import MAX_PHOTO_BYTES, process_photo
from fusion import ipctx, pipeline as fusion_pipeline


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
    # The live challenge the device claims it completed (ids, per-challenge results, signal timeline, single-use nonce)
    # and the passive screen/print evidence the camera collected. Both are re-checked by the server, never trusted.
    liveness_evidence: Optional[dict] = None
    passive_evidence: Optional[dict] = None
    gps: Optional[GPS] = None
    motion_samples: List[MotionSample] = []
    network_info: Optional[NetworkInfo] = None
    # Sensor fusion (all optional, so older clients keep working). `visit_id` comes from POST /visits; `trail` is the
    # GPS track + 5 s motion windows recorded while the app was open (fusion/trail.py documents the format); `radio` is
    # only sent by a native client (hashed WiFi/cell identifiers). The server validates all three, none is trusted.
    visit_id: Optional[str] = None
    trail: Optional[Any] = None  # any JSON: a wrong shape becomes the flag trail_invalid, not a rejected submission
    radio: Optional[Any] = None


def to_response(sub: Submission, full: bool = False) -> dict:
    data = sub.model_dump(exclude={"photo_path", "photo_sha256", "photo_dhash", "photo_report", "quality_flags", "fusion_report", "trail_sha256"})
    data["feature_importances"] = json.loads(sub.feature_importances)
    data["quality_flags"] = json.loads(sub.quality_flags or "[]")
    data["has_photo"] = bool(sub.photo_path)
    data["photo_url"] = f"/submissions/{sub.id}/photo" if sub.photo_path else None
    if full:
        # The per-check report is large; the list endpoint leaves it out.
        data["photo_quality"] = json.loads(sub.photo_report or "{}")
        data["fusion"] = json.loads(sub.fusion_report or "{}")
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
    hardening.check_submission_rate(payload.worker_id)
    try:
        # CPU-bound (decode + checks): keep it off the event loop.
        photo = await run_in_threadpool(process_photo, photo_bytes, photo_mime, payload, session)
    except ImageDecodeError as exc:
        raise HTTPException(422, f"Photo could not be read: {exc}") from exc

    # GPS trail vs phone sensors, network vs the claimed area (fusion/). Scores and evidence only: no verdict here.
    # The same worker re-sending the same photo for the same task and site is a RETRY (a lost response on a bad network), not a replay.
    retry = bool(photo.get("photo_sha256")) and session.exec(select(Submission.id).where(
        Submission.photo_sha256 == photo["photo_sha256"], Submission.worker_id == payload.worker_id,
        Submission.task_id == payload.task_id, Submission.site_id == payload.site_id)).first() is not None
    fusion = await run_in_threadpool(fusion_pipeline.run_fusion, session, payload, client_ip=ipctx.client_ip(request), retry=retry)
    photo["quality_flags"] = json.dumps(list(dict.fromkeys(json.loads(photo["quality_flags"]) + fusion["flags"])))
    # The model sees the SERVER's photo verdict, not the device's claim.
    result = score_submission(
        photo["photo_quality_score"], fusion["motion_score"], fusion["ambient_score"],
        photo_issues=json.loads(photo["quality_flags"]),
        motion_known=fusion["motion_known"], env_known=fusion["env_known"],
        motion_reason=fusion["reasons"]["motion"], env_reason=fusion["reasons"]["environment"],
    )

    sub = Submission(
        worker_id=payload.worker_id,
        task_id=payload.task_id,
        site_id=payload.site_id,
        motion_score=fusion["motion_score"],
        ambient_score=fusion["ambient_score"],
        fusion_version=fusion_pipeline.FUSION_VERSION,
        motion_known=fusion["motion_known"],
        env_known=fusion["env_known"],
        fusion_report=json.dumps(fusion["report"]),
        trail_sha256=fusion["trail_sha256"],
        fraud_probability=result["fraud_probability"],
        top_reason=result["top_reason"],
        feature_importances=json.dumps(result["feature_importances"]),
        status="flagged" if result["fraud_probability"] > 0.5 else "accepted",
        **photo,
    )
    session.add(sub)
    session.commit()
    session.refresh(sub)
    # Only an accepted visit teaches the site's network profile; the visit session is tied to this submission.
    fusion_pipeline.record_outcome(session, payload.site_id, fusion["env_keys"], accepted=sub.status == "accepted" and not retry)
    if payload.visit_id:
        visit = session.get(Visit, payload.visit_id)
        if visit is not None and visit.used_at is not None and visit.submission_id is None:
            visit.submission_id = sub.id
            session.add(visit)
            session.commit()
    session.refresh(sub)
    nonce = (payload.liveness_evidence or {}).get("nonce") if isinstance(payload.liveness_evidence, dict) else None
    if isinstance(nonce, str) and nonce:
        row = session.get(LivenessChallenge, nonce)
        if row is not None and row.used_by_submission is None and row.used_at is not None:
            row.used_by_submission = sub.id
            session.add(row)
            session.commit()
            session.refresh(sub)  # the commit expired it
    return reviews_mod.attach(to_response(sub, full=True), None)


class ChallengeRequest(BaseModel):
    worker_id: str
    task_id: str


@app.post("/liveness/challenge")
def issue_liveness_challenge(req: ChallengeRequest, session: Session = Depends(get_session)):
    """Issue a random challenge list and a single-use nonce. The submission must return the nonce with evidence for
    exactly these challenges (stops replaying old evidence; does not stop an injected camera)."""
    task = task_config(req.task_id)
    if task.get("face", "off") != "required":
        raise HTTPException(400, "This task has no live challenge")
    now = liveness_mod.aware_now()
    outstanding = session.exec(select(LivenessChallenge).where(
        LivenessChallenge.worker_id == req.worker_id, LivenessChallenge.task_id == req.task_id,
        LivenessChallenge.used_at.is_(None), LivenessChallenge.issued_at >= now - timedelta(hours=1))).all()
    if len(outstanding) >= liveness_mod.MAX_OUTSTANDING:
        raise HTTPException(429, "Too many challenges requested. Try again later.")
    row = LivenessChallenge(id=secrets.token_urlsafe(18), worker_id=req.worker_id, task_id=req.task_id,
                            challenges=json.dumps(liveness_mod.pick_challenges()), issued_at=now, expires_at=now + liveness_mod.NONCE_TTL)
    session.add(row)
    session.commit()
    L = THRESHOLDS["liveness"]
    return {"id": row.id, "challenges": json.loads(row.challenges), "expires_at": now.__add__(liveness_mod.NONCE_TTL).replace(tzinfo=None).isoformat() + "Z",
            "ttl_s": int(liveness_mod.NONCE_TTL.total_seconds()), "timeout_ms": L["timeoutMs"], "valid_for_ms": L["validForMs"]}


@app.get("/submissions", dependencies=[Depends(hardening.require_dashboard)])
def list_submissions(session: Session = Depends(get_session)):
    rows = session.exec(select(Submission).order_by(Submission.timestamp.desc())).all()
    latest = reviews_mod.latest_by_submission(session)
    return [reviews_mod.attach(to_response(r), latest.get(r.id)) for r in rows]


@app.get("/submissions/{submission_id}", dependencies=[Depends(hardening.require_dashboard)])
def get_submission(submission_id: int, session: Session = Depends(get_session)):
    sub = session.get(Submission, submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return reviews_mod.attach(to_response(sub, full=True), reviews_mod.latest_by_submission(session).get(sub.id))


class ReviewIn(BaseModel):
    reviewer: str
    decision: str
    reason: str = ""


@app.get("/reviews/queue", dependencies=[Depends(hardening.require_dashboard)])
def review_queue(session: Session = Depends(get_session)):
    """Cases that need a human and have no review yet: model-flagged first, then newest."""
    rows = session.exec(select(Submission).order_by(Submission.timestamp.desc())).all()
    latest = reviews_mod.latest_by_submission(session)
    out = [reviews_mod.attach(to_response(r), latest.get(r.id)) for r in rows]
    out = [d for d in out if d["needs_review"]]
    out.sort(key=lambda d: d["status"] != "flagged")  # stable: keeps newest-first within each group
    return out


@app.post("/submissions/{submission_id}/review", dependencies=[Depends(hardening.require_dashboard)])
def review_submission(submission_id: int, body: ReviewIn, session: Session = Depends(get_session)):
    sub = session.get(Submission, submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    err = reviews_mod.validate_review(body.reviewer, body.decision, body.reason)
    if err:
        raise HTTPException(status_code=422 if "not on the reviewer list" not in err else 403, detail=err)
    row = reviews_mod.add_review(session, submission_id, body.reviewer, body.decision, body.reason)
    if body.decision == "approve":
        fusion_pipeline.approve_into_profile(session, sub)  # the model flagged it, a human said it was fine: learn that network
    return reviews_mod.attach(to_response(sub, full=True), row)


@app.get("/submissions/{submission_id}/reviews", dependencies=[Depends(hardening.require_dashboard)])
def submission_reviews(submission_id: int, session: Session = Depends(get_session)):
    if session.get(Submission, submission_id) is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    rows = session.exec(select(Review).where(Review.submission_id == submission_id).order_by(Review.created_at, Review.id)).all()
    return [reviews_mod.review_dict(r) for r in rows]


@app.get("/submissions/{submission_id}/photo", dependencies=[Depends(hardening.require_dashboard)])
def get_submission_photo(submission_id: int, session: Session = Depends(get_session)):
    sub = session.get(Submission, submission_id)
    if sub is None or not sub.photo_path or not Path(sub.photo_path).is_file():
        raise HTTPException(status_code=404, detail="No photo stored for this submission")
    return FileResponse(sub.photo_path, media_type=mimetypes.guess_type(sub.photo_path)[0] or "application/octet-stream")


@app.post("/sites/{site_id}/reset-fingerprint", dependencies=[Depends(hardening.require_dashboard)])
def reset_fingerprint(site_id: str, session: Session = Depends(get_session)):
    fp = session.get(SiteFingerprint, site_id)
    if fp is not None:
        session.delete(fp)
        session.commit()
    n = fusion_pipeline.reset_profile(session, site_id)  # the learned network profile (fusion) starts again too
    return {"site_id": site_id, "deleted": fp is not None or n > 0, "profile_rows": n}


class VisitIn(BaseModel):
    worker_id: str
    task_id: str
    site_id: str


@app.post("/visits")
def start_visit(req: VisitIn, session: Session = Depends(get_session)):
    """Open a visit session (worker endpoint, like /liveness/challenge). The trail the device records afterwards must fit inside
    it by THIS server's clock, and a visit carries one submission, which is what stops a recorded genuine trail being replayed."""
    hardening.check_submission_rate("visit:" + req.worker_id)
    return fusion_pipeline.start_visit(session, req.worker_id, req.task_id, req.site_id)


class SiteIn(BaseModel):
    lat: float
    lng: float
    radius_m: float = 100.0
    country: Optional[str] = None
    label: Optional[str] = None


def _site_dict(s: Site) -> dict:
    return {"site_id": s.site_id, "lat": s.lat, "lng": s.lng, "radius_m": s.radius_m, "country": s.country, "label": s.label}


@app.get("/sites", dependencies=[Depends(hardening.require_dashboard)])
def list_sites(session: Session = Depends(get_session)):
    return [_site_dict(s) for s in session.exec(select(Site).order_by(Site.site_id)).all()]


@app.get("/sites/{site_id}", dependencies=[Depends(hardening.require_dashboard)])
def get_site(site_id: str, session: Session = Depends(get_session)):
    s = session.get(Site, site_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Site has no location yet")
    return _site_dict(s)


@app.put("/sites/{site_id}", dependencies=[Depends(hardening.require_dashboard)])
def put_site(site_id: str, body: SiteIn, session: Session = Depends(get_session)):
    """Where the site really is, so the GPS trail can be checked against it. Radius in metres, country as ISO-3166 alpha-2."""
    if not (-90 <= body.lat <= 90 and -180 <= body.lng <= 180):
        raise HTTPException(422, "lat/lng out of range")
    if not (5 <= body.radius_m <= 5000):
        raise HTTPException(422, "radius_m must be between 5 and 5000")
    country = (body.country or "").strip().upper() or None
    if country is not None and len(country) != 2:
        raise HTTPException(422, "country must be a two-letter ISO code")
    s = session.get(Site, site_id) or Site(site_id=site_id, lat=body.lat, lng=body.lng)
    s.lat, s.lng, s.radius_m, s.country, s.label = body.lat, body.lng, body.radius_m, country, body.label
    session.add(s)
    session.commit()
    return _site_dict(s)
