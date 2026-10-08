"""Server side of the liveness check: replay the device's evidence and decide whether it adds up.

The device sends: the challenge ids it was issued, a per-challenge result, a compact timeline of landmarker
samples `[t_ms, blink, smile, jaw, yaw_deg, face]` and the single-use nonce. The server never takes "liveness
passed" on trust. It (1) checks the nonce (issued by us, for this worker and task, not expired, not used before),
(2) checks the challenge list is the one we issued, (3) REPLAYS the timeline through a Python port of the
client's challenge state machine (client/src/lib/photoQuality/face/liveness.js: a parity test pins them together)
and requires the replay to pass the same challenges, (4) re-runs the screen/print heuristics on the uploaded photo.

HONEST SCOPE: this stops replayed evidence, forged evidence, evidence for other challenges and 'passed' claims the
signals do not support. It cannot tell that the signals were fabricated by someone who knows the thresholds, or
produced by a person performing the action in front of an injected virtual camera.
"""
import math
import secrets
from datetime import datetime, timedelta, timezone

from .config import THRESHOLDS

CHALLENGE_GROUP = {"blink": "blink", "turn_left": "turn", "turn_right": "turn", "smile": "smile", "open_mouth": "mouth"}
PROMPTS = {"blink": "Blink your eyes", "turn_left": "Turn your head to your left", "turn_right": "Turn your head to your right",
           "smile": "Smile", "open_mouth": "Open your mouth"}
NONCE_TTL = timedelta(seconds=180)  # the attempt (<= 2 x 4 s) + the 30 s pass validity + the 3 s sensor step + upload, with slack
MAX_OUTSTANDING = 40  # unused nonces per worker and task per hour: a client cannot farm challenges


def pick_challenges(rng=None, n=None, pool=None):
    """Two different KINDS of action, in random order (secrets-grade randomness unless a test injects one)."""
    L = THRESHOLDS["liveness"]
    n = n or L["challengesPerAttempt"]
    left = list(pool or L["pool"])
    out, used = [], set()
    while len(out) < n and left:
        i = int((rng() if rng else secrets.randbelow(10**9) / 10**9) * len(left))
        cid = left.pop(i)
        if CHALLENGE_GROUP[cid] in used:
            continue
        used.add(CHALLENGE_GROUP[cid])
        out.append(cid)
    return out


def _challenge_cfg(cid, L):
    if cid in ("turn_left", "turn_right"):
        t = L["turn"]
        return {"neutral": t["neutralBelowDeg"], "active": t["activeAboveDeg"], "holdMs": t["holdMs"], "needReturn": False, "maxActiveMs": math.inf, "neutralAbs": True}
    c = L[cid]
    return {"neutral": c["neutralBelow"], "active": c["activeAbove"], "holdMs": c["holdMs"], "needReturn": bool(c.get("needReturn")),
            "maxActiveMs": c.get("maxActiveMs", math.inf), "neutralAbs": False}


_SIGNAL = {"blink": lambda s: s["blink"], "smile": lambda s: s["smile"], "open_mouth": lambda s: s["jaw"],
           "turn_left": lambda s: s["yaw"], "turn_right": lambda s: -s["yaw"]}


