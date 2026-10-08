"""Sensor fusion engines (F1 geo, F2 windows, F3 consistency, F4 environment): every rule on hand-built trails,
the unknown paths, boundaries and ordering invariants. Pure functions, no database."""
import math

import pytest

from fusion import consistency, environment, geo, ipctx, trail as trail_mod, windows as W

from .fusion_fixtures import SITE, T0, fix, genuine_walk, line, teleport_still, trail, windows


# ---------------------------------------------------------------- F1: geo

def test_haversine_one_degree_of_latitude():
    assert geo.haversine_m(0, 0, 1, 0) == pytest.approx(111_195, rel=1e-3)
    assert geo.haversine_m(12.9, 77.6, 12.9, 77.6) == 0


def test_clean_trail_sorts_drops_duplicates_and_marks_unreliable():
    f = [fix(10, 0, 0), fix(0, 0, 0), fix(0, 5, 5), {"t": "x", "lat": 1, "lng": 1}, fix(5, 0, 0, acc=250)]
    out, info = geo.clean_trail(f)
    assert [x["t"] for x in out] == [T0, T0 + 5000, T0 + 10_000]
    assert info["dropped"] == 2
    assert [x["reliable"] for x in out] == [True, False, True]


def test_a_walker_has_no_jump():
    segs = geo.segments(geo.reliable(geo.clean_trail(line(-200, 0, 0, 0, 0, 143, jitter=3.0))[0]))
    assert geo.detect_jumps(segs) == []


def test_a_teleport_is_a_jump():
    fixes, _ = geo.clean_trail(teleport_still()["fixes"])
    jumps = geo.detect_jumps(geo.segments(fixes))
    assert len(jumps) == 1 and jumps[0]["dist_m"] > 13_000 and jumps[0]["dt_s"] == 5


def test_a_long_fast_move_is_a_jump_even_below_the_speed_limit():
    # 1.5 km in 30 s = 50 m/s (< 55) but more than 1 km in under 60 s
    fixes, _ = geo.clean_trail([fix(0, 0, 0), fix(30, 1500, 0)])
    assert len(geo.detect_jumps(geo.segments(fixes))) == 1


def test_indoor_drift_is_not_a_jump():
    """150 m of wobble in 5 s with 80 m accuracy: the accuracy explains most of it."""
    fixes, _ = geo.clean_trail([fix(0, 0, 0, acc=80), fix(5, 150, 0, acc=80), fix(10, 0, 0, acc=80)])
    assert geo.detect_jumps(geo.segments(geo.reliable(fixes))) == []


def test_a_tunnel_dropout_followed_by_a_reacquire_is_not_a_jump():
    fixes, _ = geo.clean_trail([fix(0, 0, 0), fix(5, 65, 0), fix(95, 1265, 0)])  # 90 s gap, 13 m/s
    assert geo.detect_jumps(geo.segments(fixes)) == []


def test_unreliable_fixes_never_make_a_jump():
    fixes, _ = geo.clean_trail([fix(0, 0, 0), fix(5, 20_000, 0, acc=500), fix(10, 0, 0)])
    assert geo.detect_jumps(geo.segments(geo.reliable(fixes))) == []


