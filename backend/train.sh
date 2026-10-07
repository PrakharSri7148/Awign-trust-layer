#!/usr/bin/env sh
# Generate synthetic data and train the classifier in one step.
set -e
cd "$(dirname "$0")"
PY="${PYTHON:-python}"
[ -x .venv/bin/python ] && PY=.venv/bin/python
"$PY" generate_synthetic_data.py
"$PY" train_classifier.py
