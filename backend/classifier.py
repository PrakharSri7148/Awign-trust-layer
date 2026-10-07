from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap

HERE = Path(__file__).resolve().parent
MODEL_PATH = HERE / "fraud_classifier.pkl"
DATA_PATH = HERE / "synthetic_training_data.csv"

FEATURES = ["photo_quality_score", "motion_score", "ambient_score"]
IMPORTANCE_KEYS = {
    "photo_quality_score": "photo_quality",
    "motion_score": "motion_consistency",
    "ambient_score": "ambient_fingerprint",
}

LOW_RISK_THRESHOLD = 0.3
PHOTO_UNFAVORABLE_BELOW = 0.5
MOTION_UNFAVORABLE_BELOW = 0.4
AMBIENT_UNFAVORABLE_BELOW = 0.5

# Plain-language names for the photo problems the server can report (check ids / flags).
PHOTO_ISSUE_LABELS = {
    "blur": "blurry", "exposure": "exposure", "glare": "glare", "resolution": "low resolution",
    "obstruction": "lens covered", "noise": "noise/compression", "shake": "camera shake", "face": "face not clear",
    "photo_missing": "no photo", "photo_unverified": "photo unverified",
}

REASONS = {
    "photo_quality_score": "Photo quality flagged",
    "motion_score": "Motion mismatch: near-zero movement despite location change",
    "ambient_score": "Site fingerprint mismatch: ambient signal doesn't match known site",
}

if not MODEL_PATH.exists():
    raise RuntimeError(f"{MODEL_PATH.name} not found. Run ./train.sh in backend/ first.")

model = joblib.load(MODEL_PATH)

_background = pd.read_csv(DATA_PATH)[FEATURES].sample(n=50, random_state=0)
explainer = shap.Explainer(model, _background)


def _photo_reason(photo_issues):
    """"Photo quality problem: blurry, glare" from the server's issue ids, when we know them."""
    names = [PHOTO_ISSUE_LABELS[i] for i in (photo_issues or []) if i in PHOTO_ISSUE_LABELS]
    if "no photo" in names:
        return "Photo missing: the submission could not be verified"
    return f"Photo quality problem: {', '.join(dict.fromkeys(names))}" if names else REASONS["photo_quality_score"]


def _is_unfavorable(feature, value):
    if feature == "photo_quality_score":
        return value < PHOTO_UNFAVORABLE_BELOW
    if feature == "motion_score":
        return value < MOTION_UNFAVORABLE_BELOW
    if feature == "ambient_score":
        return value < AMBIENT_UNFAVORABLE_BELOW
    return False


def score_submission(photo_quality_score, motion_score, ambient_score, photo_issues=None):
    """`photo_quality_score`: the server-measured 0..1 aggregate (0 when there was no photo).
    `photo_issues`: ids of the problems found, used only to word the reason."""
    raw = {
        "photo_quality_score": float(photo_quality_score),
        "motion_score": float(motion_score),
        "ambient_score": float(ambient_score),
    }
    X = pd.DataFrame([raw], columns=FEATURES)

    fraud_probability = float(model.predict_proba(X)[0, 1])

    abs_shap = np.abs(explainer(X).values[0])
    total = float(abs_shap.sum())
    if total > 0:
        normalized = abs_shap / total
    else:
        normalized = np.full(len(FEATURES), 1.0 / len(FEATURES))
    feature_importances = {
        IMPORTANCE_KEYS[f]: round(float(v), 4) for f, v in zip(FEATURES, normalized)
    }

    if fraud_probability < LOW_RISK_THRESHOLD:
        top_reason = "No issues detected"
    else:
        ranked = sorted(zip(FEATURES, normalized), key=lambda p: p[1], reverse=True)
        top_reason = next(
            (_photo_reason(photo_issues) if f == "photo_quality_score" else REASONS[f] for f, _ in ranked if _is_unfavorable(f, raw[f])),
            "Elevated risk from combined signals",
        )

    return {
        "fraud_probability": fraud_probability,
        "feature_importances": feature_importances,
        "top_reason": top_reason,
    }
