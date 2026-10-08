"""Sensor fusion tools and data: retention purge, geo-IP download, the simulator, the migration."""
import gzip
import io
import json
import sqlite3
import urllib.error
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlmodel import Session, select

from fusion import ipctx, simulate

from .fusion_fixtures import genuine_walk, teleport_still
from .test_fusion_api import live, open_visit, set_site, sub


# ---------------------------------------------------------------- purge_trails

def test_purge_trails_removes_coordinates_but_keeps_scores_and_flags(client, monkeypatch):
    import db
    from models import Submission
    from tools import purge_trails

    set_site(client)
    v = open_visit(client, monkeypatch)
    b = sub(client, live(teleport_still()), visit=v)
    with Session(db.engine) as s:
        row = s.get(Submission, b["id"])
        assert json.loads(row.fusion_report)["trail"]["points"]
        row.timestamp = datetime.now(timezone.utc) - timedelta(days=90)
        s.add(row)
        s.commit()
        dry = purge_trails.purge(s, 30, apply=False)
        assert dry["submissions"] == 1 and dry["points"] > 10 and dry["applied"] is False
        assert json.loads(s.get(Submission, b["id"]).fusion_report)["trail"]["points"]  # a dry run changes nothing
        done = purge_trails.purge(s, 30, apply=True)
        again = purge_trails.purge(s, 30, apply=True)
        rep = json.loads(s.get(Submission, b["id"]).fusion_report)
    assert done["points"] == dry["points"] and again["points"] == 0
    assert rep["trail"]["points"] == [] and rep["trail"]["purged"] is True
    assert all("from" not in j and "to" not in j for j in rep["motion"]["evidence"]["jumps"])
    assert rep["motion"]["score"] == b["motion_score"] and "gps_jump_flat_motion" in rep["flags"]  # evidence about the decision stays
    assert client.get(f"/submissions/{b['id']}").json()["status"] == "flagged"


def test_purge_trails_leaves_recent_submissions_alone(client, monkeypatch):
    import db
    from tools import purge_trails

    set_site(client)
    v = open_visit(client, monkeypatch)
    sub(client, live(genuine_walk()), visit=v)
    with Session(db.engine) as s:
        assert purge_trails.purge(s, 30, apply=True)["submissions"] == 0


# ---------------------------------------------------------------- fetch_geoip

class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _opener(fail_for=()):
    calls = []

    def opener(url, timeout=0):
        calls.append(url)
        if any(f in url for f in fail_for):
            raise urllib.error.URLError("404")
        return FakeResp(gzip.compress(b"MMDB:" + url.encode()))
    opener.calls = calls
    return opener


def test_fetch_geoip_downloads_unpacks_and_keeps_only_the_newest(tmp_path):
    from tools import fetch_geoip

    (tmp_path / "dbip-city-lite-2020-01.mmdb").write_bytes(b"old")
    got = fetch_geoip.fetch(tmp_path, "2026-10", opener=_opener())
    assert sorted(p.name for p in tmp_path.glob("*.mmdb")) == ["dbip-asn-lite-2026-10.mmdb", "dbip-city-lite-2026-10.mmdb"]
    assert got["city"].read_bytes().startswith(b"MMDB:") and not list(tmp_path.glob(".*part"))


def test_fetch_geoip_falls_back_to_last_month_and_reports_failure(tmp_path):
    from tools import fetch_geoip

    assert fetch_geoip.months(datetime(2026, 1, 15).date()) == ["2026-01", "2025-12"]
    op = _opener(fail_for=("2026-10",))
    monkey_months = lambda: ["2026-10", "2026-09"]  # noqa: E731
    orig, fetch_geoip.months = fetch_geoip.months, monkey_months
    try:
        got = fetch_geoip.fetch(tmp_path, opener=op)
    finally:
        fetch_geoip.months = orig
    assert got["asn"].name == "dbip-asn-lite-2026-09.mmdb"
    with pytest.raises(RuntimeError):
        fetch_geoip.fetch(tmp_path / "x", "2026-10", opener=_opener(fail_for=("lite",)))


def test_no_database_means_no_provider_and_nothing_breaks(tmp_path, monkeypatch):
    monkeypatch.setenv("GEOIP_DIR", str(tmp_path))
    ipctx.set_provider(None)
    try:
        assert isinstance(ipctx.get_provider(), ipctx.NullProvider) and ipctx.get_provider().lookup("8.8.8.8") is None
        assert ipctx.DbIpProvider.from_dir(tmp_path) is None
    finally:
        ipctx.set_provider(None)


