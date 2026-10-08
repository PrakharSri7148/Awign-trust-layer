"""F7: a trail simulator for the training data. EVERYTHING it produces is SYNTHETIC.

Why it exists: the old generator (generate_synthetic_data.py) drew the motion and ambient SCORES straight from hand-picked
distributions, so the model never saw a GPS jump or a walking rhythm: it learned the author's guess of the score. This one
simulates what a phone would actually record (GPS fixes with correlated noise, raw accelerometer/gyroscope streams,
network, IP) and pushes it through the REAL engines (geo -> windows -> consistency / environment). The scores come out of
the pipeline. It does NOT import the scoring weights.

What it cannot do: the physical models (gait frequency, tremor size, GPS error) and the scenario list are still the
authors' assumptions, and the detector was written by the same authors; high accuracy here shows that the model learned
this world, not that it works on real workers. Held-out runs (`params=SHIFTED`) change the world to show the sensitivity.
"""
import math
from dataclasses import dataclass, replace

import numpy as np
import pandas as pd

from . import consistency, environment, trail as trail_mod, windows as W

T0 = 1_760_000_000_000.0
SITE = {"lat": 12.9716, "lng": 77.5946, "radius_m": 60.0, "country": "IN"}
M_PER_DEG = 111_320.0

NETS = [
    ({"effectiveType": "4g", "downlink": 10, "rtt": 40}, 0.35),
    ({"effectiveType": "4g", "downlink": 5, "rtt": 90}, 0.25),
    ({"effectiveType": "4g", "downlink": 2.5, "rtt": 120}, 0.20),
    ({"effectiveType": "3g", "downlink": 1.2, "rtt": 300}, 0.10),
    ({"effectiveType": "4g", "downlink": 20, "rtt": 30}, 0.10),
]
ODD_NETS = [{"effectiveType": "2g", "downlink": 0.2, "rtt": 1500}, {"effectiveType": "3g", "downlink": 0.5, "rtt": 600}]
ASN_POOL = [(55836, "Reliance Jio Infocomm"), (45609, "Bharti Airtel"), (38266, "Vodafone Idea"), (24309, "Atria Convergence Technologies")]
HUBS = [(19.07, 72.87), (28.61, 77.21), (22.57, 88.36)]  # Mumbai, Delhi, Kolkata


@dataclass(frozen=True)
class Params:
    """The simulated world. SHIFTED changes it for the held-out evaluation."""
    gps_sigma: float = 1.0       # scale of GPS error
    acc_scale: float = 1.0       # scale of walking acceleration
    tremor_scale: float = 1.0    # scale of the hand tremor / vibration when still
    cad_mean: float = 1.8
    cad_sd: float = 0.12
    hz: float = 30.0
    gateway_far: float = 0.2     # share of genuine mobile users whose IP resolves to a far carrier hub
    # IP-geolocation error model. Sources (see Sensor-fusion/README.md "IP error model"): MaxMind publishes ~99.8% country-level
    # accuracy and ~63% of US IPs within 50 km, i.e. ~37% of IPs resolve farther than that. DB-IP LITE is a reduced-accuracy subset of the
    # commercial database ("accuracy index" 81 vs 93 for the commercial country database), so the country error below is an
    # ASSUMPTION of 10x MaxMind's 0.2%. India-specific figures could not be retrieved (MaxMind's tool is interactive): not invented.
    ip_country_err: float = 0.02  # share of IPs whose COUNTRY is wrong (a foreign IP reads as India, an Indian one as elsewhere)
    ip_city_miss: float = 0.37    # share of IPs resolved farther than 50 km from the truth (MaxMind US figure; lenient for a lite DB)
    ip_miss_median_km: float = 120.0  # ASSUMPTION: shape of that error (lognormal), not published
    speed_scale: float = 1.0


DEFAULT = Params()
SHIFTED = Params(gps_sigma=1.6, acc_scale=0.7, tremor_scale=1.5, cad_mean=1.65, cad_sd=0.2, hz=25.0, gateway_far=0.35, speed_scale=0.85,
                 ip_country_err=0.04, ip_city_miss=0.5, ip_miss_median_km=200.0)


# ------------------------------------------------------------------ truth paths

def _ll(e, n):
    return SITE["lat"] + n / M_PER_DEG, SITE["lng"] + e / (M_PER_DEG * math.cos(math.radians(SITE["lat"])))


