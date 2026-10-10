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

from . import imgs
from .fusion_fixtures import SITE, genuine_walk, teleport_still
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


def test_purge_trails_also_removes_the_shortened_ip_and_city_but_keeps_country_and_provider(client, monkeypatch):
    import db
    from fusion import ipctx
    from models import Submission
    from tools import purge_trails

    class P:
        name = "fixed"

        def lookup(self, ip):
            return ipctx.IpContext(ip=ip, country="IN", region="Karnataka", city="Bengaluru", lat=12.9, lng=77.6, asn=24309, org="Atria")

    monkeypatch.setenv("TRUSTED_PROXY_HEADER", "x-forwarded-for")
    ipctx.set_provider(P())
    try:
        set_site(client)
        r = client.post("/submissions", headers={"X-Forwarded-For": "49.36.7.9"},
                        data={"payload": json.dumps({"worker_id": "w1", "task_id": "t1", "site_id": "s1", "photo_quality_pass": True})},
                        files={"photo": ("p.jpg", imgs.good(seed=1), "image/jpeg")}).json()
    finally:
        ipctx.set_provider(None)
    with Session(db.engine) as s:
        row = s.get(Submission, r["id"])
        assert json.loads(row.fusion_report)["ip"]["ip"] == "49.36.7.0"  # the shortened address, never the raw one
        row.timestamp = datetime.now(timezone.utc) - timedelta(days=90)
        s.add(row)
        s.commit()
        dry = purge_trails.purge(s, 30, apply=False)
        assert dry["ip_fields"] == 4 and dry["submissions"] == 1  # shortened address, city, and the network's approximate lat / lng
        assert json.loads(s.get(Submission, r["id"]).fusion_report)["ip"]["ip"] == "49.36.7.0"  # a dry run changes nothing
        purge_trails.purge(s, 30, apply=True)
        assert purge_trails.purge(s, 30, apply=True)["ip_fields"] == 0
        ip = json.loads(s.get(Submission, r["id"]).fusion_report)["ip"]
    assert ip["ip"] is None and ip["city"] is None and ip["lat"] is None and ip["lng"] is None and ip["purged"] is True
    assert (ip["country"], ip["region"], ip["asn"], ip["org"]) == ("IN", "Karnataka", 24309, "Atria")


def test_report_records_where_the_phone_and_the_network_were_and_purge_removes_the_coordinates(client, monkeypatch):
    """The case file's 'Where' block: site country, the phone's last fix, the network's approximate position (a VPN in the US)."""
    import db
    from fusion import ipctx
    from models import Submission
    from tools import purge_trails

    class P:
        name = "fixed"

        def lookup(self, ip):
            return ipctx.IpContext(ip=ip, country="US", region="Virginia", city="Ashburn", lat=39.0438, lng=-77.4874, asn=14061, org="DigitalOcean")

    monkeypatch.setenv("TRUSTED_PROXY_HEADER", "x-forwarded-for")
    set_site(client)
    v = open_visit(client, monkeypatch)
    ipctx.set_provider(P())
    try:
        payload = {"worker_id": "w1", "task_id": "t1", "site_id": "s1", "photo_quality_pass": True, "visit_id": v, "trail": live(genuine_walk())}
        r = client.post("/submissions", headers={"X-Forwarded-For": "64.23.1.9"}, data={"payload": json.dumps(payload)},
                        files={"photo": ("p.jpg", imgs.good(seed=1), "image/jpeg")})
        assert r.status_code == 200, r.text
        b = r.json()
    finally:
        ipctx.set_provider(None)
    rep = client.get(f"/submissions/{b['id']}").json()["fusion"]
    assert rep["site"]["country"] == "IN"
    assert rep["ip"]["country"] == "US" and (rep["ip"]["lat"], rep["ip"]["lng"]) == (39.04, -77.49)  # about 1 km: all the database knows
    pos = rep["position"]
    assert pos["source"] == "trail" and abs(pos["lat"] - SITE["lat"]) < 0.01 and pos["at"] > 0
    with Session(db.engine) as s:
        row = s.get(Submission, b["id"])
        row.timestamp = datetime.now(timezone.utc) - timedelta(days=90)
        s.add(row)
        s.commit()
        purge_trails.purge(s, 30, apply=True)
    rep = client.get(f"/submissions/{b['id']}").json()["fusion"]
    assert rep["position"] is None and rep["ip"]["lat"] is None and rep["ip"]["country"] == "US"


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

    def opener(req, timeout=0):
        url = getattr(req, "full_url", req)
        opener.agents.append(req.get_header("User-agent") if hasattr(req, "get_header") else None)
        calls.append(url)
        if any(f in url for f in fail_for):
            raise urllib.error.URLError("404")
        return FakeResp(gzip.compress(b"MMDB:" + url.encode()))
    opener.calls = calls
    opener.agents = []
    return opener


