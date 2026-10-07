import sqlite3

from sqlalchemy import create_engine


def test_old_database_gets_new_columns_without_losing_rows(tmp_path, monkeypatch):
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
    db.init_db()  # idempotent

    con = sqlite3.connect(path)
    cols = {r[1] for r in con.execute("PRAGMA table_info(submission)")}
    assert set(db.SUBMISSION_COLUMNS) <= cols
    row = con.execute("SELECT worker_id, photo_verdict, quality_flags, photo_override FROM submission").fetchone()
    assert row == ("w", "unverified", "[]", 0)