def _truth(segments, dt=1.0):
    """segments: ("walk"|"drive", (e0,n0), (e1,n1), speed) or ("stand", (e,n), seconds). -> per-second list of (t, e, n, mode, speed)."""
    out, t = [], 0.0
    for seg in segments:
        if seg[0] == "stand":
            _, (e, n), secs = seg
            for _ in range(int(secs / dt)):
                out.append((t, e, n, "stand", 0.0))
                t += dt
        else:
            kind, (e0, n0), (e1, n1), speed = seg
            dist = math.hypot(e1 - e0, n1 - n0)
            steps = max(1, int(dist / max(speed, 0.1) / dt))
            for i in range(steps):
                f = i / steps
                out.append((t, e0 + f * (e1 - e0), n0 + f * (n1 - n0), kind, speed))
                t += dt
    return out


def _bearing_point(rng, dist):
    a = rng.uniform(0, 2 * math.pi)
    return dist * math.cos(a), dist * math.sin(a)


# ------------------------------------------------------------------ GPS

def _gps_fixes(truth, rng, P, *, sigma, dt=5, acc_lo=1.0, acc_hi=2.0, dropout=0.0, gap=None, speed_report="real", fake=False):
    """Fixes every `dt` s from the truth path with AR(1)-correlated error. fake=True: no noise, constant accuracy, speed not reported."""
    fixes, ne, nn = [], 0.0, 0.0
    ar = 0.8
    sig = sigma * P.gps_sigma
    for i in range(0, len(truth), dt):
        t, e, n, mode, spd = truth[i]
        if gap and gap[0] <= t < gap[1]:
            continue
        if dropout and rng.random() < dropout:
            continue
        if fake:
            lat, lng = _ll(e, n)
            fixes.append({"t": T0 + t * 1000, "lat": lat, "lng": lng, "acc": 5.0, "speed": None, "heading": None, "alt": None})
            continue
        ne = ar * ne + math.sqrt(1 - ar * ar) * rng.normal(0, sig)
        nn = ar * nn + math.sqrt(1 - ar * ar) * rng.normal(0, sig)
        lat, lng = _ll(e + ne, n + nn)
        reported = None if speed_report == "none" else max(0.0, spd + rng.normal(0, 0.3))
        fixes.append({"t": T0 + t * 1000, "lat": lat, "lng": lng, "acc": float(max(2.0, sig * rng.uniform(acc_lo, acc_hi))), "speed": reported,
                      "heading": None, "alt": None})
    return fixes


# ------------------------------------------------------------------ raw sensors -> windows

class Walker:
    """One person's gait and hands, drawn once per trail."""

    def __init__(self, rng, P):
        self.cad = float(np.clip(rng.normal(P.cad_mean, P.cad_sd), 1.35, 2.5))
        self.amp_hand = rng.uniform(1.2, 3.5) * P.acc_scale
        self.amp_pocket = rng.uniform(0.8, 2.4) * P.acc_scale
        self.tremor = rng.uniform(0.02, 0.09) * P.tremor_scale
        self.gyro_still = rng.uniform(0.5, 5.0) * P.tremor_scale
        self.gyro_hand = rng.uniform(25, 80)
        self.gyro_pocket = rng.uniform(10, 40)
        self.vibration = rng.uniform(0.08, 0.45) * P.tremor_scale
        self.pocket = False


def _raw_window(mode, w: Walker, rng, hz, t0_ms, handling=False, quiet_ride=False):
    n = int(hz * 5)
    tt = np.arange(n) / hz
    t = t0_ms + tt * 1000.0
    noise = lambda s: rng.normal(0, s, n)  # noqa: E731
    if mode == "walk":
        A = w.amp_pocket if w.pocket else w.amp_hand
        G = w.gyro_pocket if w.pocket else w.gyro_hand
        f, ph = w.cad, rng.uniform(0, 2 * math.pi, 4)
        x = 0.5 * A * np.sin(2 * math.pi * f / 2 * tt + ph[0]) + noise(0.15 * A)
        y = 0.4 * A * np.sin(2 * math.pi * f * tt + ph[1]) + noise(0.15 * A)
        z = A * np.sin(2 * math.pi * f * tt + ph[2]) + 0.3 * A * np.sin(4 * math.pi * f * tt + ph[3]) + noise(0.15 * A)
        ga = G * np.sin(2 * math.pi * f * tt + ph[0]) + noise(0.2 * G)
        gb, gg = 0.6 * G * np.sin(2 * math.pi * f / 2 * tt + ph[1]) + noise(0.2 * G), noise(0.2 * G)
    elif mode == "drive":
        v = w.vibration * (0.25 if quiet_ride else 1.0)
        sway = 0.1 * np.sin(2 * math.pi * 0.3 * tt + rng.uniform(0, 6))
        x, y, z = noise(v) + sway, noise(v), noise(v)
        ga, gb, gg = noise(w.gyro_still * 1.5), noise(w.gyro_still * 1.5), noise(w.gyro_still * 1.5)
    else:  # stand
        x, y, z = noise(w.tremor), noise(w.tremor), noise(w.tremor)
        ga, gb, gg = noise(w.gyro_still), noise(w.gyro_still), noise(w.gyro_still)
        if handling:  # picked up / nudged
            lo = int(rng.integers(0, max(1, n - int(hz))))
            hi = lo + int(hz)
            for arr in (x, y, z):
                arr[lo:hi] += rng.normal(0, 1.5, hi - lo)
            for arr in (ga, gb, gg):
                arr[lo:hi] += rng.normal(0, 40, hi - lo)
    return [{"t": float(t[i]), "x": float(x[i]), "y": float(y[i]), "z": float(z[i]), "alpha": float(ga[i]), "beta": float(gb[i]), "gamma": float(gg[i])}
            for i in range(n)]


