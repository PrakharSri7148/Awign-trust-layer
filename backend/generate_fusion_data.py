"""Generate the SYNTHETIC training data for the sensor-fusion model: simulated GPS trails + phone sensors + network,
pushed through the real fusion engines (fusion/simulate.py). Deterministic for a seed.

    python generate_fusion_data.py          -> synthetic_fusion_data.csv
"""
from pathlib import Path

from fusion import simulate

OUT_PATH = Path(__file__).resolve().parent / "synthetic_fusion_data.csv"
SEED = 7

if __name__ == "__main__":
    df = simulate.generate(seed=SEED)
    df.to_csv(OUT_PATH, index=False)
    print(f"Wrote {len(df)} rows to {OUT_PATH}")
    print(df.groupby(["group", "scenario"]).size().to_string())
    print(df["is_fraud"].value_counts().rename("count").to_string())
