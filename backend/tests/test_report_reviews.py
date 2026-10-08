"""Phase 8e: reviewed outcomes -> the report's REAL table; the retraining guard."""
import json
import sqlite3

from tools import reviewed_dataset
from tools.reportlib import render, reviews


def make_db(path, cases):
    con = sqlite3.connect(path)
    con.execute("create table submission (id integer primary key, status text, fraud_probability real, photo_verdict text, quality_flags text, task_id text)")
    con.execute("create table review (id integer primary key, submission_id integer, reviewer text, decision text, reason text, created_at text)")
    for i, (status, fp, verdict, flags, decision, reviewer) in enumerate(cases, 1):
        con.execute("insert into submission values (?,?,?,?,?,?)", (i, status, fp, verdict, json.dumps(flags), "t"))
        con.execute("insert into review (submission_id, reviewer, decision, reason, created_at) values (?,?,?,?,?)", (i, reviewer, decision, "r", "2026-10-07"))
    con.commit()
    con.close()


def test_no_database_or_no_reviews_is_honestly_not_evaluated(tmp_path):
    for db in (None, tmp_path / "missing.db"):
        out = reviews.evaluate(*reviews.load(db))
        assert out["evaluated"] is False and out["n"] == 0
    empty = tmp_path / "e.db"
    sqlite3.connect(empty).close()
    assert "no review table" in reviews.evaluate(*reviews.load(empty))["reason"]


def test_upheld_rate_per_flag_with_intervals_and_reviewers(tmp_path):
    db = tmp_path / "t.db"
    make_db(db, [
        ("flagged", 0.9, "block", ["spoof_suspected"], "reject", "alice"),
        ("flagged", 0.8, "warn", ["spoof_suspected"], "reject", "alice"),
        ("flagged", 0.6, "warn", ["spoof_suspected"], "approve", "bob"),
        ("accepted", 0.1, "pass", ["duplicate_photo"], "needs_retake", "bob"),
    ])
    out = reviews.evaluate(*reviews.load(db))
    assert out["n"] == 4 and out["decisions"] == {"reject": 2, "approve": 1, "needs_retake": 1}
    flag = {f["flag"]: f for f in out["by_flag"]}
    assert flag["spoof_suspected"]["reviewed"] == 3 and flag["spoof_suspected"]["upheld"]["k"] == 2
    assert 0 < flag["spoof_suspected"]["upheld"]["lo"] < flag["spoof_suspected"]["upheld"]["hi"] <= 1
    assert flag["<fraud model flagged>"]["reviewed"] == 3 and flag["duplicate_photo"]["upheld"]["k"] == 1
    assert out["reviewers"] == {"alice": 2, "bob": 2}
    assert out["fraud_model_vs_reviewers"] is None  # far below the minimum count


def test_the_latest_review_per_case_wins(tmp_path):
    db = tmp_path / "t.db"
    make_db(db, [("flagged", 0.9, "block", ["spoof_suspected"], "reject", "alice")])
    con = sqlite3.connect(db)
    con.execute("insert into review (submission_id, reviewer, decision, reason, created_at) values (1,'bob','approve','',  '2026-10-08')")
    con.commit(); con.close()
    assert reviews.evaluate(*reviews.load(db))["decisions"] == {"approve": 1}


def test_the_model_is_only_compared_with_reviewers_with_enough_labels(tmp_path):
    db = tmp_path / "big.db"
    cases = [("flagged", 0.9, "warn", [], "reject", "alice")] * 60 + [("accepted", 0.1, "pass", ["duplicate_photo"], "approve", "bob")] * 160
    make_db(db, cases)
    out = reviews.evaluate(*reviews.load(db), n_boot=20)
    f = out["fraud_model_vs_reviewers"]
    assert f and f["positives"] == 60 and f["negatives"] == 160 and f["auc"]["value"] == 1.0


def test_rendering_says_real_and_not_evaluated(tmp_path):
    md = render.reviews_md({"reviews": reviews.evaluate(*reviews.load(None))})
    assert "REAL labels" in md and "Not evaluated" in md
    db = tmp_path / "t.db"
    make_db(db, [("flagged", 0.9, "block", ["spoof_suspected"], "reject", "alice")])
    md = render.reviews_md({"reviews": reviews.evaluate(*reviews.load(db))})
    assert "`spoof_suspected`" in md and "alice (1)" in md and "not** evaluated or retrained" in md


def test_the_training_export_refuses_without_enough_labels(tmp_path, capsys):
    db = tmp_path / "t.db"
    make_db(db, [("flagged", 0.9, "block", [], "reject", "alice")] * 5)
    assert reviewed_dataset.main(["--db", str(db), "--out", str(tmp_path / "o.csv")]) == 2
    assert not (tmp_path / "o.csv").exists() and "NOT ENOUGH" in capsys.readouterr().out
    big = tmp_path / "big.db"
    make_db(big, [("flagged", 0.9, "warn", ["spoof_suspected"], "reject", "a1")] * 60 + [("accepted", 0.1, "pass", [], "approve", "b1")] * 160)
    assert reviewed_dataset.main(["--db", str(big), "--out", str(tmp_path / "o.csv")]) == 0
    assert (tmp_path / "o.csv").read_text().splitlines()[0].startswith("submission_id,fraud_probability")
