"""P5: demo_reset (backup, all sites, the in-use guard) and seed_check (read-only)."""
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlmodel import Session, select

import db
from models import Site, SiteNetworkProfile, Submission, Visit
from tools import demo_reset, seed_check

from . import imgs
from .conftest import submit
from .test_fusion_api import set_site, trusted_visit

BACKEND = Path(__file__).resolve().parents[1]


def test_backup_copies_the_database_and_the_photos_and_is_restorable(tmp_path):
    src = tmp_path / "demo.db"
    con = sqlite3.connect(src)
    con.execute("create table t (a text)")
    con.execute("insert into t values ('kept')")
    con.commit()
    con.close()
    photos = tmp_path / "up"
    (photos / "ab").mkdir(parents=True)
    (photos / "ab" / "p.jpg").write_bytes(b"jpeg")
    dest, pdest = demo_reset.backup(src, photos, now=datetime(2026, 10, 8, 12, 0, 0, tzinfo=timezone.utc))
    assert dest.name == "demo-20261008-120000.db" and dest.parent == tmp_path / "backups"
    assert sqlite3.connect(dest).execute("select a from t").fetchall() == [("kept",)]
    assert (pdest / "ab" / "p.jpg").read_bytes() == b"jpeg"
    assert demo_reset.backup(src, None, now=datetime(2026, 10, 8, 12, 0, 1, tzinfo=timezone.utc))[1] is None


def test_all_sites_reset_keeps_every_registered_location_and_clears_the_rest(client, monkeypatch):
    for sid in ("a", "b"):
        set_site(client, sid)
    for i, sid in enumerate(("a", "b")):
        trusted_visit(client, monkeypatch, 80 + i, {"effectiveType": "4g", "downlink": 10, "rtt": 40}, site=sid)
    with Session(db.engine) as s:
        assert len(s.exec(select(Submission)).all()) == 2 and len(s.exec(select(SiteNetworkProfile)).all()) == 2
        ids = demo_reset.site_ids(s)
        assert ids == ["a", "b"]
        dry = [demo_reset.reset(s, sid) for sid in ids]
        assert sum(d["submissions"] for d in dry) == 2 and len(s.exec(select(Submission)).all()) == 2  # a dry run changes nothing
        for sid in ids:
            demo_reset.reset(s, sid, apply=True)
        assert s.exec(select(Submission)).all() == [] and s.exec(select(SiteNetworkProfile)).all() == [] and s.exec(select(Visit)).all() == []
        assert {x.site_id for x in s.exec(select(Site)).all()} == {"a", "b"}  # the registered sites are intact


def test_recently_used_sees_a_fresh_visit_or_submission(client):
    with Session(db.engine) as s:
        assert demo_reset.recently_used(s) is False
    client.post("/visits", json={"worker_id": "w", "task_id": "t", "site_id": "s"})
    with Session(db.engine) as s:
        assert demo_reset.recently_used(s) is True
        later = datetime.now(timezone.utc) + timedelta(seconds=demo_reset.ACTIVE_WINDOW_S + 5)
        assert demo_reset.recently_used(s, now=later) is False


def run_cli(args, env_extra, tmp_path):
    env = {k: v for k, v in os.environ.items() if k not in ("PUBLIC_MODE", "TRUST_LAYER_DB", "PHOTO_DIR")}
    env.update(env_extra)
    return subprocess.run([sys.executable, "tools/demo_reset.py", *args], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120)


def test_the_command_line_dry_run_apply_backup_and_the_public_mode_guard(tmp_path):
    dbf = tmp_path / "demo.db"
    base = {"TRUST_LAYER_DB": str(dbf), "PHOTO_DIR": str(tmp_path / "up")}
    boot = subprocess.run([sys.executable, "-c", "import db; db.init_db()"], cwd=BACKEND, env={**os.environ, **base}, capture_output=True, text=True)
    assert boot.returncode == 0, boot.stderr
    con = sqlite3.connect(dbf)
    con.execute("insert into site values ('site_demo_1', 12.9, 77.6, 100.0, 'IN', 'x')")
    con.execute("insert into visit (id, worker_id, task_id, site_id, started_at) values ('v1','w','t','site_demo_1', ?)", ((datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S.%f"),))
    con.commit()
    con.close()
    dry = run_cli([], base, tmp_path)
    assert dry.returncode == 0 and "would remove" in dry.stdout and "Dry run" in dry.stdout and not (tmp_path / "backups").exists()
    done = run_cli(["--apply"], base, tmp_path)
    assert done.returncode == 0 and "Backup:" in done.stdout and "REMOVED" in done.stdout, done.stdout + done.stderr
    assert len(list((tmp_path / "backups").glob("demo-*.db"))) == 1
    con = sqlite3.connect(dbf)
    assert con.execute("select count(*) from visit").fetchone() == (0,) and con.execute("select count(*) from site").fetchone() == (1,)
    con.execute("insert into visit (id, worker_id, task_id, site_id, started_at) values ('v2','w','t','site_demo_1', ?)", (datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f"),))
    con.commit()
    con.close()
    refused = run_cli(["--apply"], {**base, "PUBLIC_MODE": "1"}, tmp_path)
    assert refused.returncode == 3 and "REFUSED" in refused.stdout
    assert sqlite3.connect(dbf).execute("select count(*) from visit").fetchone() == (1,)  # nothing was removed
    forced = run_cli(["--apply", "--force", "--no-backup"], {**base, "PUBLIC_MODE": "1"}, tmp_path)
    assert forced.returncode == 0 and sqlite3.connect(dbf).execute("select count(*) from visit").fetchone() == (0,)


def test_seed_check_counts_trusted_visits_and_never_writes(client, monkeypatch, tmp_path):
    set_site(client)
    net = {"effectiveType": "4g", "downlink": 10, "rtt": 40}
    for i in range(2):
        trusted_visit(client, monkeypatch, 90 + i, net)
    submit(client, imgs.good(seed=77), worker="desktop", network_info=net)  # accepted but sensor-less: not trusted
    path = str(db.engine.url.database)
    before = Path(path).read_bytes()
    rows = seed_check.check(path)
    assert Path(path).read_bytes() == before
    assert rows[0]["site_id"] == "s1" and rows[0]["registered"] and rows[0]["trusted_visits"] == 2 and rows[0]["learned_from"] == 2 and rows[0]["ready"] is False
    trusted_visit(client, monkeypatch, 92, net)
    assert seed_check.check(path)[0]["ready"] is True


def test_seed_check_warns_when_the_site_has_no_country(client, tmp_path, monkeypatch, capsys):
    client.put("/sites/s1", json={"lat": 12.9, "lng": 77.6, "radius_m": 50})
    monkeypatch.setenv("TRUST_LAYER_DB", str(db.engine.url.database))
    assert seed_check.main() == 0
    assert "NO country" in capsys.readouterr().out