def _windows(truth, rng, P, *, hz=None, pocket=False, flat=False, replay=None, quiet_ride=False, sensor=True, start_s=0.0):
    """5 s windows over the truth path, from raw samples through windows.window_features (the real F2 code).
    flat=True: the phone never moves (it is at the faker's home). replay: 'walk' = a recorded walking rhythm played back."""
    if not sensor:
        return []
    w = Walker(rng, P)
    w.pocket = pocket
    hz = hz or P.hz
    out = []
    for k in range(int((len(truth) - start_s) // 5)):
        i = int(start_s) + k * 5
        mode = truth[min(len(truth) - 1, i + 2)][3]
        if flat:
            mode = "stand"
        if replay == "walk":
            mode = "walk"
        samples = _raw_window(mode, w, rng, hz, T0 + truth[i][0] * 1000.0, handling=(mode == "stand" and not flat and rng.random() < 0.08), quiet_ride=quiet_ride)
        out.append({"t0": T0 + truth[i][0] * 1000.0, "t1": T0 + (truth[i][0] + 5) * 1000.0, **W.window_features(samples)})
    return out


# ------------------------------------------------------------------ environment

def _profile(rng, empty=False):
    if empty:
        return {}
    link, asn = {}, {}
    for _ in range(int(rng.integers(8, 25))):
        info = NETS[int(rng.choice(len(NETS), p=[w for _, w in NETS]))][0]
        k = environment.link_key(info)
        link[k] = link.get(k, 0) + 1
        a = ASN_POOL[int(rng.integers(0, len(ASN_POOL)))][0]
        asn[f"AS{a}"] = asn.get(f"AS{a}", 0) + 1
    return {"link": link, "asn": asn}


def _net(rng, odd=False):
    if odd:
        return dict(ODD_NETS[int(rng.integers(0, len(ODD_NETS)))])
    if rng.random() < 0.12:
        return dict(ODD_NETS[int(rng.integers(0, len(ODD_NETS)))])
    return dict(NETS[int(rng.choice(len(NETS), p=[w for _, w in NETS]))][0])


# Where traffic can exit or originate outside India: (country, lat, lng, [(asn, org)]). Residential ISPs and hosting/VPN providers.
# The organisation names are real public provider names used only as plausible labels; no private data.
FOREIGN_ISPS = [
    ("US", 40.7, -74.0, [(7922, "Comcast Cable Communications"), (701, "Verizon Business")]),
    ("GB", 51.5, -0.12, [(2856, "British Telecommunications PLC")]),
    ("DE", 50.1, 8.68, [(3320, "Deutsche Telekom AG")]),
    ("SG", 1.35, 103.8, [(7473, "Singapore Telecommunications")]),
    ("AE", 25.2, 55.27, [(5384, "Emirates Telecommunications")]),
    ("NL", 52.37, 4.9, [(1136, "KPN B.V.")]),
]
VPN_HOSTS = [  # hosting/VPN exits (org names contain hosting keywords from fusion.json)
    (9009, "M247 Ltd"), (14061, "DigitalOcean, LLC"), (16509, "Amazon.com, Inc."), (16276, "OVH SAS"), (24940, "Hetzner Online GmbH"),
    (212238, "Datacamp Limited"),
]
IN_CITIES = [(19.07, 72.87), (28.61, 77.21), (22.57, 88.36), (13.08, 80.27), (17.38, 78.48), (12.97, 77.59)]  # Mumbai, Delhi, Kolkata, Chennai, Hyderabad, Bengaluru


def _ip_true(rng, kind, P):
    """The network the request REALLY came from. kind: near | gateway | vpn | abroad | home | vpn_foreign | isp_foreign | vpn_in"""
    asn, org = ASN_POOL[int(rng.integers(0, len(ASN_POOL)))]
    if kind == "near":
        lat, lng = SITE["lat"] + rng.normal(0, 0.1), SITE["lng"] + rng.normal(0, 0.1)
        return {"ip": "49.0.0.1", "private": False, "country": "IN", "lat": lat, "lng": lng, "asn": asn, "org": org}
    if kind == "gateway":
        lat, lng = HUBS[int(rng.integers(0, len(HUBS)))]
        return {"ip": "49.0.0.1", "private": False, "country": "IN", "lat": lat, "lng": lng, "asn": asn, "org": org}
    if kind == "vpn":
        return {"ip": "5.0.0.1", "private": False, "country": "NL", "lat": 52.37, "lng": 4.9, "asn": 9009, "org": "M247 Ltd"}
    if kind == "abroad":
        return {"ip": "8.0.0.1", "private": False, "country": "US", "lat": 40.7, "lng": -74.0, "asn": 7922, "org": "Comcast Cable"}
    if kind == "isp_foreign":
        c, lat, lng, isps = FOREIGN_ISPS[int(rng.integers(0, len(FOREIGN_ISPS)))]
        a, o = isps[int(rng.integers(0, len(isps)))]
        return {"ip": "8.0.0.1", "private": False, "country": c, "lat": lat + rng.normal(0, 0.3), "lng": lng + rng.normal(0, 0.3), "asn": a, "org": o}
    if kind == "vpn_foreign":
        c, lat, lng, _ = FOREIGN_ISPS[int(rng.integers(0, len(FOREIGN_ISPS)))]
        a, o = VPN_HOSTS[int(rng.integers(0, len(VPN_HOSTS)))]
        return {"ip": "5.0.0.1", "private": False, "country": c, "lat": lat + rng.normal(0, 0.3), "lng": lng + rng.normal(0, 0.3), "asn": a, "org": o}
    if kind == "vpn_in":  # an honest worker's VPN / cloud egress that exits in INDIA: half in the worker's own city, half in a metro hub
        a, o = VPN_HOSTS[int(rng.integers(0, len(VPN_HOSTS)))]
        if rng.random() < 0.5:
            lat, lng = SITE["lat"] + rng.normal(0, 0.05), SITE["lng"] + rng.normal(0, 0.05)
        else:
            lat, lng = IN_CITIES[int(rng.integers(0, len(IN_CITIES)))]
        return {"ip": "103.0.0.1", "private": False, "country": "IN", "lat": lat, "lng": lng, "asn": a, "org": o}
    if kind == "home":  # a faker at home: from the same city to another state
        km = math.exp(rng.uniform(math.log(3), math.log(900)))
        a = rng.uniform(0, 2 * math.pi)
        return {"ip": "49.0.0.1", "private": False, "country": "IN", "lat": SITE["lat"] + km * math.cos(a) / 111.0,
                "lng": SITE["lng"] + km * math.sin(a) / 108.0, "asn": asn, "org": org}
    return None


def _ip_resolved(rng, ip, kind, P):
    """What the IP DATABASE says about that network: the truth plus the database's own error (Params.ip_*; sources in Params).
    A displaced position models the 'city' error; a wrong country models the 'country' error. The gateway / home kinds already
    ARE a displaced position, so they only get the country error."""
    if ip is None:
        return None
    ip = dict(ip)
    if kind not in ("gateway", "home") and rng.random() < P.ip_city_miss:
        km = math.exp(rng.normal(math.log(P.ip_miss_median_km), 0.8))
        a = rng.uniform(0, 2 * math.pi)
        ip["lat"] += km * math.cos(a) / 111.0
        ip["lng"] += km * math.sin(a) / (111.0 * max(0.2, math.cos(math.radians(ip["lat"]))))
    if rng.random() < P.ip_country_err:
        if ip["country"] == "IN":
            c, lat, lng, _ = FOREIGN_ISPS[int(rng.integers(0, len(FOREIGN_ISPS)))]
            ip.update(country=c, lat=lat, lng=lng)
        else:
            lat, lng = IN_CITIES[int(rng.integers(0, len(IN_CITIES)))]
            ip.update(country="IN", lat=lat, lng=lng)
    return ip


def _ip(rng, kind, P):
    return _ip_resolved(rng, _ip_true(rng, kind, P), kind, P)


def _near_or_gateway(rng, P):
    return _ip(rng, "gateway" if rng.random() < P.gateway_far else "near", P)


# ------------------------------------------------------------------ scenarios
# Each builder returns {trail, net, ip, profile, tz, photo ('good'|'poor')}.

def _arrive(rng, P, *, mode="walk", dist=None, speed=None, dwell=None, pocket=False, sigma=None, hz=None, sensor=True, quiet=False):
    dist = dist or rng.uniform(150, 600)
    start = _bearing_point(rng, dist)
    spd = (speed or rng.uniform(1.15, 1.6)) * P.speed_scale
    segs = [(mode, start, (0, 0), spd), ("stand", (0, 0), dwell or rng.uniform(40, 120))]
    truth = _truth(segs)
    fixes = _gps_fixes(truth, rng, P, sigma=sigma or rng.uniform(2.5, 6.0))
    return truth, fixes, _windows(truth, rng, P, pocket=pocket, hz=hz, sensor=sensor, quiet_ride=quiet)


def _row(truth_fixes_windows, rng, P, *, ip=None, profile=None, net=None, photo="good", tz=330):
    truth, fixes, wins = truth_fixes_windows
    return {"trail": {"v": 1, "fixes": fixes, "windows": wins, "sensors": {}, "env": {"tz_offset_min": tz}, "started_at": None, "ended_at": None, "time_origin": None},
            "net": net if net is not None else _net(rng), "ip": ip if ip is not None else _near_or_gateway(rng, P),
            "profile": profile if profile is not None else _profile(rng), "photo": photo}


def g_walk_hand(rng, P):
    return _row(_arrive(rng, P), rng, P)


def g_walk_pocket(rng, P):
    return _row(_arrive(rng, P, pocket=True), rng, P)


def g_drive_then_walk(rng, P):
    start = _bearing_point(rng, rng.uniform(1000, 3500))
    mid = _bearing_point(rng, rng.uniform(60, 160))
    truth = _truth([("drive", start, mid, rng.uniform(6, 14) * P.speed_scale), ("walk", mid, (0, 0), rng.uniform(1.15, 1.6) * P.speed_scale), ("stand", (0, 0), rng.uniform(30, 90))])
    return _row((truth, _gps_fixes(truth, rng, P, sigma=rng.uniform(3, 8)), _windows(truth, rng, P)), rng, P)


def g_at_site(rng, P):
    truth = _truth([("stand", (rng.normal(0, 8), rng.normal(0, 8)), rng.uniform(120, 300))])
    return _row((truth, _gps_fixes(truth, rng, P, sigma=rng.uniform(2.5, 6)), _windows(truth, rng, P)), rng, P)


def g_bad_photo(rng, P):
    r = g_walk_hand(rng, P)
    r["photo"] = "poor"
    return r


def h_indoor_drift(rng, P):
    truth = _truth([("stand", (0, 0), rng.uniform(120, 240))])
    fixes = _gps_fixes(truth, rng, P, sigma=rng.uniform(25, 55), acc_lo=1.2, acc_hi=2.0)
    return _row((truth, fixes, _windows(truth, rng, P)), rng, P)


def h_tunnel_dropout(rng, P):
    start = _bearing_point(rng, rng.uniform(2500, 5000))
    truth = _truth([("drive", start, (0, 0), rng.uniform(9, 16) * P.speed_scale), ("stand", (0, 0), 40)])
    d = len(truth) - 40
    gap = (rng.uniform(0.3, 0.6) * d, rng.uniform(0.62, 0.85) * d)
    return _row((truth, _gps_fixes(truth, rng, P, sigma=rng.uniform(3, 8), gap=gap), _windows(truth, rng, P, quiet_ride=True)), rng, P)


def h_smooth_highway(rng, P):
    start = _bearing_point(rng, rng.uniform(4000, 9000))
    truth = _truth([("drive", start, (0, 0), rng.uniform(16, 26) * P.speed_scale), ("stand", (0, 0), 40)])
    return _row((truth, _gps_fixes(truth, rng, P, sigma=rng.uniform(3, 7)), _windows(truth, rng, P, quiet_ride=True)), rng, P)


def h_desktop(rng, P):
    truth = _truth([("stand", (0, 0), rng.uniform(90, 200))])
    lat, lng = _ll(rng.normal(0, 20), rng.normal(0, 20))
    fixes = [{"t": T0 + i * 5000.0, "lat": lat, "lng": lng, "acc": float(rng.uniform(30, 65)), "speed": None, "heading": None, "alt": None} for i in range(len(truth) // 5)]
    for f in fixes:
        f["acc"] = fixes[0]["acc"]  # WiFi positioning repeats itself
    return _row((truth, fixes, []), rng, P)


def _maybe_new_site(rng, share=0.35):
    """A third of the sites have fewer than profileMin accepted visits (no learned provider profile yet), so a country mismatch is
    the ONLY sign there: the environment score then sits exactly at the country weight's complement, which must also be covered."""
    return {} if rng.random() < share else None


# Blind variants: 20% no motion data from a motion sensor (declined recording, desktop), 10% a single legacy GPS point, 10% nothing at all. The network evidence does
# not depend on the sensors, so the classifier must see these combinations (found by the API test: a foreign VPN with no motion data scored 0.11).
def _blind_row(rng, P, *, ip, profile=None):
    """_row() for the 'blind' variants: the legacy-client case swaps the trail for a single GPS point."""
    sensor_roll = rng.random()
    if sensor_roll < 0.20:
        r = _row(_arrive(rng, P), rng, P, ip=ip, profile=profile)
        if sensor_roll < 0.10:  # an older client: one GPS point
            last = r["trail"]["fixes"][-1]
            r["trail"] = trail_mod.legacy_trail({"lat": last["lat"], "lng": last["lng"]})
        else:  # no recording and no location at all (consent declined, permission denied)
            r["trail"] = {"v": 1, "fixes": [], "windows": [], "sensors": {}, "env": {"tz_offset_min": 330}, "started_at": None, "ended_at": None, "time_origin": None}
        return r
    return _row(_arrive(rng, P, sensor=sensor_roll >= 0.40), rng, P, ip=ip, profile=profile)


def n_vpn_foreign_genuine_walk(rng, P):
    """A genuine-looking approach (the phone really walks to the site) from a VPN/hosting exit in ANOTHER country.
    LABEL ASSUMPTION (1 = send to review): a network in another country than the claimed area cannot be told apart from a spoofer
    who routes through one, and the policy chosen here is review, not accept. Replaces the old h_vpn (NL exit, label 0), which
    taught the classifier that the lowest environment scores are safe (DEFECT 1)."""
    return _blind_row(rng, P, ip=_ip(rng, "vpn_foreign", P), profile=_maybe_new_site(rng))


def n_isp_foreign_genuine_walk(rng, P):
    """Same, from an ordinary ISP in another country (the worker's phone really is elsewhere in the world). LABEL ASSUMPTION: 1 (review)."""
    return _blind_row(rng, P, ip=_ip(rng, "isp_foreign", P), profile=_maybe_new_site(rng))


def n_vpn_same_country_honest(rng, P):
    """An honest worker on a VPN / cloud egress that exits in INDIA (own city or a metro hub). LABEL ASSUMPTION: 0. The VPN is a weak
    sign by itself and must not flag an honest worker; the classifier sees only the environment score."""
    return _blind_row(rng, P, ip=_ip(rng, "vpn_in", P))


def n_vpn_same_country_spoof(rng, P):
    """A spoofer (phone at home, a realistic fake walk) behind an in-country VPN. LABEL: 1 (the motion signal carries it)."""
    start = _bearing_point(rng, rng.uniform(200, 600))
    truth_fake = _truth([("walk", start, (0, 0), rng.uniform(1.2, 1.6)), ("stand", (0, 0), 40)])
    fixes = _gps_fixes(truth_fake, rng, P, sigma=rng.uniform(3, 6))
    truth_phone = _truth([("stand", (0, 0), len(truth_fake))])
    return _row((truth_phone, fixes, _windows(truth_phone, rng, P)), rng, P, ip=_ip(rng, "vpn_in", P))


def h_first_visit(rng, P):
    return _row(_arrive(rng, P), rng, P, profile={})


def h_throttled_sensor(rng, P):
    return _row(_arrive(rng, P, hz=6.0), rng, P)


def h_legacy_client(rng, P):
    r = g_walk_hand(rng, P)
    last = r["trail"]["fixes"][-1]
    r["trail"] = trail_mod.legacy_trail({"lat": last["lat"], "lng": last["lng"]})
    return r


def h_short_trail(rng, P):
    truth, fixes, wins = _arrive(rng, P, dist=rng.uniform(40, 100), dwell=15)
    return _row((truth, fixes[-5:], wins[-5:]), rng, P)


def g_odd_network_new_worker(rng, P):
    return _row(_arrive(rng, P), rng, P, net=_net(rng, odd=True))


def f_teleport_still(rng, P):
    """GPS jumps onto the site, the phone sits at home. Half of the fakers' apps add realistic jitter, half are perfectly clean."""
    away = _bearing_point(rng, rng.uniform(3000, 40_000))
    t_home, t_site = rng.uniform(40, 90), rng.uniform(40, 120)
    truth_fake = _truth([("stand", away, t_home), ("stand", (0, 0), t_site)])
    clean = rng.random() < 0.5
    fixes = _gps_fixes(truth_fake, rng, P, sigma=rng.uniform(2.5, 6), fake=clean)
    truth_phone = _truth([("stand", (0, 0), t_home + t_site)])
    return _row((truth_phone, fixes, _windows(truth_phone, rng, P)), rng, P, ip=_ip(rng, "home", P))


def f_static_mock_home(rng, P):
    truth = _truth([("stand", (0, 0), rng.uniform(90, 240))])
    fixes = _gps_fixes(truth, rng, P, sigma=3, fake=True)
    return _row((truth, fixes, _windows(truth, rng, P)), rng, P, ip=_ip(rng, "home", P))


def f_linear_mock_drive(rng, P):
    start = _bearing_point(rng, rng.uniform(1500, 6000))
    truth_fake = _truth([("drive", start, (0, 0), rng.uniform(6, 14)), ("stand", (0, 0), 30)])
    fixes = _gps_fixes(truth_fake, rng, P, sigma=3, fake=True)
    truth_phone = _truth([("stand", (0, 0), len(truth_fake))])
    return _row((truth_phone, fixes, _windows(truth_phone, rng, P)), rng, P, ip=_ip(rng, "home", P))


def f_linear_mock_walk(rng, P):
    start = _bearing_point(rng, rng.uniform(200, 700))
    truth_fake = _truth([("walk", start, (0, 0), rng.uniform(1.2, 1.7)), ("stand", (0, 0), 40)])
    fixes = _gps_fixes(truth_fake, rng, P, sigma=3, fake=True)
    truth_phone = _truth([("stand", (0, 0), len(truth_fake))])
    return _row((truth_phone, fixes, _windows(truth_phone, rng, P)), rng, P, ip=_ip(rng, "home", P))


def f_realistic_spoof_still_phone(rng, P):
    """A good spoofing app: noisy realistic walking path, but the phone is on a table."""
    start = _bearing_point(rng, rng.uniform(200, 600))
    truth_fake = _truth([("walk", start, (0, 0), rng.uniform(1.2, 1.6)), ("stand", (0, 0), 40)])
    fixes = _gps_fixes(truth_fake, rng, P, sigma=rng.uniform(3, 6))
    truth_phone = _truth([("stand", (0, 0), len(truth_fake))])
    return _row((truth_phone, fixes, _windows(truth_phone, rng, P)), rng, P, ip=_ip(rng, "home", P))


def f_mock_replayed_motion(rng, P):
    """The hard case: a frozen mock location plus a recorded walking rhythm played back. Only 'too perfect' and the network can see it."""
    truth = _truth([("stand", (0, 0), rng.uniform(90, 200))])
    fixes = _gps_fixes(truth, rng, P, sigma=3, fake=True)
    return _row((truth, fixes, _windows(truth, rng, P, replay="walk")), rng, P, ip=_ip(rng, "home", P))


def f_wrong_area_network(rng, P):
    """A realistic walk (spoofed path, replayed motion) from a network that is not in this country at all (a far in-country gateway is
    what honest mobile users have, so it is deliberately NOT in this scenario)."""
    start = _bearing_point(rng, rng.uniform(200, 600))
    truth_fake = _truth([("walk", start, (0, 0), rng.uniform(1.2, 1.6)), ("stand", (0, 0), 40)])
    fixes = _gps_fixes(truth_fake, rng, P, sigma=rng.uniform(3, 6))
    ip = _ip(rng, ("abroad", "isp_foreign", "vpn_foreign")[int(rng.integers(0, 3))], P)  # truly another country: an in-country carrier gateway is NOT fraud evidence
    return _row((truth_fake, fixes, _windows(truth_fake, rng, P)), rng, P, ip=ip, net=_net(rng, odd=True))


def _weak_trail(rng, P):
    """Ambiguous evidence by construction: a genuine-looking walk whose phone goes quiet for a third of it, from a network the site has not seen."""
    truth, fixes, wins = _arrive(rng, P)
    third = max(3, len(wins) // 3)
    lo = int(rng.integers(2, max(3, len(wins) - third)))
    for w in wins[lo:lo + third]:
        w.update(acc_rms=0.05, acc_peak=0.2, gyro_rms=2.0, cad_hz=None, cad_pw=None)
    return _row((truth, fixes, wins), rng, P, net=_net(rng, odd=True))


def a_weak_poor_photo(rng, P):
    r = _weak_trail(rng, P)
    r["photo"] = "poor"
    return r


def a_weak_good_photo(rng, P):
    return _weak_trail(rng, P)


NETWORK_ONLY_FRAUD = {"f_wrong_area_network"}  # fraud whose ONLY evidence is the network (see generate())

# name, builder, label, group, rows
SCENARIOS = [
    ("g_walk_hand", g_walk_hand, 0, "genuine", 160),
    ("g_walk_pocket", g_walk_pocket, 0, "genuine", 120),
    ("g_drive_then_walk", g_drive_then_walk, 0, "genuine", 120),
    ("g_at_site", g_at_site, 0, "genuine", 120),
    ("g_bad_photo", g_bad_photo, 0, "genuine", 80),
    ("g_odd_network_new_worker", g_odd_network_new_worker, 0, "genuine", 60),
    ("h_indoor_drift", h_indoor_drift, 0, "hard_genuine", 70),
    ("h_tunnel_dropout", h_tunnel_dropout, 0, "hard_genuine", 70),
    ("h_smooth_highway", h_smooth_highway, 0, "hard_genuine", 70),
    ("h_desktop", h_desktop, 0, "hard_genuine", 50),
    ("n_vpn_same_country_honest", n_vpn_same_country_honest, 0, "hard_genuine", 90),
    ("h_first_visit", h_first_visit, 0, "hard_genuine", 70),
    ("h_throttled_sensor", h_throttled_sensor, 0, "hard_genuine", 60),
    ("h_legacy_client", h_legacy_client, 0, "hard_genuine", 50),
    ("h_short_trail", h_short_trail, 0, "hard_genuine", 50),
    ("f_teleport_still", f_teleport_still, 1, "fraud", 150),
    ("f_static_mock_home", f_static_mock_home, 1, "fraud", 110),
    ("f_linear_mock_drive", f_linear_mock_drive, 1, "fraud", 90),
    ("f_linear_mock_walk", f_linear_mock_walk, 1, "fraud", 90),
    ("f_realistic_spoof_still_phone", f_realistic_spoof_still_phone, 1, "fraud", 110),
    ("f_mock_replayed_motion", f_mock_replayed_motion, 1, "fraud_hard", 110),
    ("f_wrong_area_network", f_wrong_area_network, 1, "fraud_hard", 90),
    ("n_vpn_foreign_genuine_walk", n_vpn_foreign_genuine_walk, 1, "foreign_network", 100),
    ("n_isp_foreign_genuine_walk", n_isp_foreign_genuine_walk, 1, "foreign_network", 80),
    ("n_vpn_same_country_spoof", n_vpn_same_country_spoof, 1, "fraud", 60),
    # ASSUMPTION encoded in the labels (as in the old generator): with the same weak, ambiguous evidence, a poor photo tips the
    # case towards review and a good photo does not. Not learned from real reviewed cases.
    ("a_weak_poor_photo", a_weak_poor_photo, 1, "ambiguous", 100),
    ("a_weak_good_photo", a_weak_good_photo, 0, "ambiguous", 100),
]


def _photo(kind, rng, bad_share):
    if kind == "none":  # no photo could be measured (missing / unreadable upload): the server scores it 0.0
        return 0.0
    if kind == "poor" or rng.random() < bad_share:
        return float(np.clip(rng.beta(2, 4), 0, 1))
    return float(np.clip(rng.beta(8, 2), 0, 1))


def features(r, site=SITE):
    """Run one simulated submission through the real engines -> the classifier's inputs (+ diagnostics).
    r["site"] / r["ip"] may be None: the deployment may have no registered site or no IP database."""
    site = r.get("site", site)
    c = consistency.evaluate(r["trail"], site, None)
    e = environment.evaluate(site=site, network_info=r["net"], profile=r["profile"], ip=r["ip"], tz_offset_min=r["trail"].get("env", {}).get("tz_offset_min"))
    return c, e


def generate(seed=7, *, n_scale=1.0, params=DEFAULT, scenarios=None):
    """-> DataFrame: the 5 classifier inputs, is_fraud, scenario, group, flags."""
    rng = np.random.default_rng(seed)
    rows = []
    for name, builder, label0, group, n in (scenarios or SCENARIOS):
        for _ in range(max(1, int(round(n * n_scale)))):
            label = label0
            r = builder(rng, params)
            # Deployment reality: a quarter of the sites have no registered location yet and, until a geo-IP database is
            # installed, there is no IP context at all. The model must work in those worlds too.
            r["site"] = SITE if rng.random() < 0.75 else None
            if rng.random() < 0.4:
                r["ip"] = None
            if name in NETWORK_ONLY_FRAUD or group == "foreign_network":
                # These scenarios are about the NETWORK and are only defined where it can be compared (a registered site and an IP
                # database). Without them the row would carry no evidence yet be labelled fraud, which teaches the model to flag
                # unremarkable environments. The unknown world is covered by every other scenario (labelled genuine).
                r["site"] = SITE
                if r["ip"] is None:
                    r["ip"] = _ip(rng, "vpn_foreign" if name == "n_vpn_foreign_genuine_walk" else "isp_foreign", params)
            c, e = features(r)
            if label == 0 and rng.random() < 0.04:
                r["photo"] = "none"  # ASSUMPTION (as for poor photos): a missing photo alone is not fraud; it never makes an honest worker's other evidence suspicious
            bad = 0.2 if label == 1 and group in ("fraud", "fraud_hard") else (0.12 if group in ("genuine", "foreign_network") else 0.0)
            rows.append({
                "photo_quality_score": _photo(r["photo"], rng, bad),
                "motion_score": c["motion_consistency"], "ambient_score": e["environment_consistency"],
                "motion_known": int(c["motion_known"]), "env_known": int(e["environment_known"]),
                "is_fraud": label, "scenario": name, "group": group, "flags": " ".join(c["flags"] + e["flags"]),
            })
    df = pd.DataFrame(rows)
    return df.sample(frac=1, random_state=seed).reset_index(drop=True)