@pytest.mark.parametrize("name,fixes,expected", [
    ("walker", line(-200, 0, 0, 0, 0, 143, jitter=3.0), "moving"),
    ("stationary with jitter", line(0, 0, 0, 0, 0, 60, jitter=4.0, acc=8), "still"),
    ("driver", line(0, 0, 1500, 0, 0, 120, jitter=3.0), "vehicle"),
])
def test_block_speed_classes(name, fixes, expected):
    rel = geo.reliable(geo.clean_trail(fixes)[0])
    cls, eff, _ = geo.block_speed(rel, [], rel[len(rel) // 2]["t"])
    assert cls == expected, (name, eff)


def test_block_speed_unknown_when_fixes_are_sparse_and_jump_when_one_is_inside():
    rel = geo.reliable(geo.clean_trail([fix(0, 0, 0), fix(100, 50, 0)])[0])
    assert geo.block_speed(rel, [], rel[0]["t"])[0] == "unknown"
    rel2 = geo.reliable(geo.clean_trail(teleport_still()["fixes"])[0])
    jumps = geo.detect_jumps(geo.segments(rel2))
    assert geo.block_speed(rel2, jumps, T0 + 62_000)[0] == "jump"


def test_a_walker_with_poor_accuracy_is_ambiguous_not_still():
    rel = geo.reliable(geo.clean_trail(line(-200, 0, 0, 0, 0, 143, acc=40))[0])
    cls, _, _ = geo.block_speed(rel, [], rel[len(rel) // 2]["t"])
    assert cls == "ambiguous"  # 40 m accuracy cannot tell standing from walking: never 'still' on this evidence


def test_mock_signatures_frozen_position_and_ruler_path():
    frozen = geo.mock_signatures(geo.clean_trail(line(0, 0, 0, 0, 0, 60, jitter=0.0, acc=5))[0])
    assert frozen["too_perfect"] and frozen["pos_std_m"] < 0.01
    ruler = geo.mock_signatures(geo.clean_trail(line(0, 0, 400, 0, 0, 100, jitter=0.0, acc=5))[0])
    assert ruler["too_perfect"] and ruler["linear_residual_m"] < 1.0
    real = geo.mock_signatures(geo.clean_trail(line(0, 0, 0, 0, 0, 60, jitter=3.0, acc=8))[0])
    assert not real["too_perfect"]
    short = geo.mock_signatures(geo.clean_trail(line(0, 0, 0, 0, 0, 10, jitter=0.0, acc=5))[0])
    assert not short["too_perfect"]  # not enough fixes/time to say


def test_site_relations():
    fixes = geo.clean_trail(line(-200, 0, 0, 0, 0, 143, jitter=0.0))[0]
    r = geo.site_relations(fixes, SITE)
    assert r["start_m"] == pytest.approx(200, abs=2) and r["end_inside"] and not r["end_outside"]
    far = geo.site_relations(geo.clean_trail(line(500, 0, 500, 0, 0, 30))[0], SITE)
    assert far["end_outside"]
    assert geo.site_relations(fixes, None) is None and geo.site_relations([], SITE) is None


# ---------------------------------------------------------------- F2: windows / activity

def _signal(f_hz, amp, hz=50, secs=5.0, noise=0.0):
    import random
    rng = random.Random(5)
    n = int(hz * secs)
    return [{"t": T0 + i * 1000.0 / hz, "x": amp * math.sin(2 * math.pi * f_hz * i / hz) + rng.gauss(0, noise), "y": 0.0, "z": 0.0,
             "alpha": 3.0, "beta": 0.0, "gamma": 0.0} for i in range(n)]


def test_walking_rhythm_is_detected():
    f = W.window_features(_signal(1.9, 2.0, noise=0.2))
    assert f["cad_hz"] == pytest.approx(1.9, abs=0.2) and f["cad_pw"] > 0.8
    assert f["acc_rms"] > 1.0 and f["hz"] == pytest.approx(50, abs=1)
    assert W.activity(f) == "walking"


def test_flat_signal_is_still_and_has_no_cadence():
    f = W.window_features([{"t": T0 + i * 20.0, "x": 0.01, "y": 0.0, "z": 0.0, "alpha": 0.5, "beta": 0.0, "gamma": 0.0} for i in range(250)])
    assert f["cad_hz"] is None and W.activity(f) == "still"


def test_low_sensor_rate_means_cadence_unknown_but_energy_still_counts():
    f = W.window_features(_signal(1.9, 2.0, hz=10))
    assert f["cad_hz"] is None and f["cad_pw"] is None
    assert W.activity(f) == "moving"  # energy without a judgeable rhythm: not 'still'


def test_no_sensor_is_unknown_never_still():
    f = W.window_features([{"t": T0 + i * 20.0, "x": None, "y": None, "z": None, "alpha": None, "beta": None, "gamma": None} for i in range(100)])
    assert f["n"] == 0 and f["acc_rms"] is None and W.activity(f) == "unknown"
    assert W.window_features([])["acc_rms"] is None


def test_gyro_alone_can_say_the_phone_is_moving():
    assert W.activity({"acc_rms": None, "gyro_rms": 60.0}) == "moving"
    assert W.activity({"acc_rms": None, "gyro_rms": 1.0}) == "still"


def test_split_windows_groups_by_time():
    ss = _signal(1.9, 2.0, secs=10.0)
    ws = W.split_windows(ss, T0, T0 + 10_000)
    assert len(ws) == 2 and all(w["acc_rms"] > 1 for w in ws)


# ---------------------------------------------------------------- F3: consistency

def test_a_genuine_walk_to_the_site_is_consistent():
    r = consistency.evaluate(genuine_walk(), SITE)
    assert r["motion_known"] and r["motion_consistency"] >= 0.9, r["penalties"]
    assert r["flags"] == [] and r["reason"] is None
    assert r["evidence"]["rhythm_share"] > 0.5


def test_teleport_with_a_still_phone_is_the_headline_spoof():
    r = consistency.evaluate(teleport_still(), SITE)
    assert r["motion_known"] and "gps_jump_flat_motion" in r["flags"]
    assert r["motion_consistency"] < 0.35
    assert "jumped" in r["reason"] and "still" in r["reason"]


def test_the_same_jump_with_real_movement_around_it_is_not_flat():
    flat = consistency.evaluate(teleport_still("still"), SITE)
    moving = consistency.evaluate(teleport_still("walk"), SITE)
    assert "gps_jump_flat_motion" not in moving["flags"] and "gps_jump_with_motion" in moving["flags"]
    assert moving["motion_consistency"] > flat["motion_consistency"] + 0.3


def test_a_jump_with_no_sensor_data_is_flagged_but_only_unverified():
    r = consistency.evaluate(trail(teleport_still()["fixes"], []), None)
    assert r["motion_known"] and "gps_jump" in r["flags"] and "gps_jump_flat_motion" not in r["flags"]
    assert 0.4 < r["motion_consistency"] < 0.8


def test_gps_walking_with_a_phone_that_never_moves_is_flat_motion():
    t = trail(line(-200, 0, 0, 0, 0, 143, jitter=3.0), windows(["still"] * 29))
    r = consistency.evaluate(t, None)
    assert "flat_motion_while_moving" in r["flags"] and r["motion_consistency"] < 0.5


def test_stopping_at_the_site_is_not_flat_motion_even_though_the_gps_block_still_says_moving():
    """GPS speed is estimated over a 30 s block, so just after a walker stops the block still says 'moving' while the phone is still."""
    for stop_s in (100, 120, 145):  # the walker (and the phone) stop here, then stand for another minute
        fixes = line(-stop_s * 1.4, 0, 0, 0, 0, stop_s, jitter=3.0) + line(0, 0, 0, 0, stop_s + 5, stop_s + 65, jitter=3.0, seed=2)
        n = int((stop_s + 65) // 5)
        t = trail(fixes, windows(["walk"] * (stop_s // 5) + ["still"] * (n - stop_s // 5)))
        r = consistency.evaluate(t, None)
        assert r["motion_consistency"] >= 0.9 and "flat_motion_while_moving" not in r["flags"], (stop_s, r["penalties"])
    # ...but a phone that is still for the WHOLE stretch the GPS calls walking is still caught
    flat = consistency.evaluate(trail(line(-200, 0, 0, 0, 0, 143, jitter=3.0), windows(["still"] * 29)), None)
    assert "flat_motion_while_moving" in flat["flags"] and flat["motion_consistency"] < 0.5
    # ...and so is a phone that stops 40 s before the GPS stops
    early = consistency.evaluate(trail(line(-200, 0, 0, 0, 0, 143, jitter=3.0), windows(["walk"] * 12 + ["still"] * 17)), None)
    assert early["motion_consistency"] < 0.95 and early["penalties"].get("flatWhileMoving", 0) > 0


def test_a_vehicle_with_quiet_sensors_is_penalised_less_than_a_walker_with_quiet_sensors():
    car = consistency.evaluate(trail(line(0, 0, 1500, 0, 0, 120, jitter=3.0), windows(["still"] * 24)), None)
    walk = consistency.evaluate(trail(line(-200, 0, 0, 0, 0, 143, jitter=3.0), windows(["still"] * 29)), None)
    assert car["motion_consistency"] > walk["motion_consistency"]


def test_a_drive_with_ordinary_vibration_is_consistent():
    r = consistency.evaluate(trail(line(0, 0, 1500, 0, 0, 120, jitter=3.0), windows(["ride"] * 24)), None)
    assert r["motion_known"] and r["flags"] == [] and r["motion_consistency"] >= 0.88


def test_standing_still_at_the_site_is_consistent_not_suspicious():
    t = trail(line(0, 0, 0, 0, 0, 120, jitter=3.0), windows(["still"] * 24))
    r = consistency.evaluate(t, SITE)
    assert r["motion_known"] and r["flags"] == [] and r["motion_consistency"] >= 0.85


def test_arriving_without_any_approach_movement():
    # starts 300 m away, ends on the site (a jump-free glide the phone never felt)
    t = trail(line(-300, 0, 0, 0, 0, 300, dt=10, jitter=2.0), windows(["still"] * 60))
    r = consistency.evaluate(t, SITE)
    assert "arrival_without_approach" in r["flags"]


def test_ending_outside_the_site_is_flagged_and_lowers_the_score():
    t = trail(line(500, 0, 500, 0, 0, 60, jitter=2.0), windows(["still"] * 12))
    r = consistency.evaluate(t, SITE)
    assert "gps_outside_site" in r["flags"] and r["motion_consistency"] < 0.7


def test_too_perfect_gps_is_a_weak_flag_and_not_counted_for_a_laptop():
    frozen = trail(line(0, 0, 0, 0, 0, 60, jitter=0.0, acc=5), windows(["still"] * 12))
    r = consistency.evaluate(frozen, SITE)
    assert "gps_too_perfect" in r["flags"] and 0.5 < r["motion_consistency"] < 0.85
    laptop = trail(line(0, 0, 0, 0, 0, 60, jitter=0.0, acc=60), [])  # WiFi positioning repeats itself, no motion sensor
    assert "gps_too_perfect" not in consistency.evaluate(laptop, None)["flags"]


def test_unknown_is_neutral_not_suspicious():
    for t, site in [({}, None), (trail([], []), None), (trail(line(0, 0, 0, 0, 0, 5), []), None), (trail(line(0, 0, 0, 0, 0, 60, jitter=3.0), windows([None] * 12)), None)]:
        r = consistency.evaluate(t, site)
        assert r["motion_known"] is False and r["motion_consistency"] == 0.5 and r["flags"] == [], t


def test_more_flat_windows_never_raise_the_score():
    fixes = line(-200, 0, 0, 0, 0, 143, jitter=3.0)
    prev = 2.0
    for n_flat in range(0, 30, 4):
        kinds = ["still"] * n_flat + ["walk"] * (29 - n_flat)
        s = consistency.evaluate(trail(fixes, windows(kinds)), None)["motion_consistency"]
        assert s <= prev + 1e-9, (n_flat, s, prev)
        prev = s


def test_noise_only_accelerometer_does_not_fake_a_walking_rhythm():
    # energy but no rhythm: not 'still' (no flat penalty) and not 'walking' (no rhythm bonus)
    r = consistency.evaluate(trail(line(-200, 0, 0, 0, 0, 143, jitter=3.0), windows(["noisy"] * 29)), None)
    assert "flat_motion_while_moving" not in r["flags"] and r["evidence"]["rhythm_share"] == 0


def test_a_spoof_with_replayed_walking_motion_on_a_static_mock_is_only_caught_by_the_weak_signs():
    """The honest limit: realistic motion replayed on a frozen mock location passes the motion rules; only 'too perfect' can see it."""
    t = trail(line(0, 0, 0, 0, 0, 120, jitter=0.0, acc=5), windows(["walk"] * 24))
    r = consistency.evaluate(t, SITE)
    assert "gps_jump_flat_motion" not in r["flags"] and "flat_motion_while_moving" not in r["flags"]
    assert "gps_too_perfect" in r["flags"]


def test_raw_snippet_cross_check():
    t = genuine_walk()
    origin = T0 - 1_000_000
    quiet = [{"t": (T0 + 100_000 + i * 20) - origin, "x": 0.01, "y": 0.0, "z": 0.0} for i in range(150)]
    t["time_origin"] = origin
    r = consistency.evaluate(t, SITE, {"time_origin": origin, "samples": quiet})  # windows say walking, raw says still
    assert "window_raw_mismatch" in r["flags"]
    honest = [{"t": (T0 + 20_000 + i * 20) - origin, "x": 1.8 * math.sin(2 * math.pi * 1.9 * i / 50), "y": 0.0, "z": 0.0} for i in range(150)]
    assert "window_raw_mismatch" not in consistency.evaluate(t, SITE, {"time_origin": origin, "samples": honest})["flags"]


# ---------------------------------------------------------------- F4: environment

PROFILE = {"link": {"4g|3|<50": 5}, "asn": {"AS55836": 5}}
NET = {"effectiveType": "4g", "downlink": 10, "rtt": 40}


def test_cold_start_is_unknown_not_a_trusted_baseline():
    r = environment.evaluate(site=SITE, network_info=NET, profile={})
    assert r["environment_known"] is False and r["environment_consistency"] == 0.5 and r["flags"] == []
    thin = environment.evaluate(site=SITE, network_info=NET, profile={"link": {"3g|2|<150": 2}})
    assert thin["environment_known"] is False


def test_a_known_network_matches_and_an_unseen_one_is_a_mild_penalty():
    ok = environment.evaluate(site=SITE, network_info=NET, profile=PROFILE)
    assert ok["environment_known"] and ok["environment_consistency"] == 1.0
    new = environment.evaluate(site=SITE, network_info={"effectiveType": "3g", "downlink": 1.2, "rtt": 300}, profile=PROFILE)
    assert new["environment_known"] and 0.7 < new["environment_consistency"] < 1.0 and "network_unseen_at_site" in new["flags"]


def test_browser_without_network_info_gives_no_key_instead_of_a_shared_fake_one():
    assert environment.link_key({"effectiveType": None, "downlink": None, "rtt": None}) is None
    assert environment.link_key(NET) == "4g|3|<50"
    r = environment.evaluate(site=SITE, network_info={}, profile=PROFILE)
    assert r["environment_known"] is False


def test_ip_far_from_the_site_and_other_country():
    near = dict(ip="1.1.1.1", private=False, country="IN", lat=13.0, lng=77.6, asn=55836, org="Reliance Jio")
    assert environment.evaluate(site=SITE, network_info=NET, profile={}, ip=near)["environment_consistency"] == 1.0
    far = {**near, "lat": 19.07, "lng": 72.87}  # Mumbai, ~840 km
    r = environment.evaluate(site=SITE, network_info=NET, profile={}, ip=far)
    assert "ip_region_mismatch" in r["flags"] and 0.5 < r["environment_consistency"] < 0.8
    abroad = {**near, "country": "US", "lat": 40.7, "lng": -74.0}
    r2 = environment.evaluate(site=SITE, network_info=NET, profile={}, ip=abroad)
    assert "ip_country_mismatch" in r2["flags"] and r2["environment_consistency"] < r["environment_consistency"]


def test_hosting_and_vpn_networks_are_flagged_weakly():
    ip = dict(ip="1.1.1.1", private=False, country="IN", lat=13.0, lng=77.6, asn=14061, org="DigitalOcean, LLC")
    r = environment.evaluate(site=SITE, network_info=NET, profile={}, ip=ip)
    assert "anonymizing_network" in r["flags"] and r["environment_consistency"] >= 0.6


def test_private_or_unavailable_ip_is_unknown():
    r = environment.evaluate(site=SITE, network_info={}, profile={}, ip={"ip": "192.168.1.5", "private": True})
    assert r["environment_known"] is False
    assert environment.evaluate(site=SITE, network_info={}, profile={}, ip=None)["environment_known"] is False


def test_timezone_alone_never_makes_the_result_known():
    r = environment.evaluate(site=SITE, network_info={}, profile={}, tz_offset_min=-480)
    assert r["environment_known"] is False and "tz_mismatch" in r["flags"]
    ok = environment.evaluate(site=SITE, network_info={}, profile={}, tz_offset_min=330)
    assert "tz_mismatch" not in ok["flags"]


def test_native_radio_overlap_and_no_overlap():
    prof = {"wifi": {"aa": 4, "bb": 3}}
    hit = environment.evaluate(site=SITE, network_info={}, profile=prof, radio={"wifi": [{"bssid_h": "aa", "rssi": -50}]})
    assert hit["environment_known"] and hit["environment_consistency"] == 1.0
    miss = environment.evaluate(site=SITE, network_info={}, profile=prof, radio={"wifi": [{"bssid_h": "zz", "rssi": -50}]})
    assert "wifi_not_seen_at_site" in miss["flags"] and miss["environment_consistency"] <= 0.4
    cold = environment.evaluate(site=SITE, network_info={}, profile={}, radio={"wifi": [{"bssid_h": "zz"}]})
    assert cold["environment_known"] is False


def test_keys_are_what_would_be_learned():
    k = environment.keys_for(NET, {"asn": 55836}, {"wifi": [{"bssid_h": "aa"}], "cell": [{"mcc": 404, "mnc": 10, "tac": 1, "cid": 7}]})
    assert k == {"link": ["4g|3|<50"], "asn": ["AS55836"], "wifi": ["aa"], "cell": ["404-10-1-7"]}


# ---------------------------------------------------------------- ip context

class FakeReader:
    def __init__(self, rec):
        self.rec = rec

    def get(self, ip):
        if self.rec == "boom":
            raise RuntimeError("corrupt")
        return self.rec


def test_dbip_provider_reads_the_documented_record_shapes():
    city = FakeReader({"country": {"iso_code": "IN", "names": {"en": "India"}}, "subdivisions": [{"names": {"en": "Karnataka"}}],
                       "city": {"names": {"en": "Bengaluru"}}, "location": {"latitude": 12.97, "longitude": 77.59}})
    asn = FakeReader({"autonomous_system_number": 55836, "autonomous_system_organization": "Reliance Jio Infocomm"})
    ctx = ipctx.DbIpProvider(city, asn).lookup("49.36.1.1")
    assert (ctx.country, ctx.region, ctx.city, ctx.asn) == ("IN", "Karnataka", "Bengaluru", 55836) and ctx.lat == 12.97


def test_private_addresses_and_broken_databases_never_raise():
    p = ipctx.DbIpProvider(FakeReader({"country": {"iso_code": "IN"}}), None)
    assert p.lookup("192.168.0.4").private and p.lookup("127.0.0.1").private
    assert p.lookup("testclient") is None and p.lookup("not an ip") is None
    assert ipctx.DbIpProvider(FakeReader("boom"), None).lookup("8.8.8.8") is None
    assert ipctx.NullProvider().lookup("8.8.8.8") is None


def test_client_ip_only_believes_a_header_you_configured(monkeypatch):
    class Req:
        client = type("C", (), {"host": "9.9.9.9"})()
        headers = {"x-forwarded-for": "1.2.3.4, 5.6.7.8"}
    monkeypatch.delenv("TRUSTED_PROXY_HEADER", raising=False)
    assert ipctx.client_ip(Req()) == "9.9.9.9"
    monkeypatch.setenv("TRUSTED_PROXY_HEADER", "X-Forwarded-For")
    assert ipctx.client_ip(Req()) == "1.2.3.4"


# ---------------------------------------------------------------- trail parsing / validation

def test_parse_accepts_a_good_trail_and_drops_junk_rows():
    t = genuine_walk()
    out, flags = trail_mod.parse({**t, "fixes": t["fixes"] + [{"t": "bad"}, "x", {"t": 1, "lat": 200, "lng": 0}]})
    assert flags == [] and len(out["fixes"]) == len(t["fixes"]) and len(out["windows"]) == len(t["windows"])


@pytest.mark.parametrize("raw", ["x", [1], {"fixes": "no"}, {"fixes": [{}] * 241}, {"windows": [{}] * 121}, {"fixes": [{"t": 1, "lat": 1, "lng": 1, "x": "y" * 300_000}]}])
def test_parse_rejects_malformed_or_oversize_trails_with_a_flag_not_an_exception(raw):
    out, flags = trail_mod.parse(raw)
    assert out is None and flags == ["trail_invalid"]


def test_parse_none_is_just_no_trail():
    assert trail_mod.parse(None) == (None, [])


def test_check_times_catches_a_replayed_or_future_trail():
    t, _ = trail_mod.parse(genuine_walk())
    visit_start = T0 - 5_000
    now = T0 + 300_000
    assert trail_mod.check_times(t, visit_start, now) == []
    assert "trail_replayed" in trail_mod.check_times(t, T0 + 10_000_000, T0 + 10_300_000)  # the visit began long after the trail
    assert "trail_invalid" in trail_mod.check_times(t, visit_start, T0 - 10_000_000)  # claims times in the server's future


def test_legacy_single_point_makes_a_one_fix_trail():
    t = trail_mod.legacy_trail({"lat": 12.9, "lng": 77.6})
    assert len(t["fixes"]) == 1 and t["windows"] == []
    assert trail_mod.legacy_trail(None) is None and trail_mod.legacy_trail({"lat": None, "lng": 1}) is None
    r = consistency.evaluate(t, {"lat": 12.9, "lng": 77.6, "radius_m": 100})
    assert r["motion_known"] and r["flags"] == []  # at the site, GPS-only check
    far = consistency.evaluate(t, {"lat": 13.5, "lng": 77.6, "radius_m": 100})
    assert "gps_outside_site" in far["flags"]
