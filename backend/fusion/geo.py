"""F1: trail and geo engine. Pure functions, no I/O.

A fix is a dict: {t (epoch ms), lat, lng, acc (metres or None), speed (m/s or None), ...}.
Nothing here decides a verdict; it measures the GPS trail (speed, jumps, signs of a fake provider) and leaves the
judgement to consistency.py and, above that, the classifier.
"""
import math
from collections import Counter

from . import config as C

EARTH_M = 6371008.8
DEFAULT_ACC_M = 20.0  # used where a fix reports no accuracy


def haversine_m(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_M * math.asin(min(1.0, math.sqrt(a)))


def _finite(*vals):
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in vals)


def clean_trail(fixes, cfg=None):
    """Sort by time, drop unusable rows and duplicate timestamps, mark each fix reliable or not.
    -> (cleaned list, {"dropped": n}). A fix with accuracy worse than geo.accMaxUsableM is kept (it is drawn and
    counted) but marked unreliable: the rules below ignore it, so indoor GPS lowers the evidence instead of raising
    suspicion."""
    g = cfg or C.GEO
    rows = []
    dropped = 0
    for f in fixes or []:
        if not isinstance(f, dict) or not _finite(f.get("t"), f.get("lat"), f.get("lng")):
            dropped += 1
            continue
        if not (-90 <= f["lat"] <= 90 and -180 <= f["lng"] <= 180):
            dropped += 1
            continue
        acc = f.get("acc")
        acc = float(acc) if _finite(acc) and acc >= 0 else None
        rows.append({**f, "t": float(f["t"]), "lat": float(f["lat"]), "lng": float(f["lng"]), "acc": acc})
    rows.sort(key=lambda r: r["t"])
    out, last_t = [], None
    for r in rows:
        if last_t is not None and r["t"] <= last_t:
            dropped += 1
            continue
        last_t = r["t"]
        r["acc_eff"] = r["acc"] if r["acc"] is not None else DEFAULT_ACC_M
        r["reliable"] = r["acc"] is None or r["acc"] <= g["accMaxUsableM"]
        out.append(r)
    return out, {"dropped": dropped}


def reliable(fixes):
    return [f for f in fixes if f["reliable"]]


def segments(rel):
    """Consecutive reliable fixes -> segments with distance, the error allowance and the speed left after it."""
    segs = []
    for a, b in zip(rel, rel[1:]):
        dt = (b["t"] - a["t"]) / 1000.0
        if dt <= 0:
            continue
        dist = haversine_m(a["lat"], a["lng"], b["lat"], b["lng"])
        allow = C.GEO["errorAllowanceFactor"] * math.hypot(a["acc_eff"], b["acc_eff"])  # accuracy is a ~68% radius: allow twice it
        eff = max(0.0, dist - allow)
        segs.append({"t0": a["t"], "t1": b["t"], "dt": dt, "dist": dist, "allow": allow, "eff_dist": eff,
                     "speed": dist / dt, "eff_speed": eff / dt, "a": (a["lat"], a["lng"]), "b": (b["lat"], b["lng"])})
    return segs


def detect_jumps(segs, cfg=None):
    """A jump is a move no real device could make: faster than geo.jumpSpeedMs, or more than geo.jumpDistanceM in under
    geo.jumpWindowS, after subtracting what the two fixes' own accuracy can explain."""
    g = cfg or C.GEO
    jumps = []
    for s in segs:
        fast = s["eff_speed"] > g["jumpSpeedMs"]
        far = s["eff_dist"] > g["jumpDistanceM"] and s["dt"] < g["jumpWindowS"]
        if fast or far:
            jumps.append({"t0": s["t0"], "t1": s["t1"], "dist_m": round(s["dist"], 1), "dt_s": round(s["dt"], 1),
                          "speed_ms": round(s["speed"], 1), "from": s["a"], "to": s["b"]})
    return jumps


def _centroid(fs):
    n = len(fs)
    return (sum(f["lat"] for f in fs) / n, sum(f["lng"] for f in fs) / n,
            sum(f["t"] for f in fs) / n, math.sqrt(sum(f["acc_eff"] ** 2 for f in fs)) / n)