# ---------------------------------------------------------------- the simulator

def test_the_simulator_is_deterministic_and_labels_every_row():
    a = simulate.generate(seed=3, n_scale=0.04)
    b = simulate.generate(seed=3, n_scale=0.04)
    pd.testing.assert_frame_equal(a, b)
    assert set(a["is_fraud"]) == {0, 1} and {"photo_quality_score", "motion_score", "ambient_score", "motion_known", "env_known", "scenario", "group"} <= set(a.columns)
    assert a[["photo_quality_score", "motion_score", "ambient_score"]].min().min() >= 0 and a[["photo_quality_score", "motion_score", "ambient_score"]].max().max() <= 1


def test_the_scores_come_out_of_the_real_engines_not_out_of_a_generator():
    """The simulator must not hold the scoring weights, and its rows must move when the engines' thresholds move."""
    import inspect
    from fusion import config as C

    src = inspect.getsource(simulate)
    assert "import config" not in src and "CONSISTENCY" not in src and "ENVIRONMENT" not in src  # it holds no thresholds or weights
    rng = np.random.default_rng(1)
    r = simulate.f_teleport_still(rng, simulate.DEFAULT)
    r["site"] = simulate.SITE
    base, _ = simulate.features(r)
    old = C.CONSISTENCY["weights"]["jumpFlat"]
    C.CONSISTENCY["weights"]["jumpFlat"] = 0.0
    try:
        changed, _ = simulate.features(r)
    finally:
        C.CONSISTENCY["weights"]["jumpFlat"] = old
    assert changed["motion_consistency"] > base["motion_consistency"]


def test_scenarios_behave_like_what_they_claim_to_be():
    df = simulate.generate(seed=5, n_scale=0.2)
    m = df.groupby("scenario")["motion_score"].mean()
    assert m["g_walk_hand"] > 0.9 and m["f_teleport_still"] < 0.5 and m["f_linear_mock_walk"] < 0.5
    assert m["f_teleport_still"] < m["h_smooth_highway"] < m["g_walk_hand"]
    unknown = df[df["motion_known"] == 0]["motion_score"]
    assert len(unknown) and (unknown == 0.5).all()  # unknown is the neutral placeholder, always


def test_the_committed_training_data_is_reproducible():
    import generate_fusion_data

    committed = pd.read_csv(generate_fusion_data.OUT_PATH)
    fresh = simulate.generate(seed=generate_fusion_data.SEED)
    assert len(committed) == len(fresh) and (committed["scenario"] == fresh["scenario"]).all()
    for col in ("photo_quality_score", "motion_score", "ambient_score"):
        assert committed[col].values == pytest.approx(fresh[col].values, abs=1e-6)


# ---------------------------------------------------------------- migration

def test_an_old_database_gets_the_fusion_columns_and_tables(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.execute("""CREATE TABLE submission (id INTEGER NOT NULL, worker_id VARCHAR NOT NULL, task_id VARCHAR NOT NULL,
        site_id VARCHAR NOT NULL, timestamp DATETIME NOT NULL, photo_quality_pass BOOLEAN NOT NULL, motion_score FLOAT NOT NULL,
        ambient_score FLOAT NOT NULL, fraud_probability FLOAT NOT NULL, top_reason VARCHAR NOT NULL,
        feature_importances VARCHAR NOT NULL, status VARCHAR NOT NULL, PRIMARY KEY (id))""")
    con.execute("INSERT INTO submission VALUES (1,'w','t','s','2026-01-01 00:00:00',1,0.7,0.8,0.01,'ok','{}','accepted')")
    con.commit()
    con.close()

    import db

    monkeypatch.setattr(db, "engine", create_engine(f"sqlite:///{path}"))
    db.init_db()
    con = sqlite3.connect(path)
    cols = {r[1] for r in con.execute("PRAGMA table_info(submission)")}
    assert {"fusion_version", "motion_known", "env_known", "fusion_report", "trail_sha256"} <= cols
    assert con.execute("SELECT fusion_version, motion_known, env_known, fusion_report FROM submission").fetchone() == (0, 0, 0, "{}")
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"site", "sitenetworkprofile", "visit"} <= tables
