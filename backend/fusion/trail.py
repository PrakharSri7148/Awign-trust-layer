"""F5: parsing and validating the `trail` the device sends. Anything wrong becomes a FLAG and 'no trail' (unknown),
never an exception: a malformed trail must not turn a submission into a 500.

Wire format (v1), all optional so old clients keep working:
  trail = {v, started_at, ended_at, time_origin, fixes[{t,lat,lng,acc,speed,heading,alt}], windows[{t0,t1,n,hz,acc_rms,
           acc_peak,gyro_rms,cad_hz,cad_pw}], sensors{geo,motion,gyro,linear_accel,hz_median}, env{tz,tz_offset_min,locale}}
Times are the device's epoch milliseconds; the server checks them against ITS clock via the visit (pipeline.py).
"""
import json
import math

from . import config as C

SENSOR_STATES = {"granted", "denied", "absent", "null_events", None}


def _f(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def parse(raw):
    """-> (trail dict or None, flags). `raw` is whatever JSON the device sent."""
    T = C.TRAIL
    if raw is None:
        return None, []
    if not isinstance(raw, dict):
        return None, ["trail_invalid"]
    try:
        if len(json.dumps(raw)) > T["maxBytes"]:
            return None, ["trail_invalid"]
    except (TypeError, ValueError):
        return None, ["trail_invalid"]
    fixes_in, wins_in = raw.get("fixes"), raw.get("windows")
    if not isinstance(fixes_in, list) and fixes_in is not None or not isinstance(wins_in, list) and wins_in is not None:
        return None, ["trail_invalid"]
    if len(fixes_in or []) > T["maxFixes"] or len(wins_in or []) > T["maxWindows"]:
        return None, ["trail_invalid"]

    fixes = []
    for f in fixes_in or []:
        if not isinstance(f, dict):
            continue
        t, lat, lng = _f(f.get("t")), _f(f.get("lat")), _f(f.get("lng"))
        if t is None or lat is None or lng is None or not (-90 <= lat <= 90 and -180 <= lng <= 180):
            continue
        fixes.append({"t": t, "lat": lat, "lng": lng, "acc": _f(f.get("acc")), "speed": _f(f.get("speed")),
                      "heading": _f(f.get("heading")), "alt": _f(f.get("alt"))})
    wins = []
    for w in wins_in or []:
        if not isinstance(w, dict):
            continue
        t0, t1 = _f(w.get("t0")), _f(w.get("t1"))
        if t0 is None or t1 is None or t1 <= t0 or (t1 - t0) > 60_000:
            continue
        wins.append({"t0": t0, "t1": t1, **{k: _f(w.get(k)) for k in ("n", "hz", "acc_rms", "acc_peak", "gyro_rms", "cad_hz", "cad_pw")}})
    started, ended = _f(raw.get("started_at")), _f(raw.get("ended_at"))
    if started is None and fixes:
        started = min(f["t"] for f in fixes)
    if ended is None and fixes:
        ended = max(f["t"] for f in fixes)
    sensors = raw.get("sensors") if isinstance(raw.get("sensors"), dict) else {}
    env = raw.get("env") if isinstance(raw.get("env"), dict) else {}
    return {
        "v": 1, "started_at": started, "ended_at": ended, "time_origin": _f(raw.get("time_origin")),
        "fixes": fixes, "windows": wins,
        "sensors": {k: sensors.get(k) for k in ("geo", "motion", "gyro", "linear_accel", "hz_median")},
        "env": {"tz": env.get("tz") if isinstance(env.get("tz"), str) else None, "tz_offset_min": _f(env.get("tz_offset_min")),
                "locale": env.get("locale") if isinstance(env.get("locale"), str) else None},
    }, []


def legacy_trail(gps):
    """A device that sent only the old single GPS point: a one-fix trail, no windows. Lets the site check run."""
    if not gps or _f(gps.get("lat")) is None or _f(gps.get("lng")) is None:
        return None
    return {"v": 1, "started_at": None, "ended_at": None, "time_origin": None,
            "fixes": [{"t": 0.0, "lat": float(gps["lat"]), "lng": float(gps["lng"]), "acc": None, "speed": None, "heading": None, "alt": None}],
            "windows": [], "sensors": {}, "env": {}}


def check_times(trail, visit_started_ms, now_ms):
    """Validate the device's clock claims against the server's (visit start + now). -> list of flags (empty = fine).
    A recorded genuine trail replayed under a NEW visit starts before that visit existed, which fails here."""
    skew = C.TRAIL["clockSkewS"] * 1000
    flags = []
    started, ended = trail.get("started_at"), trail.get("ended_at")
    if started is None or ended is None:
        return flags
    if ended < started or (ended - started) > C.TRAIL["maxTrailS"] * 1000 + skew:
        flags.append("trail_invalid")
    if started < visit_started_ms - skew:
        flags.append("trail_replayed")  # claims to start before the server's visit session existed
    if ended > now_ms + skew:
        flags.append("trail_invalid")  # from the future
    ts = [f["t"] for f in trail["fixes"]] + [x for w in trail["windows"] for x in (w["t0"], w["t1"])]
    if ts and (min(ts) < visit_started_ms - skew or max(ts) > now_ms + skew):
        flags.append("trail_replayed" if min(ts) < visit_started_ms - skew else "trail_invalid")
    return list(dict.fromkeys(flags))
