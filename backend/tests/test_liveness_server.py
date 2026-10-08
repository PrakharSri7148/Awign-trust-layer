"""Server-side liveness: the nonce, the evidence checks and the replay of the signal timeline."""
import json
import shutil
import subprocess
from datetime import timedelta
from pathlib import Path

import pytest
from sqlmodel import Session, select

pytest.importorskip("mediapipe")

import db  # noqa: E402
from models import LivenessChallenge  # noqa: E402
from photo_quality import liveness as lv  # noqa: E402
from photo_quality.config import THRESHOLDS  # noqa: E402

from . import imgs  # noqa: E402
from .conftest import passing_client_report, submit  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SELFIE = "task_selfie_checkin"
L = THRESHOLDS["liveness"]
NEUTRAL = dict(blink=0.05, smile=0.05, jaw=0.02, yaw=0, face=1)
ACTION = {"blink": dict(blink=0.9), "smile": dict(smile=0.9), "open_mouth": dict(jaw=0.8), "turn_left": dict(yaw=30), "turn_right": dict(yaw=-30)}


def rows(ids, dt=70):
    """A person performing the challenges: neutral for 500 ms, the action, back to neutral."""
    out, t = [], 0
    for cid in ids:
        for _ in range(8):
            out.append([t, *[NEUTRAL[k] for k in ("blink", "smile", "jaw", "yaw", "face")]]); t += dt
        for _ in range(4 if cid == "blink" else 12):
            v = {**NEUTRAL, **ACTION[cid]}
            out.append([t, v["blink"], v["smile"], v["jaw"], v["yaw"], 1]); t += dt
        for _ in range(4):
            out.append([t, *[NEUTRAL[k] for k in ("blink", "smile", "jaw", "yaw", "face")]]); t += dt
    return out


def evidence_for(ids, nonce, **over):
    run = lv.replay(ids, rows(ids), tolerance=0)
    assert run.phase == "passed", run.results
    ev = {"status": "passed", "nonce": nonce, "challenges": ids, "results": run.results, "timeline": rows(ids), "attempts": 1, "capturedAfterMs": 4000}
    ev.update(over)
    return ev


def issue(client, worker="w1", task=SELFIE):
    r = client.post("/liveness/challenge", json={"worker_id": worker, "task_id": task})
    assert r.status_code == 200, r.text
    return r.json()


def send(client, ev, *, worker="w1", source="camera", photo=None, **kw):
    return submit(client, photo or imgs.face_photo(), task=SELFIE, worker=worker, capture_source=source, liveness_evidence=ev,
                  client_report=passing_client_report(1200, 1200), **kw).json()


def live_check(body):
    return body["photo_quality"]["server"]["checks"].get("liveness")


def test_challenge_endpoint_issues_two_different_kinds_and_a_ttl(client):
    c = issue(client)
    assert len(c["challenges"]) == 2 and len({lv.CHALLENGE_GROUP[x] for x in c["challenges"]}) == 2
    assert c["id"] and c["ttl_s"] == 180 and c["timeout_ms"] == L["timeoutMs"]
    assert issue(client)["id"] != c["id"]  # fresh nonce each time


def test_only_face_required_tasks_get_challenges(client):
    for task in ("task_demo_1", "task_worker_at_site"):
        assert client.post("/liveness/challenge", json={"worker_id": "w1", "task_id": task}).status_code == 400


def test_outstanding_challenges_are_capped(client):
    for _ in range(lv.MAX_OUTSTANDING):
        issue(client)
    assert client.post("/liveness/challenge", json={"worker_id": "w1", "task_id": SELFIE}).status_code == 429
    assert client.post("/liveness/challenge", json={"worker_id": "someone-else", "task_id": SELFIE}).status_code == 200


