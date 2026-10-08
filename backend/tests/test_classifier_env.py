"""E1 of environment-consistency: the classifier's use of the environment score (SYNTHETIC model; none of these probabilities is
evidence about real workers).

DEFECT 1 (found 2026-10-08): P(fraud) was not monotone in the environment score, so a worse network could be judged safer.
DEFECT 2 (found 2026-10-08): score_submission raised when SHAP's additivity check failed (e.g. environment exactly 0.60).
Both are pinned here, with the cases the demo depends on, run through the REAL environment engine (not hand-typed scores).
"""
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

import classifier
from classifier import score_submission
from fusion import environment

GRID = [round(float(e), 3) for e in np.arange(0, 1.0001, 0.005)]
SITE = {"lat": 12.9259481, "lng": 77.6722586, "radius_m": 100.0, "country": "IN"}
PROFILE = {"link": {"4g|2|<150": 5}, "asn": {"AS24309": 5}}  # a site with a learned network
NET = {"effectiveType": "4g", "downlink": 5, "rtt": 90}


def ip(country, lat, lng, org="Some Telecom", asn=64500):
    return {"ip": "203.0.113.0", "private": False, "country": country, "region": None, "city": None, "lat": lat, "lng": lng, "asn": asn, "org": org}


def env_of(ipd, profile=PROFILE, site=SITE):
    return environment.evaluate(site=site, network_info=NET, profile=profile, ip=ipd, tz_offset_min=330)


def p_of(e, photo=0.9, motion=0.97):
    return score_submission(photo, motion, e["environment_consistency"], motion_known=True, env_known=e["environment_known"],
                            env_reason=e["reason"])


# ---------------------------------------------------------------- DEFECT 1: monotone

@pytest.mark.parametrize("photo,motion", [(0.9, 0.97), (0.5, 0.97), (0.9, 0.8), (0.15, 0.97), (0.9, 0.3), (0.0, 0.6)])
def test_probability_never_rises_as_the_environment_score_falls(photo, motion):
    ps = [score_submission(photo, motion, e, env_known=True)["fraud_probability"] for e in GRID]
    rises = [(GRID[i], round(ps[i], 3), GRID[i + 1], round(ps[i + 1], 3)) for i in range(len(ps) - 1) if ps[i + 1] > ps[i] + 1e-9]
    assert not rises, f"P(fraud) rises as the environment gets better at: {rises[:3]}"


def test_monotone_on_2000_random_inputs():
    rng = np.random.default_rng(11)
    for _ in range(2000):
        photo, motion = float(rng.uniform()), float(rng.uniform())
        lo, hi = sorted(rng.uniform(size=2))
        a = score_submission(photo, motion, float(lo), env_known=True)["fraud_probability"]
        b = score_submission(photo, motion, float(hi), env_known=True)["fraud_probability"]
        assert a >= b - 1e-9, (photo, motion, lo, hi, a, b)


def test_the_guard_only_applies_when_the_environment_is_known():
    """An unknown environment is a neutral placeholder, not a measurement: it is never 'raised' to the worst higher value."""
    for motion_known in (True, False):
        r = score_submission(0.9, 0.97, 0.5, motion_known=motion_known, env_known=False)
        assert r["monotone_guard_applied"] is False


# ---------------------------------------------------------------- DEFECT 2: never raises

def test_score_submission_never_raises_over_the_whole_environment_range():
    for e in GRID:
        r = score_submission(0.9, 0.97, e, env_known=True)
        assert 0.0 <= r["fraud_probability"] <= 1.0
        assert set(r["feature_importances"]) == {"photo_quality", "motion_consistency", "ambient_fingerprint"}


def test_two_thousand_random_inputs_never_raise_and_importances_sum_to_one():
    rng = np.random.default_rng(5)
    for _ in range(2000):
        r = score_submission(float(rng.uniform()), float(rng.uniform()), float(rng.uniform()),
                             motion_known=bool(rng.integers(0, 2)), env_known=bool(rng.integers(0, 2)))
        assert 0.0 <= r["fraud_probability"] <= 1.0 and abs(sum(r["feature_importances"].values()) - 1.0) < 0.01


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), -3.0, 7.0, "x"])
def test_garbage_inputs_never_raise(bad):
    r = score_submission(bad, bad, bad, motion_known=True, env_known=True)
    assert 0.0 <= r["fraud_probability"] <= 1.0


def test_a_shap_additivity_failure_falls_back_to_a_marked_approximate_explanation(monkeypatch):
    real = classifier.explainer

    class Boom:
        calls = 0

        def __call__(self, X, check_additivity=True):
            Boom.calls += 1
            if check_additivity:
                raise RuntimeError("Additivity check failed in TreeExplainer!")
            return real(X, check_additivity=False)

    monkeypatch.setattr(classifier, "explainer", Boom())
    r = score_submission(0.9, 0.97, 0.6, env_known=True)
    assert r["explanation"] == "approximate" and abs(sum(r["feature_importances"].values()) - 1.0) < 0.01
    assert Boom.calls == 2


