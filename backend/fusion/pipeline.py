"""F5: the glue between the API and the pure engines. Everything that touches the database or the request lives here.

    start_visit(...)            POST /visits
    run_fusion(...)             called by create_submission: parse + validate the trail, motion + environment engines
    record_outcome(...)         after the verdict: teach the site profile (accepted visits only)
    approve_into_profile(...)   a reviewer approved a flagged case: its network is now known to be fine
    reset_profile(...)          POST /sites/{id}/reset-fingerprint

Nothing here sets a submission's status: the classifier does.
"""
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import update
from sqlmodel import Session, select

from models import Site, SiteNetworkProfile, Submission, Visit

from . import config as C
from . import consistency, environment, ipctx, trail as trail_mod

FUSION_VERSION = 1
POINTS_KEPT = 120  # downsampled trail points stored for the case-file drawing (removed by tools/purge_trails.py)


def _utcnow():
    return datetime.now(timezone.utc)


def _ms(dt):
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp() * 1000.0


def start_visit(session: Session, worker_id: str, task_id: str, site_id: str) -> dict:
    now = _utcnow()
    v = Visit(id=secrets.token_urlsafe(18), worker_id=worker_id, task_id=task_id, site_id=site_id, started_at=now)
    session.add(v)
    session.commit()
    return {"visit_id": v.id, "server_time_ms": int(_ms(now)), "max_trail_s": C.TRAIL["maxTrailS"],
            "fix_interval_s": C.TRAIL["fixIntervalS"], "window_s": C.TRAIL["windowS"]}


def load_profile(session: Session, site_id: str) -> dict:
    prof = {}
    for r in session.exec(select(SiteNetworkProfile).where(SiteNetworkProfile.site_id == site_id)).all():
        prof.setdefault(r.kind, {})[r.key] = r.count
    return prof


def _claim_visit(session, payload, now, retry=False):
    """-> (visit_started_ms or None, flags). The visit is single-use: the atomic UPDATE lets exactly one submission win.
    `retry`: the same worker re-sent the same photo for the same task and site (a lost response): that is not a replay."""
    vid = payload.visit_id
    if not vid:
        return None, ["visit_unverified"]
    v = session.get(Visit, vid)
    # the approach is to a SITE by a WORKER: switching task after walking there must not lose the trail
    if v is None or (v.worker_id, v.site_id) != (payload.worker_id, payload.site_id):
        return None, ["visit_unverified"]
    if (now - v.started_at.replace(tzinfo=timezone.utc)) > timedelta(hours=C.TRAIL["visitTtlH"]):
        return None, ["visit_unverified"]
    res = session.execute(update(Visit).where(Visit.id == vid, Visit.used_at.is_(None)).values(used_at=now))
    session.commit()
    if res.rowcount != 1:
        return _ms(v.started_at), ([] if retry else ["trail_replayed"])  # the same visit already carried a submission
    return _ms(v.started_at), []


