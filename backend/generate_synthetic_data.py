from pathlib import Path

import numpy as np
import pandas as pd

OUT_PATH = Path(__file__).resolve().parent / "synthetic_training_data.csv"
N_PER_CASE = 150

# Photo quality is the SERVER-measured aggregate (0 = unusable, 1 = perfect), see
# photo_quality/policy.py. It is deliberately NOT a proxy for fraud: honest workers
# take bad photos too (dim shops, shaky hands), so a low score on its own must not
# push the classifier towards "fraud". It only matters in combination with the
# motion / ambient signals. (The previous data made bad photos perfectly
# coincide with bad motion, so the model learned to ignore the photo feature.)
#
# The one place photo quality is allowed to matter: when motion/ambient are AMBIGUOUS
# (middling scores), a poor photo tips the submission towards review and a good photo
# does not. This is an ASSUMPTION encoded in synthetic data, not something learned from
# real labels; revisit it once real reviewed submissions exist.
#
# name, photo quality Beta(a, b), share of rows with an extra "bad photo" draw,
# (motion mean, sd), (ambient mean, sd), is_fraud
GOOD_PHOTO = (8, 2)  # mean 0.8
POOR_PHOTO = (2, 4)  # mean 0.33
CASES = [
    ("genuine", GOOD_PHOTO, 0.12, (0.75, 0.10), (0.85, 0.10), 0),
    ("honest_bad_photo", POOR_PHOTO, 0.0, (0.75, 0.10), (0.85, 0.10), 0),
    ("spoofed_gps", GOOD_PHOTO, 0.20, (0.10, 0.08), (0.60, 0.15), 1),
    ("wrong_site", GOOD_PHOTO, 0.20, (0.70, 0.10), (0.20, 0.10), 1),
    ("bad_photo_and_suspicious", POOR_PHOTO, 0.0, (0.30, 0.15), (0.40, 0.15), 1),
    ("borderline_bad_photo", POOR_PHOTO, 0.0, (0.45, 0.07), (0.55, 0.07), 1),
    ("borderline_good_photo", GOOD_PHOTO, 0.0, (0.45, 0.07), (0.55, 0.07), 0),
]


def generate(seed=42):
    rng = np.random.default_rng(seed)
    frames = []
    for _name, (pa, pb), bad_share, (m_mu, m_sd), (a_mu, a_sd), fraud in CASES:
        photo = rng.beta(pa, pb, N_PER_CASE)
        # Some rows of the "good photo" cases still get a poor photo (bad light, shaky hands).
        poor = rng.random(N_PER_CASE) < bad_share
        photo = np.where(poor, rng.beta(*POOR_PHOTO, N_PER_CASE), photo)
        frames.append(
            pd.DataFrame(
                {
                    "photo_quality_score": np.clip(photo, 0, 1),
                    "motion_score": np.clip(rng.normal(m_mu, m_sd, N_PER_CASE), 0, 1),
                    "ambient_score": np.clip(rng.normal(a_mu, a_sd, N_PER_CASE), 0, 1),
                    "is_fraud": np.full(N_PER_CASE, fraud, dtype=int),
                }
            )
        )
    df = pd.concat(frames, ignore_index=True)
    return df.sample(frac=1, random_state=seed).reset_index(drop=True)


if __name__ == "__main__":
    df = generate()
    df.to_csv(OUT_PATH, index=False)
    print(f"Wrote {len(df)} rows to {OUT_PATH}")
    print(df["is_fraud"].value_counts().rename("count").to_string())