def test_fetch_geoip_downloads_unpacks_and_keeps_only_the_newest(tmp_path):
    from tools import fetch_geoip

    (tmp_path / "dbip-city-lite-2020-01.mmdb").write_bytes(b"old")
    got = fetch_geoip.fetch(tmp_path, "2026-10", opener=_opener())
    assert sorted(p.name for p in tmp_path.glob("*.mmdb")) == ["dbip-asn-lite-2026-10.mmdb", "dbip-city-lite-2026-10.mmdb"]
    assert got["city"].read_bytes().startswith(b"MMDB:") and not list(tmp_path.glob(".*part"))


def test_fetch_geoip_sends_a_browser_like_user_agent(tmp_path):
    # DB-IP returns 403 to "Python-urllib/3.x" (seen for real on 2026-10-08; curl worked).
    from tools import fetch_geoip

    op = _opener()
    fetch_geoip.fetch(tmp_path, "2026-10", opener=op)
    assert op.agents and all(a and a.startswith("Mozilla/5.0") and "urllib" not in a for a in op.agents)


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


# ---------------------------------------------------------------- demo reset and APK origins

def test_demo_reset_is_a_dry_run_first_and_only_touches_its_own_site(client, monkeypatch):
    import db
    from models import Site, SiteNetworkProfile, Submission, Visit
    from tools import demo_reset

    net = {"effectiveType": "4g", "downlink": 10, "rtt": 40}
    set_site(client, "demo")
    set_site(client, "other")
    for i in range(3):
        sub(client, seed=60 + i, worker=f"w{i}", site="demo", network_info=net)
    sub(client, seed=70, worker="x", site="other", network_info=net)
    open_visit(client, monkeypatch, site="demo")
    from fusion import pipeline as fp

    with Session(db.engine) as s:  # a learned profile for both sites (only accepted visits teach it; seed it directly)
        fp.teach_profile(s, "demo", {"link": ["4g"]})
        fp.teach_profile(s, "other", {"link": ["4g"]})
        s.commit()
    with Session(db.engine) as s:
        dry = demo_reset.reset(s, "demo")
        assert dry["applied"] is False and dry["submissions"] == 3 and dry["visits"] >= 1 and dry["network_profile_rows"] >= 1
        assert len(s.exec(select(Submission)).all()) == 4  # a dry run removes nothing
        done = demo_reset.reset(s, "demo", apply=True)
        assert done["submissions"] == 3
        left = s.exec(select(Submission)).all()
        assert [x.site_id for x in left] == ["other"]  # the other site is untouched
        assert s.get(Site, "demo") is not None and s.get(Site, "other") is not None  # the registered location stays
        assert not [p for p in s.exec(select(SiteNetworkProfile)).all() if p.site_id == "demo"]
        assert [p for p in s.exec(select(SiteNetworkProfile)).all() if p.site_id == "other"]  # the other site keeps its profile
        assert not [v for v in s.exec(select(Visit)).all() if v.site_id == "demo"]
        demo_reset.reset(s, "demo", apply=True, forget_site=True)
        assert s.get(Site, "demo") is None and s.get(Site, "other") is not None


def test_the_apk_origin_and_a_named_tunnel_pass_cors(client, monkeypatch):
    for origin in ("https://localhost", "capacitor://localhost", "http://localhost:5174"):
        r = client.options("/submissions", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})
        assert r.headers.get("access-control-allow-origin") == origin, origin
    r = client.options("/submissions", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in r.headers


def test_case_file_looks_up_the_network_position_of_older_submissions_without_storing_it(client):
    import db
    from models import Submission

    class P:
        name = "fixed"

        def lookup(self, ip):
            assert ip == "64.23.1.0"  # the stored, shortened address
            return ipctx.IpContext(ip=ip, country="US", city="Los Angeles", lat=34.0522, lng=-118.2437)

    set_site(client)
    r = client.post("/submissions", data={"payload": json.dumps({"worker_id": "w1", "task_id": "t1", "site_id": "s1", "photo_quality_pass": True})},
                    files={"photo": ("p.jpg", imgs.good(seed=3), "image/jpeg")}).json()
    with Session(db.engine) as s:  # an older row: city and shortened address, no coordinates
        row = s.get(Submission, r["id"])
        rep = json.loads(row.fusion_report)
        rep["ip"] = {"country": "US", "city": "Los Angeles", "ip": "64.23.1.0", "private": False}
        row.fusion_report = json.dumps(rep)
        s.add(row)
        s.commit()
    ipctx.set_provider(P())
    try:
        ip = client.get(f"/submissions/{r['id']}").json()["fusion"]["ip"]
    finally:
        ipctx.set_provider(None)
    assert (ip["lat"], ip["lng"]) == (34.05, -118.24)
    with Session(db.engine) as s:
        assert "lat" not in json.loads(s.get(Submission, r["id"]).fusion_report)["ip"]  # shown, not stored