def test_valid_evidence_is_accepted_and_the_nonce_is_consumed(client):
    c = issue(client)
    body = send(client, evidence_for(c["challenges"], c["id"]))
    assert body["photo_verdict"] == "pass", body["quality_flags"]
    chk = live_check(body)
    assert chk["status"] == "pass" and chk["details"]["reason"] == "challenge_passed"
    assert chk["details"]["replay"]["phase"] == "passed"
    with Session(db.engine) as s:
        row = s.get(LivenessChallenge, c["id"])
        assert row.used_at is not None and row.used_by_submission == body["id"]


def test_replaying_the_same_evidence_is_rejected_and_blocks(client):
    c = issue(client)
    ev = evidence_for(c["challenges"], c["id"])
    assert send(client, ev)["photo_verdict"] == "pass"
    again = send(client, ev, photo=imgs.face_photo(quality=90))  # a different file, the same (spent) nonce
    assert "liveness_replayed" in again["quality_flags"]
    assert again["photo_verdict"] == "block" and live_check(again)["status"] == "fail"


def test_forged_unknown_and_foreign_nonces_are_rejected(client):
    c = issue(client)
    ids = c["challenges"]
    forged = send(client, evidence_for(ids, "not-a-real-nonce"))
    assert "liveness_forged" in forged["quality_flags"] and forged["photo_verdict"] == "block"
    other_worker = send(client, evidence_for(ids, c["id"]), worker="w2")  # issued to w1
    assert "liveness_forged" in other_worker["quality_flags"] and other_worker["photo_verdict"] == "block"
    with Session(db.engine) as s:
        assert s.get(LivenessChallenge, c["id"]).used_at is None  # a thief cannot burn someone else's nonce


def test_an_expired_nonce_is_rejected(client):
    c = issue(client)
    with Session(db.engine) as s:
        row = s.get(LivenessChallenge, c["id"])
        row.expires_at = lv.aware_now() - timedelta(seconds=1)
        s.add(row); s.commit()
    body = send(client, evidence_for(c["challenges"], c["id"]))
    assert "liveness_expired" in body["quality_flags"] and body["photo_verdict"] == "block"


def test_evidence_for_other_challenges_is_a_mismatch(client):
    c = issue(client)
    other = [x for x in ("blink", "smile", "open_mouth") if x not in c["challenges"]][:2]
    body = send(client, evidence_for(other, c["id"]))
    assert "liveness_mismatch" in body["quality_flags"] and body["photo_verdict"] == "block"


def test_a_passed_claim_the_signals_do_not_support_is_caught_by_the_replay(client):
    c = issue(client)
    ev = evidence_for(c["challenges"], c["id"])
    ev["timeline"] = [[t, 0.05, 0.05, 0.02, 0, 1] for t in range(0, 6000, 70)]  # a face that never moves
    body = send(client, ev)
    assert "liveness_failed" in body["quality_flags"] and body["photo_verdict"] == "block"
    assert "timeline" in " ".join(live_check(body)["details"]["reasons"])


def test_impossible_timestamps_are_rejected(client):
    c = issue(client)
    ev = evidence_for(c["challenges"], c["id"])
    ev["results"][0]["t1"] = ev["results"][0]["t0"] + 20  # faster than a person can
    assert "liveness_failed" in send(client, ev)["quality_flags"]
    c2 = issue(client)
    ev2 = evidence_for(c2["challenges"], c2["id"], capturedAfterMs=120_000)
    assert "liveness_expired" in send(client, ev2)["quality_flags"]


def test_no_evidence_on_a_camera_capture_is_unverified_and_blocks(client):
    body = send(client, None)
    assert "liveness_unverified" in body["quality_flags"] and body["photo_verdict"] == "block"
    assert live_check(body)["status"] == "fail"


def test_a_client_claiming_a_pass_without_evidence_is_caught(client):
    rep = passing_client_report(1200, 1200)
    rep["checks"]["liveness"] = {"status": "pass", "score": 1, "value": 1}
    body = submit(client, imgs.face_photo(), task=SELFIE, capture_source="camera", client_report=rep).json()
    assert "client_missed_liveness" in body["quality_flags"] and body["client_mismatch"] is True


