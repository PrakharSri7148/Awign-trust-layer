import math
import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap

HERE = Path(__file__).resolve().parent
# FUSION_MODEL picks the model file (default: the sensor-fusion model). fraud_classifier_v1.pkl is the old 3-feature
# model, kept for rollback; it still works here because the feature list is read from the loaded model.
MODEL_PATH = HERE / os.environ.get("FUSION_MODEL", "fraud_classifier.pkl")
LEGACY_DATA_PATH = HERE / "synthetic_training_data.csv"
FUSION_DATA_PATH = HERE / "synthetic_fusion_data.csv"
DATA_PATH = FUSION_DATA_PATH  # kept for older imports

# What the model sees. photo_quality_score: the server-measured photo aggregate. motion_score / ambient_score hold
# motion_consistency / environment_consistency for fusion rows (names kept so the database and the dashboard need no change).
# motion_known / env_known are 0/1: 'could not be compared' is a different fact from 'compared and fine'.
FEATURES = ["photo_quality_score", "motion_score", "ambient_score", "motion_known", "env_known"]
# SHAP keys the dashboard already knows. The known-flags are folded into their score's bar.
IMPORTANCE_KEYS = {
    "photo_quality_score": "photo_quality",
    "motion_score": "motion_consistency",
    "motion_known": "motion_consistency",
    "ambient_score": "ambient_fingerprint",
    "env_known": "ambient_fingerprint",
}
BAR_ORDER = ["photo_quality", "motion_consistency", "ambient_fingerprint"]

LOW_RISK_THRESHOLD = 0.3
PHOTO_UNFAVORABLE_BELOW = 0.5
MOTION_UNFAVORABLE_BELOW = 0.75  # a clean trail scores 0.9-1.0; one weak sign (0.72) is already worth a mention
AMBIENT_UNFAVORABLE_BELOW = 0.85

# Plain-language names for the photo problems the server can report (check ids / flags).
PHOTO_ISSUE_LABELS = {
    "blur": "blurry", "exposure": "exposure", "glare": "glare", "resolution": "low resolution",
    "obstruction": "lens covered", "noise": "noise/compression", "shake": "camera shake", "face": "face not clear",
    "photo_missing": "no photo", "photo_unverified": "photo unverified",
}

# Used only when the fusion engines gave no specific sentence. They state what the signal IS, not an invented cause.
REASONS = {
    "photo_quality_score": "Photo quality flagged",
    "motion_score": "Phone movement does not match the GPS trail",
    "ambient_score": "Network environment does not match the claimed area",
}

if not MODEL_PATH.exists():
    raise RuntimeError(f"{MODEL_PATH.name} not found. Run ./train.sh in backend/ first.")

model = joblib.load(MODEL_PATH)
MODEL_FEATURES = list(getattr(model, "feature_names_in_", FEATURES[:3]))
_data = FUSION_DATA_PATH if "motion_known" in MODEL_FEATURES and FUSION_DATA_PATH.exists() else LEGACY_DATA_PATH
_background = pd.read_csv(_data)[MODEL_FEATURES].sample(n=50, random_state=0)
explainer = shap.Explainer(model, _background)


# Environment grid for the monotone guard (see _guarded_probability).
_ENV_GRID = np.round(np.linspace(0.0, 1.0, 101), 4)