class ChallengeRun:
    """Python port of createChallengeRun (liveness.js). `tolerance` relaxes the thresholds slightly because the
    timeline the device sends is rounded (the client's machine saw unrounded values)."""

    def __init__(self, challenges, start_t=0.0, L=None, tolerance=0.0):
        self.L = L or THRESHOLDS["liveness"]
        self.ids = list(challenges)
        self.start_t = start_t
        self.tol = tolerance
        self.results = []
        self.phase = "running"
        self.reason = None
        self.index = 0
        self.last_face_t = start_t
        self.cur = None
        self._begin(start_t)

    def _begin(self, t):
        cid = self.ids[self.index]
        cfg = _challenge_cfg(cid, self.L)
        if self.tol:
            span = cfg["active"] - cfg["neutral"]
            cfg = {**cfg, "active": cfg["active"] - self.tol * span, "neutral": cfg["neutral"] + self.tol * span}
        self.cur = {"id": cid, "cfg": cfg, "t0": t, "state": "wait_neutral", "neutral_since": None, "active_since": None, "peak": 0.0}

    def _finish(self, status, t, why=None):
        self.results.append({"id": self.cur["id"], "status": status, "t0": round(self.cur["t0"] - self.start_t), "t1": round(t - self.start_t),
                             "peak": round(self.cur["peak"], 3)})
        if status != "pass":
            self.phase, self.reason = "failed", why
            return
        self.index += 1
        if self.index >= len(self.ids):
            self.phase = "passed"
        else:
            self._begin(t)

    def push(self, s):
        if self.phase != "running":
            return
        L, cur = self.L, self.cur
        if s["face"]:
            self.last_face_t = s["t"]
        elif s["t"] - self.last_face_t >= L["faceLostMs"]:
            cur["state"], cur["neutral_since"], cur["active_since"] = "wait_neutral", None, None
        if s["face"]:
            self._advance(s)
        if self.phase == "running" and s["t"] - self.cur["t0"] >= L["timeoutMs"]:
            self._finish("timeout", s["t"], f'We did not see "{self.cur["id"]}" in time.')

    def _advance(self, s):
        cur, L = self.cur, self.L
        v = _SIGNAL[cur["id"]](s)
        c = cur["cfg"]
        cur["peak"] = max(cur["peak"], v)
        is_neutral = abs(s["yaw"]) < c["neutral"] if c["neutralAbs"] else v < c["neutral"]
        state = cur["state"]
        if state == "wait_neutral":
            if is_neutral:
                if cur["neutral_since"] is None:
                    cur["neutral_since"] = s["t"]
                if s["t"] - cur["neutral_since"] >= L["neutralMs"]:
                    cur["state"] = "armed"
            else:
                cur["neutral_since"] = None
        elif state == "armed":
            if v >= c["active"]:
                cur["state"], cur["active_since"] = "active", s["t"]
                if c["holdMs"] == 0 and not c["needReturn"]:
                    self._finish("pass", s["t"])
        elif state == "active":
            held = s["t"] - cur["active_since"]
            if c["needReturn"]:
                if v < c["neutral"] + 0.1:
                    self._finish("pass", s["t"])
                elif held > c["maxActiveMs"]:
                    cur["state"], cur["neutral_since"], cur["active_since"] = "wait_neutral", None, None
            elif v >= c["active"] - (c["active"] - c["neutral"]) * 0.25:
                if held >= c["holdMs"]:
                    self._finish("pass", s["t"])
            else:
                cur["state"], cur["active_since"] = "armed", None


def replay(challenges, timeline, tolerance=0.1, L=None):
    """Run the device's timeline through the state machine. Returns the run (phase, results)."""
    run = ChallengeRun(challenges, 0.0, L, tolerance)
    for row in timeline:
        t, blink, smile, jaw, yaw, face = row
        run.push({"t": float(t), "blink": blink, "smile": smile, "jaw": jaw, "yaw": yaw, "face": bool(face)})
    return run