def _trail_sha(trail):
    body = json.dumps([[f["t"], f["lat"], f["lng"]] for f in trail["fixes"]], separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest() if trail["fixes"] else None


def _points(trail):
    fs = trail["fixes"]
    if not fs:
        return []
    step = max(1, len(fs) // POINTS_KEPT)
    pts = fs[::step]
    t0 = fs[0]["t"]
    return [[round((f["t"] - t0) / 1000.0, 1), round(f["lat"], 6), round(f["lng"], 6), None if f["acc"] is None else round(f["acc"], 1)] for f in pts]


def _mask_ip(ip):
    if not ip:
        return None
    if ":" in ip:
        return ":".join(ip.split(":")[:3]) + "::"
    parts = ip.split(".")
    return ".".join(parts[:3] + ["0"]) if len(parts) == 4 else None


def run_fusion(session: Session, payload, *, client_ip=None, now=None, retry=False) -> dict:
    now = now or _utcnow()
    now_ms = _ms(now)
    flags = []

    trail, f = trail_mod.parse(payload.trail)
    flags += f
    source = "trail" if trail else "none"
    sha = None
    if trail is not None:
        visit_start, vf = _claim_visit(session, payload, now, retry)
        flags += vf
        if visit_start is not None:
            tf = trail_mod.check_times(trail, visit_start, now_ms)
            flags += tf
            if tf:
                trail = None  # the device's clock claims do not fit the server's: ignored, and flagged
        if trail is not None:
            sha = _trail_sha(trail)
            if sha and not retry and session.exec(select(Submission.id).where(Submission.trail_sha256 == sha)).first() is not None:
                flags.append("trail_replayed")
                trail = None
    if trail is None:
        gps = payload.gps.model_dump() if payload.gps else None
        legacy = trail_mod.legacy_trail(gps)
        if legacy:
            trail, source = legacy, "legacy_gps"
        sha = None if trail is None or source == "legacy_gps" else sha

    site_row = session.get(Site, payload.site_id)
    site = None if site_row is None else {"lat": site_row.lat, "lng": site_row.lng, "radius_m": site_row.radius_m, "country": site_row.country}

    raw = None
    if trail and trail.get("time_origin") is not None and payload.motion_samples:
        raw = {"time_origin": trail["time_origin"], "samples": [s.model_dump() for s in payload.motion_samples]}
    cons = consistency.evaluate(trail or {}, site, raw)

    provider = ipctx.get_provider()
    ip_ctx = provider.lookup(client_ip) if client_ip else None
    ip = ip_ctx.as_dict() if ip_ctx else None
    net = payload.network_info.model_dump() if payload.network_info else {}
    env = environment.evaluate(site=site, network_info=net, profile=load_profile(session, payload.site_id), ip=ip,
                               tz_offset_min=(trail or {}).get("env", {}).get("tz_offset_min"), radio=payload.radio if isinstance(payload.radio, dict) else None)

    policy = C.task_policy(payload.task_id)
    notes = []
    if not (cons["motion_known"] and cons["sensor_used"]):
        # The phone's movement was not compared with the GPS trail (no motion data, no trail, a trail too short). A GPS-only check
        # against the site may still have run: that is 'known' for the score, but it is not the comparison this signal is about.
        flags.append("fusion_insufficient_evidence")
        notes.append("Not enough sensor data to compare the phone's movement with the GPS trail")
        if policy == "required":
            flags.append("fusion_required_missing")
    flags += cons["flags"] + env["flags"]
    flags = list(dict.fromkeys(flags))

    report = {
        "version": FUSION_VERSION, "source": source, "policy": policy, "flags": flags,
        "motion": {"score": cons["motion_consistency"], "known": cons["motion_known"], "sensor_used": cons["sensor_used"],
                   "penalties": cons["penalties"], "reason": cons["reason"], "evidence": cons["evidence"]},
        "environment": {"score": env["environment_consistency"], "known": env["environment_known"], "penalties": env["penalties"],
                        "reason": env["reason"], "components": env["components"], "keys": env["keys"]},
        "ip": None if not ip else {k: ip.get(k) for k in ("country", "region", "city", "asn", "org", "private")} | {"ip": _mask_ip(ip.get("ip")), "provider": provider.name},
        "sensors": (trail or {}).get("sensors") or {},
        "trail": {"points": _points(trail) if trail else [], "span_s": cons["evidence"]["duration_s"]},
        "site": None if site is None else {"lat": site["lat"], "lng": site["lng"], "radius_m": site["radius_m"]},
        "notes": notes,
    }
    return {
        "motion_score": cons["motion_consistency"], "ambient_score": env["environment_consistency"],
        "motion_known": cons["motion_known"], "env_known": env["environment_known"],
        "flags": flags, "report": report, "trail_sha256": sha,
        "reasons": {"motion": cons["reason"], "environment": env["reason"]},
        "env_keys": env["keys"],
    }


def _bump(session, site_id, kind, key, now):
    row = session.exec(select(SiteNetworkProfile).where(SiteNetworkProfile.site_id == site_id, SiteNetworkProfile.kind == kind,
                                                        SiteNetworkProfile.key == key)).first()
    if row is None:
        session.add(SiteNetworkProfile(site_id=site_id, kind=kind, key=key, count=1, last_seen=now))
    else:
        row.count += 1
        row.last_seen = now
        session.add(row)


def teach_profile(session: Session, site_id: str, keys: dict):
    now = _utcnow()
    for kind, ks in (keys or {}).items():
        for k in dict.fromkeys(ks or []):
            _bump(session, site_id, kind, k, now)
    session.commit()


def record_outcome(session: Session, site_id: str, keys: dict, accepted: bool):
    """Only an ACCEPTED visit teaches the site profile, so a spoofed submission cannot poison what 'normal' looks like."""
    if accepted:
        teach_profile(session, site_id, keys)


def approve_into_profile(session: Session, submission: Submission):
    """A reviewer approved a case the model flagged: its network was fine after all, so learn it."""
    try:
        keys = json.loads(submission.fusion_report or "{}").get("environment", {}).get("keys") or {}
    except ValueError:
        return
    if keys and submission.status == "flagged":
        teach_profile(session, submission.site_id, keys)


def reset_profile(session: Session, site_id: str) -> int:
    rows = session.exec(select(SiteNetworkProfile).where(SiteNetworkProfile.site_id == site_id)).all()
    for r in rows:
        session.delete(r)
    session.commit()
    return len(rows)
