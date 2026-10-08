"""Sensor-fusion thresholds. The canonical file lives next to the client recorder so the browser and the server
read the same numbers (same pattern as photo_quality/config.py). Override with FUSION_CONFIG when the backend is
deployed on its own."""
import json
import os
from pathlib import Path

_DEFAULT = Path(__file__).resolve().parents[2] / "client" / "src" / "lib" / "sensorFusion" / "fusion.json"
PATH = Path(os.environ.get("FUSION_CONFIG", _DEFAULT))

with open(PATH) as f:
    CFG = json.load(f)

TRAIL = CFG["trail"]
GEO = CFG["geo"]
ACTIVITY = CFG["activity"]
CONSISTENCY = CFG["consistency"]
ENVIRONMENT = CFG["environment"]
VERSION = CFG["version"]
POLICY = CFG["policy"]


def task_policy(task_id):
    """off | optional | required for this task (fusion.json 'policy')."""
    return POLICY["tasks"].get(task_id, POLICY["default"])