def utcnow():
    """Naive UTC, for COMPARING with values read back from SQLite (it drops tzinfo)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def naive_utc(dt):
    """A datetime from the DB (naive or aware, depending on the driver path) as naive UTC."""
    return dt.replace(tzinfo=None) if dt.tzinfo is None else dt.astimezone(timezone.utc).replace(tzinfo=None)


def aware_now():
    """Timezone-aware UTC, for WRITING and querying (SQLModel's datetime columns insist on it)."""
    return datetime.now(timezone.utc)


def validate_evidence(evidence, issued, *, worker_id, task_id, now=None, claimed_used=False):
    """-> {'status': 'pass'|'warn'|'fail', 'flags': [...], 'reasons': [...], 'replay': {...}}

    `issued`: the LivenessChallenge row (or None when the nonce is unknown). `claimed_used`: True when this call
    lost the race to mark the nonce used (replay of a nonce a submission already consumed)."""
    L = THRESHOLDS["liveness"]
    now = now or utcnow()
    flags, reasons = [], []

    def fail(flag, why):
        flags.append(flag)
        reasons.append(why)

    if not evidence or not isinstance(evidence, dict):
        return {"status": "fail", "flags": ["liveness_unverified"], "reasons": ["no liveness evidence came with the photo"], "replay": None}
    if evidence.get("status") not in ("passed", "review", "failed"):
        fail("liveness_failed", "evidence has no valid status")
    nonce = evidence.get("nonce")
    if not nonce:
        fail("liveness_unverified", "evidence carries no nonce (the challenge was not issued by this server)")
    elif issued is None:
        fail("liveness_forged", "unknown nonce")
    else:
        if (issued.worker_id, issued.task_id) != (worker_id, task_id):
            fail("liveness_forged", "nonce was issued to a different worker or task")
        if now > naive_utc(issued.expires_at):
            fail("liveness_expired", "nonce expired before the submission arrived")
        if claimed_used:
            fail("liveness_replayed", "nonce was already used by an earlier submission")
        import json as _json
        issued_ids = _json.loads(issued.challenges)
        if evidence.get("challenges") != issued_ids:
            fail("liveness_mismatch", f"evidence is for {evidence.get('challenges')}, the server issued {issued_ids}")
        else:
            res = evidence.get("results") or []
            if evidence["status"] == "passed":
                _check_passed(evidence, issued_ids, res, L, fail)

    replay_info = None
    if evidence.get("status") == "passed" and not flags:
        run = replay(evidence["challenges"], evidence.get("timeline") or [], L=L)
        replay_info = {"phase": run.phase, "results": run.results}
        if run.phase != "passed":
            fail("liveness_failed", "the signal timeline does not show the challenges being performed")
    return {"status": "fail" if flags else "pass", "flags": list(dict.fromkeys(flags)), "reasons": reasons, "replay": replay_info}


def _check_passed(evidence, ids, res, L, fail):
    if [r.get("id") for r in res] != ids or any(r.get("status") != "pass" for r in res):
        fail("liveness_failed", "per-challenge results are not all passes for the issued challenges")
        return
    prev_end = -1
    for r in res:
        t0, t1 = r.get("t0"), r.get("t1")
        if not isinstance(t0, (int, float)) or not isinstance(t1, (int, float)) or t1 < t0 or t0 < prev_end - 1:
            fail("liveness_failed", "challenge timestamps are inconsistent")
            return
        if t1 - t0 > L["timeoutMs"] + 150:
            fail("liveness_failed", "a challenge took longer than its time limit")
            return
        if t1 - t0 < L["neutralMs"]:
            fail("liveness_failed", "a challenge was completed faster than a person can")
            return
        prev_end = t1
    if (evidence.get("capturedAfterMs") or 0) > L["validForMs"] + 2000:
        fail("liveness_expired", "the photo was taken too long after the live check")


_HINTS = {
    "fail_unverified": "The live check was not completed. Open the camera and follow the on-screen prompt.",
    "fail_invalid": "The live check could not be verified. Try again with the camera.",
    "warn_review": "The live check could not be completed. It is sent for review.",
    "warn_file": "Live check not possible with a picked photo. It is sent for review.",
    "warn_spoof": "This photo looks like it may show a screen or a print. It is sent for review.",
}


def build_check(task, capture_source, evidence, validation, passive, review_earned):
    """The server's `liveness` check (same ids/policy as the client's) plus the flags to record.

    -> (check_result | None, flags). None = nothing to say (face tasks only; optional tasks with clean evidence)."""
    from .checks.result import check_result  # local: avoid import cycles at package import
    from .config import FAIL, PASS, WARN

    mode = (task or {}).get("face", "off")
    if mode == "off":
        return None, []
    required = mode == "required"
    suspicious = (passive or {}).get("status") in ("warn", "fail")
    spoof_flags = ["spoof_suspected"] if suspicious else []
    p = {"passive": {"score": (passive or {}).get("score"), "status": (passive or {}).get("status")}}

    def res(status, score, hint, reason, flags, extra=None):
        return check_result("liveness", status, score, None, hint, {"reason": reason, **p, **(extra or {})}), flags

    if capture_source != "camera":
        if required:
            return res(WARN, 0.3, _HINTS["warn_file"], "no_live_camera", ["liveness_unverified", *spoof_flags])
        return (res(WARN, 1 - passive["score"], _HINTS["warn_spoof"], "passive_suspicious", spoof_flags) if suspicious else (None, []))
    if evidence is None:
        if required:
            return res(FAIL, 0, _HINTS["fail_unverified"], "no_evidence", ["liveness_unverified", *spoof_flags])
        return (res(WARN, 1 - passive["score"], _HINTS["warn_spoof"], "passive_suspicious", spoof_flags) if suspicious else (None, []))

    bad = FAIL if required else WARN
    status = evidence.get("status") if isinstance(evidence, dict) else None
    if validation["flags"]:
        return res(bad, 0, _HINTS["fail_invalid"], "evidence_rejected", [*validation["flags"], *spoof_flags], {"reasons": validation["reasons"]})
    if status == "failed":
        return res(bad, 0, _HINTS["fail_invalid"], "challenge_failed", ["liveness_failed", *spoof_flags])
    if status == "review":
        if review_earned:
            return res(WARN, 0.3, _HINTS["warn_review"], "review_requested", ["liveness_review_requested", *spoof_flags])
        return res(bad, 0, _HINTS["fail_invalid"], "review_unearned", ["liveness_review_unearned", *spoof_flags])
    # passed and the evidence adds up
    if suspicious:
        return res(WARN, min(0.5, 1 - passive["score"]), _HINTS["warn_spoof"], "passive_suspicious", spoof_flags, {"replay": validation["replay"]})
    return res(PASS, 1.0, None, "challenge_passed", [], {"replay": validation["replay"]})