def test_a_picked_file_on_a_required_task_is_flagged_for_review_not_blocked(client):
    body = send(client, None, source="file")
    assert body["photo_verdict"] == "warn"
    assert {"liveness_unverified", "not_live_capture"} <= set(body["quality_flags"])


def test_send_for_review_must_be_earned(client):
    c = issue(client)
    ev = {"status": "review", "nonce": c["id"], "challenges": c["challenges"], "results": [], "timeline": [], "attempts": 3}
    unearned = send(client, ev)
    assert "liveness_review_unearned" in unearned["quality_flags"] and unearned["photo_verdict"] == "block"
    for _ in range(L["maxAttempts"] - 1):
        issue(client)  # the server issued enough challenges for the worker to have really tried
    c2 = issue(client)
    earned = send(client, {**ev, "nonce": c2["id"], "challenges": c2["challenges"]})
    assert "liveness_review_requested" in earned["quality_flags"] and earned["photo_verdict"] == "warn"


def test_optional_face_tasks_never_block_even_with_garbage_evidence(client):
    body = submit(client, imgs.face_photo(), task="task_worker_at_site", capture_source="camera", liveness_evidence={"status": "passed", "nonce": "x"},
                  client_report=passing_client_report(1200, 1200)).json()
    assert body["photo_verdict"] != "block"


def test_shelf_tasks_have_no_liveness_check(client):
    body = submit(client, imgs.good(), task="task_demo_1", capture_source="camera", client_report=passing_client_report()).json()
    assert "liveness" not in body["photo_quality"]["server"]["checks"] and body["photo_quality"]["server"]["passive"] is None


def test_a_passed_challenge_on_a_picture_of_a_screen_is_flagged_spoof_suspected(client):
    import numpy as np
    from PIL import Image
    import io
    c = issue(client)
    face = np.asarray(Image.open(io.BytesIO(imgs.face_photo())).convert("RGB")).astype(np.float64)
    h, w = face.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    th = np.deg2rad(11)
    u, v = xx * np.cos(th) + yy * np.sin(th), -xx * np.sin(th) + yy * np.cos(th)
    grid = 14 * (np.cos(2 * np.pi * u / 3.3) + np.cos(2 * np.pi * v / 3.3)) / 2
    spoof = np.clip(face + grid[..., None], 0, 255).astype(np.uint8)
    spoof[: int(h * 0.04)] = 10; spoof[-int(h * 0.04):] = 10; spoof[:, : int(w * 0.04)] = 10; spoof[:, -int(w * 0.04):] = 10
    buf = io.BytesIO(); Image.fromarray(spoof).save(buf, "JPEG", quality=96)
    body = send(client, evidence_for(c["challenges"], c["id"]), photo=buf.getvalue())
    assert body["photo_quality"]["server"]["passive"]["status"] in ("warn", "fail"), body["photo_quality"]["server"]["passive"]
    assert "spoof_suspected" in body["quality_flags"] and live_check(body)["status"] == "warn"
    assert body["photo_verdict"] != "block"  # heuristics alone never block


# ---- the Python state machine against the JS one ----------------------------------------------------------------
def samples(fn, to=6000, dt=100):
    out = []
    for t in range(0, to + 1, dt):
        v = {**dict(blink=0.05, smile=0.05, jaw=0.02, yaw=0, face=True), **fn(t)}
        out.append({"t": t, **v})
    return out


