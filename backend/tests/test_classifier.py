"""The fraud model's use of photo quality (see generate_synthetic_data.py for the assumptions)."""
from classifier import FEATURES, score_submission


def p(photo, motion=0.75, ambient=0.85, issues=None):
    return score_submission(photo, motion, ambient, photo_issues=issues)


def test_feature_is_the_continuous_server_score():
    assert FEATURES[0] == "photo_quality_score"


def test_all_good_is_clean():
    r = p(0.9)
    assert r["fraud_probability"] < 0.1 and r["top_reason"] == "No issues detected"


def test_a_bad_photo_alone_is_not_fraud():
    """Honest workers take bad photos too: poor quality with healthy motion/ambient stays accepted."""
    for photo in (0.0, 0.15, 0.3):
        assert p(photo)["fraud_probability"] < 0.5, photo


def test_photo_quality_breaks_ties_when_other_signals_are_ambiguous():
    bad = p(0.15, motion=0.45, ambient=0.55)
    good = p(0.9, motion=0.45, ambient=0.55)
    assert bad["fraud_probability"] > 0.5 > good["fraud_probability"]
    assert bad["feature_importances"]["photo_quality"] > good["feature_importances"]["photo_quality"]


def test_obvious_fraud_is_still_flagged_whatever_the_photo():
    assert p(0.9, motion=0.10, ambient=0.60)["fraud_probability"] > 0.9
    assert p(0.15, motion=0.30, ambient=0.40)["fraud_probability"] > 0.9


def test_reason_names_the_actual_photo_problems():
    r = p(0.15, motion=0.45, ambient=0.55, issues=["blur", "glare", "no_exif"])
    assert r["top_reason"] == "Photo quality problem: blurry, glare"  # unknown ids are ignored
    assert "Photo missing" in p(0.0, motion=0.45, ambient=0.55, issues=["photo_missing"])["top_reason"]
    assert p(0.15, motion=0.45, ambient=0.55)["top_reason"] == "Photo quality flagged"  # no issue list: generic


def test_importance_keys_are_unchanged_for_the_dashboard():
    r = p(0.5)
    assert set(r["feature_importances"]) == {"photo_quality", "motion_consistency", "ambient_fingerprint"}
    assert abs(sum(r["feature_importances"].values()) - 1) < 0.01
