import hashlib
import json
import math

from sqlmodel import Session

from models import SiteFingerprint

MOTION_SATURATION = 1.5  # m/s^2 mean magnitude that maps to a score of 1.0


def compute_motion_score(motion_samples, gps, previous_gps=None):
    """Map mean acceleration magnitude to 0-1. Still device -> ~0, movement -> ~1.

    `gps` / `previous_gps` are accepted for future location-vs-motion checks but
    are not part of the current score.
    """
    if not motion_samples:
        return 0.0
    magnitudes = []
    for s in motion_samples:
        x = _num(s, "x")
        y = _num(s, "y")
        z = _num(s, "z")
        magnitudes.append(math.sqrt(x * x + y * y + z * z))
    mean_magnitude = sum(magnitudes) / len(magnitudes)
    return min(1.0, mean_magnitude / MOTION_SATURATION)


def _num(sample, key):
    v = sample.get(key) if isinstance(sample, dict) else getattr(sample, key, None)
    return float(v) if v is not None else 0.0


def _bucket_downlink(downlink):
    # Browsers round/jitter downlink; bucket on a log2 scale so the same network
    # usually hashes to the same value.
    if downlink is None:
        return "none"
    d = float(downlink)
    if d <= 0:
        return "0"
    return str(int(math.floor(math.log2(d))))


def _bucket_rtt(rtt):
    if rtt is None:
        return "none"
    r = float(rtt)
    for limit in (50, 150, 400, 1000):
        if r < limit:
            return f"<{limit}"
    return ">=1000"


def network_vector(network_info):
    """Deterministic 4-float vector in [-1, 1] derived by hashing network_info."""
    info = network_info or {}
    get = info.get if isinstance(info, dict) else lambda k: getattr(info, k, None)
    key = "|".join(
        [
            str(get("effectiveType") or "none"),
            _bucket_downlink(get("downlink")),
            _bucket_rtt(get("rtt")),
        ]
    )
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    vec = []
    for i in range(4):
        n = int.from_bytes(digest[i * 4 : (i + 1) * 4], "big")
        # Centered on 0 so unrelated networks give low (often negative) cosine.
        vec.append(n / 0xFFFFFFFF * 2.0 - 1.0)
    return vec


def _cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def compute_ambient_score(site_id, network_info, db_session: Session):
    vec = network_vector(network_info)
    fp = db_session.get(SiteFingerprint, site_id)
    if fp is None:
        db_session.add(SiteFingerprint(site_id=site_id, fingerprint_vector=json.dumps(vec)))
        db_session.commit()
        return 1.0
    stored = json.loads(fp.fingerprint_vector)
    # Clamp to [0, 1] to match the score range the classifier was trained on.
    return max(0.0, min(1.0, _cosine(vec, stored)))