def block_speed(rel, jumps, mid_ms, cfg=None, cons=None):
    """What the GPS says the phone was doing around `mid_ms`: a block of +-geo.blockHalfS seconds. Position noise is
    averaged (centroid of the first and last third of the block) and the error allowance is subtracted, so a stationary
    phone with jittery fixes is 'still' and a walker with 8 m accuracy is still seen walking.
    -> (class, speed m/s or None, mean reported speed or None) with class in
       still | moving | vehicle | ambiguous | jump | unknown."""
    g = cfg or C.GEO
    k = cons or C.CONSISTENCY
    lo, hi = mid_ms - g["blockHalfS"] * 1000, mid_ms + g["blockHalfS"] * 1000
    fs = [f for f in rel if lo <= f["t"] <= hi]
    if len(fs) < 2 or (fs[-1]["t"] - fs[0]["t"]) / 1000.0 < g["blockMinSpanS"]:
        return "unknown", None, None
    if any(j["t1"] > fs[0]["t"] and j["t0"] < fs[-1]["t"] for j in jumps):
        return "jump", None, None
    n = max(1, len(fs) // 3)
    a, b = _centroid(fs[:n]), _centroid(fs[-n:])
    dt = (b[2] - a[2]) / 1000.0
    if dt <= 0:
        return "unknown", None, None
    dist = haversine_m(a[0], a[1], b[0], b[1])
    eff = max(0.0, dist - g["errorAllowanceFactor"] * math.hypot(a[3], b[3])) / dt
    reported = [f["speed"] for f in fs if _finite(f.get("speed")) and f["speed"] >= 0]
    rep = sum(reported) / len(reported) if reported else None
    allowance = g["errorAllowanceFactor"] * math.hypot(a[3], b[3])
    if eff >= k["vehicleSpeedMs"]:
        cls = "vehicle"
    elif eff >= k["walkSpeedMinMs"]:
        cls = "moving"
    elif eff <= k["stillSpeedMs"]:
        # 'still' only when the positions are precise enough that a walker WOULD have shown up; with a coarse accuracy
        # (indoors, urban canyons) standing and walking look the same, so the honest answer is 'ambiguous'.
        cls = "still" if k["walkSpeedMinMs"] * dt >= allowance / g["errorAllowanceFactor"] else "ambiguous"
    else:
        cls = "ambiguous"
    return cls, eff, rep


def _local_xy(fs):
    """Metres east/north of the first fix (flat-earth is fine at trail scale)."""
    lat0, lng0 = fs[0]["lat"], fs[0]["lng"]
    kx = math.cos(math.radians(lat0)) * math.pi / 180 * EARTH_M
    ky = math.pi / 180 * EARTH_M
    return [((f["lng"] - lng0) * kx, (f["lat"] - lat0) * ky) for f in fs]


def mock_signatures(fixes, cfg=None):
    """Signs of a fake location provider. WEAK evidence on their own (a desktop on WiFi positioning also repeats the same
    coordinates, which is why consistency.py only counts them for a GPS-grade accuracy or a phone with a motion sensor).
    -> measured values plus `too_perfect`."""
    g = (cfg or C.GEO)["mock"]
    fs = reliable(fixes)
    out = {"n": len(fs), "duration_s": 0.0, "pos_std_m": None, "acc_const_share": None, "acc_median_m": None,
           "linear_residual_m": None, "path_m": 0.0, "too_perfect": False}
    if len(fs) < 2:
        return out
    out["duration_s"] = (fs[-1]["t"] - fs[0]["t"]) / 1000.0
    accs = sorted(f["acc_eff"] for f in fs)
    out["acc_median_m"] = accs[len(accs) // 2]
    counts = Counter(round(f["acc_eff"], 1) for f in fs)
    out["acc_const_share"] = counts.most_common(1)[0][1] / len(fs)
    xy = _local_xy(fs)
    cx, cy = sum(p[0] for p in xy) / len(xy), sum(p[1] for p in xy) / len(xy)
    out["pos_std_m"] = math.sqrt(sum((x - cx) ** 2 + (y - cy) ** 2 for x, y in xy) / len(xy))
    out["path_m"] = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(xy, xy[1:]))
    dx, dy = xy[-1]
    chord = math.hypot(dx, dy)
    if chord > 1:
        out["linear_residual_m"] = max(abs(dx * y - dy * x) / chord for x, y in xy)
    enough = out["n"] >= g["minFixes"] and out["duration_s"] >= g["minDurationS"]
    const_acc = out["acc_const_share"] >= g["constAccShare"]
    frozen = out["pos_std_m"] <= g["maxPosStdM"] and const_acc
    ruler = (out["linear_residual_m"] is not None and out["path_m"] >= g["minLinearM"]
             and out["linear_residual_m"] <= g["linearResidualM"] and const_acc)
    out["too_perfect"] = bool(enough and (frozen or ruler))
    return out


def site_relations(fixes, site):
    """Distance from the claimed site at the start and end of the trail (reliable fixes only).
    `site` = {lat, lng, radius_m}. -> dict, or None when there is no site or no reliable fix."""
    rel = reliable(fixes)
    if not site or not rel:
        return None
    first, last = rel[0], rel[-1]
    d0 = haversine_m(first["lat"], first["lng"], site["lat"], site["lng"])
    d1 = haversine_m(last["lat"], last["lng"], site["lat"], site["lng"])
    r = float(site.get("radius_m") or 100.0)
    return {"start_m": d0, "end_m": d1, "end_acc_m": last["acc_eff"], "radius_m": r,
            "end_inside": d1 <= r + last["acc_eff"], "end_outside": d1 > r + 1.5 * last["acc_eff"]}


def trail_span_s(fixes):
    return (fixes[-1]["t"] - fixes[0]["t"]) / 1000.0 if len(fixes) >= 2 else 0.0
