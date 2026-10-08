"""Hand-built trails for the sensor-fusion tests. Metres east/north of a site at the origin; times in seconds from T0."""
import math
import random

BASE_LAT, BASE_LNG = 12.9716, 77.5946  # the site
T0 = 1_760_000_000_000
SITE = {"lat": BASE_LAT, "lng": BASE_LNG, "radius_m": 60.0, "country": "IN"}


def ll(east_m, north_m):
    return BASE_LAT + north_m / 111_320.0, BASE_LNG + east_m / (111_320.0 * math.cos(math.radians(BASE_LAT)))


def fix(t_s, east, north, acc=8.0, speed=None):
    lat, lng = ll(east, north)
    return {"t": T0 + t_s * 1000.0, "lat": lat, "lng": lng, "acc": acc, "speed": speed, "heading": None, "alt": None}


def line(e0, n0, e1, n1, t0, t1, dt=5, acc=8.0, jitter=0.0, seed=1, speed=None):
    """Fixes every dt seconds from (e0, n0) at t0 to (e1, n1) at t1 (a stationary stretch when the points are equal)."""
    rng = random.Random(seed)
    out, n = [], max(1, int(round((t1 - t0) / dt)))
    for i in range(n + 1):
        f = i / n
        out.append(fix(t0 + f * (t1 - t0), e0 + f * (e1 - e0) + rng.gauss(0, jitter), n0 + f * (n1 - n0) + rng.gauss(0, jitter), acc, speed))
    return out


KINDS = {
    "still": dict(acc_rms=0.06, acc_peak=0.2, gyro_rms=2.0, cad_hz=None, cad_pw=None),
    "walk": dict(acc_rms=1.8, acc_peak=4.5, gyro_rms=40.0, cad_hz=1.9, cad_pw=0.7),
    "ride": dict(acc_rms=0.45, acc_peak=1.2, gyro_rms=6.0, cad_hz=2.1, cad_pw=0.1),
    "noisy": dict(acc_rms=2.5, acc_peak=7.0, gyro_rms=90.0, cad_hz=1.3, cad_pw=0.1),
}


def windows(kinds, t0=0, w=5):
    """One window per entry of `kinds` (names from KINDS, or None = no sensor reading), back to back from t0 seconds."""
    out = []
    for i, k in enumerate(kinds):
        a = T0 + (t0 + i * w) * 1000.0
        base = {"t0": a, "t1": a + w * 1000.0, "n": 250, "hz": 50.0}
        base.update(KINDS[k] if k else dict(acc_rms=None, acc_peak=None, gyro_rms=None, cad_hz=None, cad_pw=None, n=0, hz=None))
        out.append(base)
    return out


def trail(fixes, wins, **kw):
    return {"v": 1, "fixes": fixes, "windows": wins, "sensors": {}, "env": {}, "started_at": fixes[0]["t"] if fixes else None,
            "ended_at": fixes[-1]["t"] if fixes else None, "time_origin": None, **kw}


def genuine_walk(seed=1):
    """200 m west of the site, walks to it at 1.4 m/s (143 s), then stands there for 60 s."""
    fixes = line(-200, 0, 0, 0, 0, 143, jitter=3.0, seed=seed) + line(0, 0, 0, 0, 148, 205, jitter=3.0, seed=seed + 1)
    return trail(fixes, windows(["walk"] * 29 + ["still"] * 12))


def teleport_still(sensors="still"):
    """Phone at home 14 km away for a minute, GPS jumps onto the site, phone never moves."""
    fixes = line(-14_000, 0, -14_000, 0, 0, 60, jitter=2.0, seed=3) + line(0, 0, 0, 0, 65, 125, jitter=2.0, seed=4)
    return trail(fixes, windows([sensors] * 25))
