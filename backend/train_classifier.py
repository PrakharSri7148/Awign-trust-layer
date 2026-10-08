"""Train the sensor-fusion fraud model on SYNTHETIC data (synthetic_fusion_data.csv, from fusion/simulate.py).

Inputs: photo_quality_score, motion_score (= motion_consistency), ambient_score (= environment_consistency), motion_known,
env_known. The old 3-feature model is kept as fraud_classifier_v1.pkl (rollback: FUSION_MODEL=fraud_classifier_v1.pkl).

The accuracy printed here is a property of the simulator, NOT of real fraud detection: see the accuracy report.
"""
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split

HERE = Path(__file__).resolve().parent
DATA_PATH = HERE / "synthetic_fusion_data.csv"
MODEL_PATH = HERE / "fraud_classifier.pkl"
FEATURES = ["photo_quality_score", "motion_score", "ambient_score", "motion_known", "env_known"]

# name, (photo, motion_consistency, environment_consistency, motion_known, env_known), what a sensible model says
PROBES = [
    ("all good", (0.9, 0.97, 0.95, 1, 1), "accepted"),
    ("honest bad photo, everything else fine", (0.15, 0.97, 0.95, 1, 1), "accepted"),
    ("GPS jump + still phone, perfect photo", (0.9, 0.15, 0.95, 1, 1), "flagged"),
    ("GPS says walking, phone never moves", (0.9, 0.35, 0.95, 1, 1), "flagged"),
    ("frozen mock GPS (too perfect), good photo", (0.9, 0.72, 0.95, 1, 1), "flagged"),
    ("network from another country, motion fine", (0.9, 0.97, 0.3, 1, 1), "flagged"),
    ("nothing could be compared, good photo", (0.9, 0.5, 0.5, 0, 0), "accepted"),
    ("nothing could be compared, poor photo", (0.15, 0.5, 0.5, 0, 0), "accepted"),
    ("weak evidence + bad photo", (0.15, 0.73, 0.78, 1, 1), "flagged"),
    ("weak evidence + good photo", (0.9, 0.73, 0.78, 1, 1), "accepted"),
]


def main():
    df = pd.read_csv(DATA_PATH)
    X, y = df[FEATURES], df["is_fraud"]
    idx_tr, idx_te = train_test_split(np.arange(len(df)), test_size=0.2, stratify=y, random_state=42)
    model = GradientBoostingClassifier(n_estimators=100, max_depth=3, random_state=42)
    model.fit(X.iloc[idx_tr], y.iloc[idx_tr])

    pred = model.predict(X.iloc[idx_te])
    print(f"Accuracy on the held-back 20% of the SIMULATOR's rows: {accuracy_score(y.iloc[idx_te], pred):.4f}  (SYNTHETIC; not real-world accuracy)")
    print(classification_report(y.iloc[idx_te], pred, target_names=["genuine", "fraud"]))
    te = df.iloc[idx_te].assign(p=model.predict_proba(X.iloc[idx_te])[:, 1])
    te["wrong"] = (te["p"] > 0.5) != (te["is_fraud"] == 1)
    print("Error rate by scenario (held-back rows):")
    print(te.groupby("scenario")["wrong"].agg(["mean", "size"]).round(3).to_string())

    joblib.dump(model, MODEL_PATH)
    print(f"Saved model to {MODEL_PATH}")

    explainer = shap.Explainer(model, shap.sample(X.iloc[idx_tr], 100, random_state=42))
    mean_abs = np.abs(explainer(X.iloc[idx_te]).values).mean(axis=0)
    print("Mean |SHAP| per feature (held-back rows):")
    for name, val in zip(FEATURES, mean_abs):
        print(f"  {name:20s} {val:.4f}")

    probe = pd.DataFrame([dict(zip(FEATURES, f)) for _, f, _ in PROBES])
    print("Probe cases (fraud probability, expected):")
    for (name, _, expect), p in zip(PROBES, model.predict_proba(probe[FEATURES])[:, 1]):
        got = "flagged" if p > 0.5 else "accepted"
        print(f"  {p:5.3f}  {got:8s} (expected {expect:8s}{'' if got == expect else '  <-- DIFFERS'})  {name}")


if __name__ == "__main__":
    main()
