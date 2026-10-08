#!/usr/bin/env sh
# Generate the SYNTHETIC sensor-fusion data (simulated trails through the real engines) and train the classifier.
# The old 3-feature model/data are kept: fraud_classifier_v1.pkl, synthetic_training_data*.csv (generate_synthetic_data.py).
set -e
cd "$(dirname "$0")"
PY="${PYTHON:-python}"
[ -x .venv/bin/python ] && PY=.venv/bin/python
"$PY" generate_fusion_data.py
"$PY" train_classifier.py
