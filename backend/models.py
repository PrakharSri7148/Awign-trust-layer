from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


def utcnow():
    return datetime.now(timezone.utc)


class Submission(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    worker_id: str = Field(index=True)
    task_id: str
    site_id: str = Field(index=True)
    timestamp: datetime = Field(default_factory=utcnow, index=True)
    photo_quality_pass: bool
    motion_score: float
    ambient_score: float
    fraud_probability: float
    top_reason: str
    feature_importances: str  # JSON-encoded dict
    status: str
    # Photo quality, as measured by the SERVER (see photo_quality/). The device's own
    # verdict is kept inside photo_report["client"] but is never trusted.
    photo_verdict: str = Field(default="unverified")  # pass | warn | block | unverified
    photo_quality_score: float = Field(default=0.0)
    quality_flags: str = Field(default="[]")  # JSON list: issue ids + evidence flags
    photo_override: bool = Field(default=False)  # worker chose "Submit anyway"
    client_mismatch: bool = Field(default=False)  # device report contradicted the server
    photo_report: str = Field(default="{}")  # JSON: {server, client, evidence}
    photo_path: Optional[str] = Field(default=None)
    photo_sha256: Optional[str] = Field(default=None, index=True)
    photo_dhash: Optional[str] = Field(default=None)
    # Sensor fusion (see fusion/). `motion_score` / `ambient_score` above keep their names but, for rows with
    # fusion_version >= 1, hold motion_consistency / environment_consistency (GPS trail vs phone sensors; network vs the
    # claimed area). fusion_version 0 = a legacy row scored by the old 3-second motion mean + link-speed hash.
    fusion_version: int = Field(default=0)
    motion_known: bool = Field(default=False)  # False = nothing could be compared (unknown is not suspicious)
    env_known: bool = Field(default=False)
    fusion_report: str = Field(default="{}")  # JSON: motion + environment evidence, flags, downsampled trail points
    trail_sha256: Optional[str] = Field(default=None, index=True)  # exact-replay guard for the GPS trail


class SiteFingerprint(SQLModel, table=True):
    site_id: str = Field(primary_key=True)
    fingerprint_vector: str  # JSON-encoded list of floats


class Site(SQLModel, table=True):
    """Where a site really is (the 'claimed area'). Set by an authorised user via PUT /sites/{id}; no site is seeded:
    a made-up demo location would flag every demo submission made from somewhere else."""
    site_id: str = Field(primary_key=True)
    lat: float
    lng: float
    radius_m: float = Field(default=100.0)
    country: Optional[str] = Field(default=None)  # ISO-3166 alpha-2, enables the IP-country check
    label: Optional[str] = Field(default=None)


class SiteNetworkProfile(SQLModel, table=True):
    """What the network usually looks like at a site, learned from ACCEPTED (or reviewer-approved) visits only, so one
    spoofed first submission cannot become the baseline. kind: link | asn | wifi | cell."""
    __table_args__ = (UniqueConstraint("site_id", "kind", "key"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    site_id: str = Field(index=True)
    kind: str
    key: str
    count: int = Field(default=1)
    last_seen: datetime = Field(default_factory=utcnow)


class Visit(SQLModel, table=True):
    """A server-issued session: the trail must fit inside it by the SERVER's clock, and it can be used once."""
    id: str = Field(primary_key=True)
    worker_id: str = Field(index=True)
    task_id: str
    site_id: str
    started_at: datetime = Field(default_factory=utcnow, index=True)
    used_at: Optional[datetime] = Field(default=None)
    submission_id: Optional[int] = Field(default=None)


class LivenessChallenge(SQLModel, table=True):
    """A challenge the server issued (single use). The submission must come back with this id."""
    id: str = Field(primary_key=True)  # the nonce
    worker_id: str = Field(index=True)
    task_id: str
    challenges: str  # JSON list of challenge ids
    issued_at: datetime = Field(default_factory=utcnow, index=True)
    expires_at: datetime
    used_at: Optional[datetime] = Field(default=None)
    used_by_submission: Optional[int] = Field(default=None)


class Review(SQLModel, table=True):
    """A human decision on a submission (the first REAL labels). Several reviews per submission are kept (history);
    the latest one is the outcome. The reviewer is whoever the dashboard says (see reviews.py: REVIEWERS allowlist)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    submission_id: int = Field(index=True)
    reviewer: str = Field(index=True)
    decision: str  # approve | reject | needs_retake
    reason: str = Field(default="")
    created_at: datetime = Field(default_factory=utcnow, index=True)