def _clean(value, default, lo=0.0, hi=1.0):
    """A finite float clipped to [lo, hi]; anything else (None, NaN, text) becomes `default`. score_submission must never raise."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return min(hi, max(lo, v)) if math.isfinite(v) else default


def _guarded_probability(raw, X):
    """-> (probability, guard_applied). MONOTONE GUARD: with the environment known, P(fraud) must never RISE as the environment
    score FALLS (other inputs fixed), or a worse network could be judged safer than a better one. The trained model is monotone
    in the regions the simulator covers (see train_classifier.py); where a sparse region still bends the curve, the probability is the
    LARGEST one over this environment score and every higher one. Applied only when env_known: an unknown environment (a neutral
    placeholder, not a measurement) is never raised. Only for models that have the env_known input (the v1 model does not)."""
    p = float(model.predict_proba(X)[0, 1])
    if "env_known" not in MODEL_FEATURES or raw["env_known"] < 0.5:
        return p, False
    e = raw["ambient_score"]
    higher = _ENV_GRID[_ENV_GRID > e]
    if higher.size == 0:
        return p, False
    G = pd.concat([X] * len(higher), ignore_index=True)
    G["ambient_score"] = higher
    best = max(p, float(model.predict_proba(G[MODEL_FEATURES])[:, 1].max()))
    return best, best > p + 1e-12


def _importance_shares(X):
    """-> (shares per dashboard bar, exact). SHAP's additivity check can fail for some inputs (seen at environment exactly 0.60);
    that must never become an error on POST /submissions. Fallback 1: the same explainer without the check (the attributions are then
    only approximate). Fallback 2: equal shares. Both are marked approximate (the result carries `explanation: "approximate"`)."""
    exact = True
    try:
        values = explainer(X).values[0]
    except Exception:
        exact = False
        try:
            values = explainer(X, check_additivity=False).values[0]
        except Exception:
            values = None
    folded = dict.fromkeys(BAR_ORDER, 0.0)
    if values is not None and np.all(np.isfinite(values)):
        for name, v in zip(MODEL_FEATURES, np.abs(values)):
            folded[IMPORTANCE_KEYS[name]] += float(v)
    else:
        exact = False
    total = sum(folded.values())
    shares = {k: v / total for k, v in folded.items()} if total > 0 else {k: 1.0 / len(BAR_ORDER) for k in BAR_ORDER}
    return shares, exact


def _photo_reason(photo_issues):
    """"Photo quality problem: blurry, glare" from the server's issue ids, when we know them."""
    names = [PHOTO_ISSUE_LABELS[i] for i in (photo_issues or []) if i in PHOTO_ISSUE_LABELS]
    if "no photo" in names:
        return "Photo missing: the submission could not be verified"
    return f"Photo quality problem: {', '.join(dict.fromkeys(names))}" if names else REASONS["photo_quality_score"]


def _is_unfavorable(feature, value, known=True):
    if feature == "photo_quality_score":
        return value < PHOTO_UNFAVORABLE_BELOW
    if not known:
        return False  # not compared => nothing to blame
    if feature == "motion_score":
        return value < MOTION_UNFAVORABLE_BELOW
    if feature == "ambient_score":
        return value < AMBIENT_UNFAVORABLE_BELOW
    return False


def score_submission(photo_quality_score, motion_score, ambient_score, photo_issues=None, *, motion_known=True, env_known=True,
                     motion_reason=None, env_reason=None):
    """`photo_quality_score`: the server-measured 0..1 aggregate (0 when there was no photo).
    `motion_score` / `ambient_score`: motion_consistency / environment_consistency from fusion/ (or the legacy scores for
    a model that predates it). `*_known`: False when nothing could be compared (the score is then a neutral placeholder).
    `photo_issues`, `motion_reason`, `env_reason`: only used to word the reason."""
    motion_known = bool(motion_known) and math.isfinite(_clean(motion_score, float("nan")))
    env_known = bool(env_known) and math.isfinite(_clean(ambient_score, float("nan")))
    raw = {
        "photo_quality_score": _clean(photo_quality_score, 0.0),
        "motion_score": _clean(motion_score, 0.5),
        "ambient_score": _clean(ambient_score, 0.5),
        "motion_known": 1.0 if motion_known else 0.0,
        "env_known": 1.0 if env_known else 0.0,
    }
    X = pd.DataFrame([raw], columns=FEATURES)[MODEL_FEATURES]

    fraud_probability, guard_applied = _guarded_probability(raw, X)
    shares, exact = _importance_shares(X)
    feature_importances = {k: round(v, 4) for k, v in shares.items()}

    if fraud_probability < LOW_RISK_THRESHOLD:
        top_reason = "No issues detected"
    else:
        ranked = sorted(
            (("photo_quality_score", "photo_quality"), ("motion_score", "motion_consistency"), ("ambient_score", "ambient_fingerprint")),
            key=lambda p: shares[p[1]], reverse=True,
        )
        known = {"photo_quality_score": True, "motion_score": bool(motion_known), "ambient_score": bool(env_known)}
        reason_for = {
            "photo_quality_score": lambda: _photo_reason(photo_issues),
            "motion_score": lambda: motion_reason or REASONS["motion_score"],
            "ambient_score": lambda: env_reason or REASONS["ambient_score"],
        }
        top_reason = next(
            (reason_for[f]() for f, _ in ranked if _is_unfavorable(f, raw[f], known[f])),
            "Elevated risk from combined signals",
        )

    return {
        "fraud_probability": fraud_probability,
        "feature_importances": feature_importances,
        "top_reason": top_reason,
        # How the number and the explanation were obtained (extra keys; the API response does not need them).
        "explanation": "exact" if exact else "approximate",
        "monotone_guard_applied": guard_applied,
    }
