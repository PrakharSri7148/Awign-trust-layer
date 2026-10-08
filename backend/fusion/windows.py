"""F2: motion-window features and activity. Python port of client/src/lib/sensorFusion/windows.js (same algorithm, same
thresholds from fusion.json; client/tools/fusion-parity.mjs checks they agree).

A sample is a flat dict: {t (ms), x, y, z (linear acceleration m/s^2, gravity removed, or None), alpha, beta, gamma
(rotationRate deg/s, or None)}. A window is the features of the samples in a few seconds.
"""
import math

import numpy as np

from . import config as C


def _num(v):
    return isinstance(v, (int, float)) and math.isfinite(v)


def window_features(samples, cfg=None):
    """-> {n, hz, acc_rms, acc_peak, gyro_rms, cad_hz, cad_pw}; a missing signal is None (never 0): 'no sensor' is not
    'perfectly still'."""
    a = cfg or C.ACTIVITY
    acc_t, ax, ay, az, acc_m, gyro_m, ts = [], [], [], [], [], [], []
    for s in samples or []:
        if not _num(s.get("t")):
            continue
        has_acc = _num(s.get("x")) and _num(s.get("y")) and _num(s.get("z"))
        has_gyro = _num(s.get("alpha")) and _num(s.get("beta")) and _num(s.get("gamma"))
        if not (has_acc or has_gyro):
            continue
        ts.append(s["t"])
        if has_acc:
            acc_t.append(s["t"])
            ax.append(s["x"])
            ay.append(s["y"])
            az.append(s["z"])
            acc_m.append(math.sqrt(s["x"] ** 2 + s["y"] ** 2 + s["z"] ** 2))
        if has_gyro:
            gyro_m.append(math.sqrt(s["alpha"] ** 2 + s["beta"] ** 2 + s["gamma"] ** 2))
    out = {"n": len(ts), "hz": None, "acc_rms": None, "acc_peak": None, "gyro_rms": None, "cad_hz": None, "cad_pw": None}
    if len(ts) >= 2 and ts[-1] > ts[0]:
        out["hz"] = (len(ts) - 1) / ((ts[-1] - ts[0]) / 1000.0)
    if acc_m:
        out["acc_rms"] = math.sqrt(sum(m * m for m in acc_m) / len(acc_m))
        out["acc_peak"] = max(acc_m)
    if gyro_m:
        out["gyro_rms"] = math.sqrt(sum(m * m for m in gyro_m) / len(gyro_m))
    out["cad_hz"], out["cad_pw"] = cadence(acc_t, (ax, ay, az), out["hz"], a)
    return out


def cadence(ts, axes, hz, a=None):
    """Walking rhythm: the strongest peak of the autocorrelation between cadHzMin and cadHzMax, summed over the three
    axes. (Not the magnitude: the magnitude of a gravity-free vector is rectified, so a 2 Hz step would show up at 4 Hz;
    summing the per-axis autocorrelations does not care how the phone is held.)
    -> (frequency Hz, strength 0..1), or (None, None) when it cannot be judged (sensor rate below minHzForCadence, a
    window shorter than 3 s, or a perfectly flat signal)."""
    a = a or C.ACTIVITY
    if len(ts) < 2 or hz is None or hz < a["minHzForCadence"] or (ts[-1] - ts[0]) < 3000:
        return None, None
    fs = a["cadenceFs"]
    step = 1000.0 / fs
    n = int(math.floor((ts[-1] - ts[0]) / step)) + 1
    grid = ts[0] + np.arange(n) * step
    tt = np.asarray(ts, dtype=float)
    xs = []
    for ax_ in axes:
        x = np.interp(grid, tt, np.asarray(ax_, dtype=float))
        xs.append(x - x.mean())
    r0 = sum(float(np.dot(x, x)) for x in xs)
    if r0 < 1e-9:
        return None, None
    lo = int(math.ceil(fs / a["walking"]["cadHzMax"]))
    hi = int(math.floor(fs / a["walking"]["cadHzMin"]))
    best_l, best_r = None, -2.0
    for lag in range(lo, min(hi, n - 2) + 1):
        r = sum(float(np.dot(x[: n - lag], x[lag:])) for x in xs) / r0 * n / (n - lag)
        if r > best_r:
            best_l, best_r = lag, r
    if best_l is None:
        return None, None
    return fs / best_l, max(0.0, min(1.0, best_r))


def activity(w, cfg=None):
    """still | walking | moving | unknown, from rules (not ML). 'moving' = energy without a walking rhythm (vehicle, running,
    handling the phone). Sensors alone cannot reliably tell a vehicle, so there is no such class."""
    a = cfg or C.ACTIVITY
    acc, gyro = w.get("acc_rms"), w.get("gyro_rms")
    if acc is None and gyro is None:
        return "unknown"
    quiet_acc = acc is None or acc < a["still"]["accRms"]
    quiet_gyro = gyro is None or gyro < a["still"]["gyroRms"]
    if quiet_acc and quiet_gyro:
        return "still"
    wk = a["walking"]
    pw, hz = w.get("cad_pw"), w.get("cad_hz")
    if acc is not None and pw is not None and hz is not None and pw >= wk["cadPw"] and wk["cadHzMin"] <= hz <= wk["cadHzMax"] and acc >= wk["accRms"]:
        return "walking"
    return "moving"


def split_windows(samples, t0, t1, window_s=None):
    """Group samples (epoch ms) into consecutive windows of window_s seconds from t0 to t1 -> list of
    {t0, t1, **features}."""
    ws = (window_s or C.TRAIL["windowS"]) * 1000.0
    out = []
    t = t0
    idx = 0
    ss = sorted((s for s in samples if _num(s.get("t"))), key=lambda s: s["t"])
    while t + ws <= t1 + 1e-6:
        chunk = []
        while idx < len(ss) and ss[idx]["t"] < t + ws:
            if ss[idx]["t"] >= t:
                chunk.append(ss[idx])
            idx += 1
        f = window_features(chunk)
        out.append({"t0": t, "t1": t + ws, **f})
        t += ws
    return out
