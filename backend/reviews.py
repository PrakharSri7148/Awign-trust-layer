"""Reviewer workflow: which submissions need a human, and recording the decision.

A flag (or the fraud model, or a blocked photo) used to end at a badge; now a reviewer opens the case, looks at the photo and
the live-check evidence, and records approve / reject / needs_retake with a reason. Those are the first REAL labels: the
accuracy report (tools/reportlib/reviews.py) turns them into "how often was each flag upheld".

Who may review is a deployment decision: set REVIEWERS="alice,bob" to allow only those names (case-insensitive); unset
= any non-empty name (the name is self-declared and is NOT authentication; put a gateway or DASHBOARD_TOKEN in front).
"""
import json
import os
from typing import Optional

from sqlmodel import Session, select

from models import Review, Submission

DECISIONS = ("approve", "reject", "needs_retake")
# What a decision says about the submission: approve = it was fine (the flag was a false alarm); the other two = the flag was right.
UPHOLDS_FLAG = {"approve": False, "reject": True, "needs_retake": True}

# Flags that ask for a human. 'info' flags (no_exif, submitted_anyway, ...) and plain quality warnings do not.
REVIEW_FLAGS = {
    "liveness_review_requested", "liveness_unverified", "liveness_failed", "liveness_forged", "liveness_replayed",
    "liveness_expired", "liveness_mismatch", "liveness_review_unearned", "spoof_suspected", "duplicate_photo",
    "near_duplicate_photo", "not_live_capture", "client_verdict_mismatch", "client_dimensions_mismatch", "photo_missing",
    # sensor fusion (fusion/): evidence that the GPS trail and the phone's own sensors/network disagree, or that the trail was reused
    "gps_jump_flat_motion", "flat_motion_while_moving", "arrival_without_approach", "gps_outside_site", "trail_replayed",
    "trail_invalid", "window_raw_mismatch", "ip_country_mismatch", "ip_region_mismatch", "fusion_required_missing",
}


def reviewers_allowed() -> Optional[set]:
    raw = os.environ.get("REVIEWERS", "").strip()
    return {n.strip().lower() for n in raw.split(",") if n.strip()} if raw else None


def needs_review(flags, verdict, status) -> bool:
    return (
        status == "flagged"
        or verdict == "block"
        or any(f in REVIEW_FLAGS or f.startswith("client_missed_") for f in flags)
    )


def review_reasons(flags, verdict, status) -> list:
    """Why a case is in the queue, for the queue's label."""
    why = [f for f in flags if f in REVIEW_FLAGS or f.startswith("client_missed_")]
    if verdict == "block":
        why.insert(0, "photo_blocked")
    if status == "flagged":
        why.insert(0, "fraud_model")
    return why


def validate_review(reviewer: str, decision: str, reason: str):
    """-> error message or None"""
    name = (reviewer or "").strip()
    if not (2 <= len(name) <= 60):
        return "reviewer name must be 2-60 characters"
    allow = reviewers_allowed()
    if allow is not None and name.lower() not in allow:
        return "this name is not on the reviewer list"
    if decision not in DECISIONS:
        return f"decision must be one of {', '.join(DECISIONS)}"
    if decision != "approve" and len((reason or "").strip()) < 3:
        return "a reason is required to reject a case or ask for a retake"
    if len(reason or "") > 1000:
        return "reason is too long (max 1000 characters)"
    return None


def add_review(session: Session, submission_id: int, reviewer: str, decision: str, reason: str) -> Review:
    row = Review(submission_id=submission_id, reviewer=reviewer.strip(), decision=decision, reason=(reason or "").strip())
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def review_dict(r: Review) -> dict:
    return {"id": r.id, "submission_id": r.submission_id, "reviewer": r.reviewer, "decision": r.decision, "reason": r.reason,
            "at": r.created_at.replace(tzinfo=None).isoformat() + "Z" if r.created_at else None}


def latest_by_submission(session: Session) -> dict:
    """{submission_id: latest Review} in one query."""
    out = {}
    for r in session.exec(select(Review).order_by(Review.created_at, Review.id)).all():
        out[r.submission_id] = r
    return out


def attach(data: dict, latest: Optional[Review]) -> dict:
    """Add review fields to a submission response."""
    flags = data.get("quality_flags") or []
    data["review"] = review_dict(latest) if latest else None
    data["needs_review"] = latest is None and needs_review(flags, data.get("photo_verdict"), data.get("status"))
    data["review_reasons"] = review_reasons(flags, data.get("photo_verdict"), data.get("status")) if data["needs_review"] else []
    return data