CASES = {
    "blink+smile": (["blink", "smile"], samples(lambda t: {"blink": 0.85} if 700 <= t < 900 else {"smile": 0.8} if 2000 <= t < 2700 else {})),
    "nothing": (["blink", "smile"], samples(lambda t: {}, 5000)),
    "static smile": (["smile"], samples(lambda t: {"smile": 0.9}, 5000)),
    "smile held, blink at 1.2s": (["blink", "smile"], samples(lambda t: {"smile": 0.85, **({"blink": 0.9} if 1200 <= t < 1400 else {})})),
    "turn left": (["turn_left"], samples(lambda t: {"yaw": 32} if 800 <= t < 1500 else {})),
    "turn right wrong way": (["turn_right"], samples(lambda t: {"yaw": 32} if 800 <= t < 1500 else {}, 5000)),
    "face lost": (["smile"], samples(lambda t: {"smile": 0.9} if 500 <= t < 800 else {"face": False} if 800 <= t < 2200 else {"smile": 0.9} if t >= 2200 else {}, 5000)),
    "long eye closure": (["blink"], samples(lambda t: {"blink": 0.9} if 600 <= t < 2400 else {}, 3800)),
    "open mouth flicker": (["open_mouth"], samples(lambda t: {"jaw": 0.7} if 800 <= t < 950 else {}, 3500)),
}


@pytest.mark.skipif(shutil.which("node") is None or not (ROOT / "client" / "node_modules").exists(), reason="node + client deps needed for the JS side")
def test_python_challenge_machine_matches_the_javascript_one(tmp_path):
    f = tmp_path / "cases.json"
    f.write_text(json.dumps([{"name": k, "challenges": ids, "samples": s} for k, (ids, s) in CASES.items()]))
    js = json.loads(subprocess.run(["node", str(ROOT / "client" / "tools" / "liveness-cli.mjs"), str(f)], capture_output=True, text=True, check=True, cwd=ROOT / "client").stdout)
    for name, (ids, s) in CASES.items():
        run = lv.ChallengeRun(ids, 0.0)
        for x in s:
            run.push({**x, "face": bool(x["face"])})
        assert run.phase == js[name]["phase"], name
        assert [(r["id"], r["status"], r["t0"], r["t1"]) for r in run.results] == [(r["id"], r["status"], r["t0"], r["t1"]) for r in js[name]["results"]], name


# ---- idempotent retries (Phase 8d): a worker re-sending after a lost response is not an attacker ----

def test_resending_the_same_photo_and_evidence_is_a_retry_not_a_replay(client):
    c = issue(client)
    ev = evidence_for(c["challenges"], c["id"])
    photo = imgs.face_photo()
    first = send(client, ev, photo=photo)
    assert first["photo_verdict"] == "pass"
    again = send(client, ev, photo=photo)  # the response was lost; the app sends the very same submission again
    assert "liveness_replayed" not in again["quality_flags"], again["quality_flags"]
    assert live_check(again)["status"] == "pass" and again["photo_verdict"] == "pass"


def test_a_retry_after_the_nonce_expired_is_still_a_retry(client):
    c = issue(client)
    ev = evidence_for(c["challenges"], c["id"])
    photo = imgs.face_photo()
    assert send(client, ev, photo=photo)["photo_verdict"] == "pass"
    with Session(db.engine) as s:
        row = s.get(LivenessChallenge, c["id"])
        issued = lv.aware_now() - timedelta(minutes=10)  # issued and used 10 min ago, inside its 3 min TTL; the retry arrives now
        row.issued_at, row.used_at, row.expires_at = issued, issued + timedelta(seconds=20), issued + lv.NONCE_TTL
        s.add(row); s.commit()
    again = send(client, ev, photo=photo)
    assert "liveness_expired" not in again["quality_flags"] and "liveness_replayed" not in again["quality_flags"], again["quality_flags"]


def test_the_retry_rule_does_not_help_a_different_photo_or_another_worker(client):
    c = issue(client)
    ev = evidence_for(c["challenges"], c["id"])
    photo = imgs.face_photo()
    assert send(client, ev, photo=photo)["photo_verdict"] == "pass"
    other_photo = send(client, ev, photo=imgs.face_photo(quality=90))
    assert "liveness_replayed" in other_photo["quality_flags"] and other_photo["photo_verdict"] == "block"
    other_worker = send(client, ev, photo=photo, worker="w2")
    assert "liveness_forged" in other_worker["quality_flags"] and other_worker["photo_verdict"] == "block"
