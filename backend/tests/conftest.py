import json
import sys
from pathlib import Path

import pytest
from sqlmodel import SQLModel, create_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    import db
    import photo_service

    engine = create_engine(f"sqlite:///{tmp_path / 't.db'}", connect_args={"check_same_thread": False})
    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(photo_service, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(photo_service, "PHOTO_REQUIRED", True)

    from fastapi.testclient import TestClient

    import main

    with TestClient(main.app) as c:  # runs lifespan -> init_db on the temp engine
        yield c


def submit(client, photo=None, *, client_report=None, override=False, worker="w1", task="t1", site="s1", mime="image/jpeg", **extra):
    payload = {
        "worker_id": worker, "task_id": task, "site_id": site,
        "photo_quality_pass": True, "photo_override": override,
        "gps": {"lat": 12.9, "lng": 77.6},
        "motion_samples": [{"x": 0.6, "y": 0.5, "z": 0.4, "t": i} for i in range(20)],
        "network_info": {"effectiveType": "4g", "downlink": 10, "rtt": 50},
    }
    if client_report is not None:
        payload["photo_quality"] = client_report
    payload.update(extra)
    files = {"photo": ("p.jpg", photo, mime)} if photo is not None else None
    return client.post("/submissions", data={"payload": json.dumps(payload)}, files=files)


def passing_client_report(width=1600, height=1200):
    checks = {i: {"status": "pass", "score": 1, "value": 1} for i in ("blur", "exposure", "resolution", "obstruction", "glare", "shake", "noise")}
    return {"version": 1, "verdict": "pass", "quality_score": 1, "issues": [], "checks": checks,
            "metrics": {"width": width, "height": height, "bytes": 1, "mime": "image/jpeg"}}
