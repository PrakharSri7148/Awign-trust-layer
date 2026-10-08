"""The fraud model's use of photo quality and the two sensor-fusion signals (see fusion/simulate.py for the SYNTHETIC world it
was trained in; none of these probabilities is evidence about real workers)."""
import classifier
from classifier import FEATURES, score_submission


def p(photo, motion=0.97, ambient=0.95, issues=None, **kw):
    return score_submission(photo, motion, ambient, photo_issues=issues, **kw)


def test_features_are_the_photo_score_the_two_consistency_scores_and_their_known_flags():
    assert FEATURES == ["photo_quality_score", "motion_score", "ambient_score", "motion_known", "env_known"]
    assert classifier.MODEL_FEATURES == FEATURES  # the deployed model was trained on exactly these


def test_all_good_is_clean():
    r = p(0.9)
    assert r["fraud_probability"] < 0.1 and r["top_reason"] == "No issues detected"


def test_a_bad_photo_alone_is_not_fraud():
    """Honest workers take bad photos too: poor quality with healthy motion and environment stays accepted."""
    for photo in (0.0, 0.15, 0.3):
        assert p(photo)["fraud_probability"] < 0.5, photo


def test_photo_quality_breaks_ties_when_the_other_evidence_is_weak():
    bad = p(0.15, motion=0.73, ambient=0.78)
    good = p(0.9, motion=0.73, ambient=0.78)
    assert bad["fraud_probability"] > 0.5 > good["fraud_probability"]
    assert bad["feature_importances"]["photo_quality"] > good["feature_importances"]["photo_quality"]


def test_a_gps_jump_with_a_still_phone_is_flagged_whatever_the_photo():
    for photo in (0.95, 0.15):
        assert p(photo, motion=0.15)["fraud_probability"] > 0.9


def test_gps_walking_with_a_phone_that_never_moves_is_flagged():
    assert p(0.9, motion=0.35)["fraud_probability"] > 0.9


def test_a_network_from_another_country_is_flagged_on_its_own():
    assert p(0.9, ambient=0.3)["fraud_probability"] > 0.5


def test_unknown_evidence_never_flags_by_itself():
    """Nothing could be compared (desktop, legacy client, short trail, new site): neither suspicious nor cleared."""
    for photo in (0.9, 0.15, 0.0):
        r = p(photo, motion=0.5, ambient=0.5, motion_known=False, env_known=False)
        assert r["fraud_probability"] < 0.3 and r["top_reason"] == "No issues detected", photo


def test_reason_names_the_actual_photo_problems():
    r = p(0.15, motion=0.76, ambient=0.86, issues=["blur", "glare", "no_exif"])
    assert r["top_reason"] == "Photo quality problem: blurry, glare"  # unknown ids are ignored
    assert "Photo missing" in p(0.15, motion=0.74, ambient=0.9, issues=["photo_missing"])["top_reason"]
    assert p(0.15, motion=0.74, ambient=0.9)["top_reason"] == "Photo quality flagged"  # no issue list: generic


def test_reason_uses_the_fusion_sentence_and_never_the_old_false_one():
    r = p(0.9, motion=0.2, motion_reason="GPS jumped 14.2 km in 4 s while the phone stayed still")
    assert r["top_reason"] == "GPS jumped 14.2 km in 4 s while the phone stayed still"
    assert "location change" not in p(0.9, motion=0.2)["top_reason"]  # the generic text states only what the signal is
    assert p(0.9, ambient=0.3, env_reason="The network is in US, the site is in IN")["top_reason"] == "The network is in US, the site is in IN"


def test_importance_keys_are_unchanged_for_the_dashboard():
    r = p(0.9, motion=0.2)
    assert set(r["feature_importances"]) == {"photo_quality", "motion_consistency", "ambient_fingerprint"}
    assert abs(sum(r["feature_importances"].values()) - 1.0) < 0.01
    assert r["feature_importances"]["motion_consistency"] > 0.5  # the known-flag's share is folded into its score's bar


def test_the_old_three_feature_model_still_loads_for_rollback(monkeypatch):
    """FUSION_MODEL=fraud_classifier_v1.pkl keeps working because the feature list is read from the model file."""
    import importlib

    monkeypatch.setenv("FUSION_MODEL", "fraud_classifier_v1.pkl")
    try:
        old = importlib.reload(classifier)
        assert old.MODEL_FEATURES == ["photo_quality_score", "motion_score", "ambient_score"]
        r = old.score_submission(0.9, 0.75, 0.85)
        assert 0 <= r["fraud_probability"] < 0.2 and set(r["feature_importances"]) == {"photo_quality", "motion_consistency", "ambient_fingerprint"}
    finally:
        monkeypatch.delenv("FUSION_MODEL")
        importlib.reload(classifier)
