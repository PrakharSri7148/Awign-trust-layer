from datetime import datetime, timezone
from typing import Optional

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


class SiteFingerprint(SQLModel, table=True):
    site_id: str = Field(primary_key=True)
    fingerprint_vector: str  # JSON-encoded list of floats