def test_if_shap_is_completely_broken_the_score_still_comes_back(monkeypatch):
    class Dead:
        def __call__(self, X, **kw):
            raise RuntimeError("boom")

    monkeypatch.setattr(classifier, "explainer", Dead())
    r = score_submission(0.9, 0.97, 0.6, env_known=True)
    assert r["explanation"] == "approximate" and r["fraud_probability"] < 0.5
    assert r["feature_importances"] == {"photo_quality": 0.3333, "motion_consistency": 0.3333, "ambient_fingerprint": 0.3333}


# ---------------------------------------------------------------- the demo cases, through the real environment engine

def test_a_foreign_vpn_exit_is_flagged_with_a_sentence_naming_both_countries():
    e = env_of(ip("NL", 52.37, 4.9, org="M247 Ltd", asn=9009))
    assert "ip_country_mismatch" in e["flags"] and "anonymizing_network" in e["flags"]
    r = p_of(e)
    assert r["fraud_probability"] > 0.5
    assert r["top_reason"] == "The network is in NL, the site is in IN"


def test_a_foreign_isp_is_flagged_even_on_a_new_site_with_no_learned_profile():
    """A country mismatch is the only sign when the site has fewer than 3 visits: the environment score is then exactly 0.30."""
    e = env_of(ip("US", 40.7, -74.0, org="Comcast Cable", asn=7922), profile={})
    assert e["environment_consistency"] == pytest.approx(0.30)
    assert p_of(e)["fraud_probability"] > 0.5


def test_a_foreign_vpn_is_judged_at_least_as_risky_as_a_foreign_isp():
    vpn = p_of(env_of(ip("NL", 52.37, 4.9, org="M247 Ltd", asn=9009)))["fraud_probability"]
    isp = p_of(env_of(ip("US", 40.7, -74.0, org="Comcast Cable", asn=7922)))["fraud_probability"]
    assert vpn >= isp > 0.5


@pytest.mark.parametrize("lat,lng", [(12.97, 77.59), (19.07, 72.87), (28.61, 77.21)])  # own city, Mumbai, Delhi
def test_an_honest_same_country_vpn_is_not_flagged_by_the_vpn_alone(lat, lng):
    e = env_of(ip("IN", lat, lng, org="M247 Ltd", asn=9009))
    assert "anonymizing_network" in e["flags"] and "ip_country_mismatch" not in e["flags"]
    r = p_of(e)
    assert r["fraud_probability"] < 0.5, (e["environment_consistency"], r)


def test_a_carrier_gateway_far_away_in_the_same_country_is_not_flagged():
    e = env_of(ip("IN", 19.07, 72.87, org="Reliance Jio Infocomm", asn=55836))  # 845 km, a known pattern of mobile carriers
    assert "ip_region_mismatch" in e["flags"] and p_of(e)["fraud_probability"] < 0.5


def test_at_home_the_environment_is_clean():
    e = env_of(ip("IN", 12.93, 77.67, org="Atria Convergence Technologies", asn=24309))
    assert e["environment_consistency"] >= 0.9 and p_of(e)["fraud_probability"] < 0.1


# ---------------------------------------------------------------- unknown is not suspicious

@pytest.mark.parametrize("photo", [0.0, 0.15, 0.9])
def test_unknown_environment_never_flags_on_its_own(photo):
    e = environment.evaluate(site=None, network_info=None, profile={}, ip=None, tz_offset_min=None)
    assert e["environment_known"] is False
    r = score_submission(photo, 0.97, e["environment_consistency"], motion_known=True, env_known=False)
    assert r["fraud_probability"] < 0.5


def test_private_or_loopback_addresses_are_unknown_not_far():
    e = environment.evaluate(site=SITE, network_info=None, profile={}, ip={"ip": "127.0.0.1", "private": True}, tz_offset_min=None)
    assert e["environment_known"] is False and not e["flags"]


# ---------------------------------------------------------------- rollback

def test_the_previous_model_is_kept_and_FUSION_MODEL_still_selects_it():
    here = Path(classifier.__file__).parent
    assert (here / "fraud_classifier_v2_pre_env.pkl").exists() and (here / "fraud_classifier_v1.pkl").exists()
    code = ("import classifier as c; r = c.score_submission(0.9, 0.97, 0.5, env_known=True); "
            "print(c.MODEL_PATH.name, c.MODEL_FEATURES == c.FEATURES, 0 <= r['fraud_probability'] <= 1)")
    for name, expect_features in (("fraud_classifier_v2_pre_env.pkl", "True"), ("fraud_classifier_v1.pkl", "False")):
        out = subprocess.run([sys.executable, "-c", code], cwd=here, env={**os.environ, "FUSION_MODEL": name}, capture_output=True, text=True, timeout=120)
        assert out.returncode == 0, out.stderr[-600:]
        assert out.stdout.split()[:3] == [name, expect_features, "True"], out.stdout
