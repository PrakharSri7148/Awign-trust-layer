import json
import os
from pathlib import Path

# The canonical file lives next to the client engine so both read the same numbers.
# Override with PHOTO_QUALITY_THRESHOLDS when the backend is deployed on its own.
_DEFAULT = Path(__file__).resolve().parents[2] / "client" / "src" / "lib" / "photoQuality" / "thresholds.json"
_PATH = Path(os.environ.get("PHOTO_QUALITY_THRESHOLDS", _DEFAULT))

with open(_PATH) as f:
    _RAW = json.load(f)

THRESHOLDS = _RAW["thresholds"]
POLICY = _RAW["policy"]
DEFAULT_TASK = _RAW["default_task"]
TASKS = _RAW["tasks"]


def task_config(task_id):
    """Per-task requirements (face / camera). Unknown tasks get the defaults."""
    return {**DEFAULT_TASK, **TASKS.get(task_id, {})}

REPORT_VERSION = 1
PASS, WARN, FAIL, SKIP = "pass", "warn", "fail", "skip"
V_PASS, V_WARN, V_BLOCK = "pass", "warn", "block"

# Ordered by how much a worker should care (used to sort issues).
CHECK_IDS = ["obstruction", "resolution", "exposure", "blur", "face", "glare", "shake", "noise"]
