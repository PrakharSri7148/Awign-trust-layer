from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split

HERE = Path(__file__).resolve().parent
DATA_PATH = HERE / "synthetic_training_data.csv"
MODEL_PATH = HERE / "fraud_classifier.pkl"
FEATURES = ["photo_quality_score", "motion_score", "ambient_score"]


def main():
    df = pd.read_csv(DATA_PATH)
    X = df[FEATURES]
    y = df["is_fraud"]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )

    model = GradientBoostingClassifier(n_estimators=50, max_depth=3, random_state=42)
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    print(f"Accuracy: {accuracy_score(y_test, y_pred):.4f}")
    print(classification_report(y_test, y_pred, target_names=["genuine", "fraud"]))

    joblib.dump(model, MODEL_PATH)
    print(f"Saved model to {MODEL_PATH}")

    explainer = shap.Explainer(model, shap.sample(X_train, 100, random_state=42))
    shap_values = explainer(X_test)
    mean_abs = np.abs(shap_values.values).mean(axis=0)
    print("Mean |SHAP| per feature (test set):")
    for name, val in zip(FEATURES, mean_abs):
        print(f"  {name:20s} {val:.4f}")

    # The point of the new data: a poor photo ALONE must not look like fraud.
    probe = pd.DataFrame(
        [
            {"photo_quality_score": 0.9, "motion_score": 0.75, "ambient_score": 0.85},  # all good
            {"photo_quality_score": 0.15, "motion_score": 0.75, "ambient_score": 0.85},  # honest bad photo
            {"photo_quality_score": 0.9, "motion_score": 0.10, "ambient_score": 0.60},  # spoofed GPS, good photo
            {"photo_quality_score": 0.15, "motion_score": 0.30, "ambient_score": 0.40},  # bad photo + suspicious
            {"photo_quality_score": 0.15, "motion_score": 0.45, "ambient_score": 0.55},  # ambiguous signals + bad photo
            {"photo_quality_score": 0.90, "motion_score": 0.45, "ambient_score": 0.55},  # same signals, good photo
        ]
    )
    print("Fraud probability for probe cases (all good / honest bad photo / spoofed GPS / bad photo + suspicious /")
    print("ambiguous signals + bad photo / ambiguous signals + good photo):")
    print("  ", np.round(model.predict_proba(probe[FEATURES])[:, 1], 3))


if __name__ == "__main__":
    main()
