"""F3: the consistency engine. Lines the phone's motion up against the GPS trajectory and says how well they agree.

    motion_consistency in [0, 1]   1 = the sensors tell the same story as the GPS, low = they contradict it
    motion_known                   False when nothing could be compared (no sensors, no GPS, trail too short)

It produces a SCORE AND EVIDENCE, never a verdict: only the classifier turns signals into a probability. Unknown is
not suspicious: 'known' is False and the score is the neutral `unknownValue`.

Rules (weights in fusion.json, starting values):
  jump + flat motion   GPS teleported and the phone was still around it            (the headline spoof)
  flat while moving    GPS says walking/driving but the phone shows no movement
  arrival, no approach starts far from the site, ends inside it, little movement in between
  outside the site     GPS ends well outside the claimed radius
  too perfect          zero jitter / constant accuracy / ruler-straight path (weak)
  speed mismatch       the speed the device reports disagrees with the speed its positions imply (weak)
  window vs raw        the client's window features disagree with the raw 3 s snippet (integrity)
  rhythm matches speed walking-speed GPS with a walking cadence: raises the base score
Penalties combine as a noisy-OR, so several weak signals add up without ever exceeding 1.
"""
import math

from . import config as C
from . import geo, windows as W

ACTIVE = ("walking", "moving")


def _noisy_or(ps):
    keep = 1.0
    for p in ps:
        keep *= 1.0 - max(0.0, min(1.0, p))
    return 1.0 - keep


def _fmt_m(m):
    return f"{m / 1000:.1f} km" if m >= 1000 else f"{m:.0f} m"


def _moved_within_block(wins, mid_ms):
    """Did any window inside the GPS block around `mid_ms` (+-geo.blockHalfS) show the phone moving? The GPS speed is estimated over that
    block, so right after a worker stops walking the block still says 'moving' while the phone is already still: that is the block's
    smear, not a contradiction. A phone that is still for the WHOLE block while the GPS says it moved is."""
    half = C.GEO["blockHalfS"] * 1000
    return any(w["activity"] in ACTIVE and abs((w["t0"] + w["t1"]) / 2 - mid_ms) <= half for w in wins)


def raw_check(windows_, raw, K):
    """Compare the client's windows with the raw snippet it also sent. -> (mismatch bool or None, info)."""
    if not raw or not raw.get("samples") or raw.get("time_origin") is None:
        return None, None
    samples = []
    for s in raw["samples"]:
        if isinstance(s, dict) and isinstance(s.get("t"), (int, float)):
            samples.append({**s, "t": raw["time_origin"] + s["t"]})
    f = W.window_features(samples)
    if f["acc_rms"] is None or len(samples) < 5:
        return None, None
    t0, t1 = min(s["t"] for s in samples), max(s["t"] for s in samples)
    num = den = 0.0
    for w in windows_:
        if w.get("acc_rms") is None:
            continue
        ov = min(t1, w["t1"]) - max(t0, w["t0"])
        if ov > 0:
            num += ov * w["acc_rms"] ** 2
            den += ov
    if den <= 0:
        return None, None
    client_rms = math.sqrt(num / den)
    lo, hi = sorted((client_rms, f["acc_rms"]))
    bad = (hi / max(lo, 1e-6)) > K["rawMismatch"]["ratio"] and (hi - lo) > K["rawMismatch"]["absDiff"]
    return bad, {"client_rms": round(client_rms, 3), "raw_rms": round(f["acc_rms"], 3)}


def evaluate(trail, site=None, raw=None):
    """trail: {"fixes": [...], "windows": [...]} (already validated, times in epoch ms); site: {lat, lng, radius_m} or None;
    raw: {"samples": [{t,x,y,z}], "time_origin": ms} or None."""
    K, Wt = C.CONSISTENCY, C.CONSISTENCY["weights"]
    fixes, info = geo.clean_trail((trail or {}).get("fixes"))
    rel = geo.reliable(fixes)
    segs = geo.segments(rel)
    jumps = geo.detect_jumps(segs)
    wins = []
    for w in (trail or {}).get("windows") or []:
        if isinstance(w, dict) and isinstance(w.get("t0"), (int, float)) and isinstance(w.get("t1"), (int, float)):
            wins.append({**w, "activity": W.activity(w)})
    wins.sort(key=lambda w: w["t0"])

    flags, pen, notes = [], {}, []
    rows = []
    n_known = sum(1 for w in wins if w["activity"] != "unknown")

    # --- per window: what the GPS says vs what the phone did
    moving_den = flat_w = 0.0
    moving_n = rhythm_n = still_eval = energy_still = n_eval = n_mismatch_blocks = n_rep_blocks = 0
    for w in wins:
        mid = (w["t0"] + w["t1"]) / 2
        cls, eff, rep = geo.block_speed(rel, jumps, mid)
        act = w["activity"]
        verdict = "skip"
        if cls in ("still", "moving", "vehicle") and act != "unknown":
            n_eval += 1
            verdict = "ok"
            if cls in ("moving", "vehicle"):
                wt = 1.0 if cls == "moving" else K["vehicleWeightScale"]  # a smooth ride can be genuinely quiet: weaker evidence
                moving_den += 1.0
                moving_n += 1 if cls == "moving" else 0
                if act == "still" and not _moved_within_block(wins, mid):
                    flat_w += wt
                    verdict = "flat"
                elif act == "still":
                    verdict = "ok"  # still now, but the phone DID move inside this GPS block: the block just smears the moment the walker stopped
                elif cls == "moving" and act == "walking":
                    rhythm_n += 1
                    verdict = "rhythm"
            else:
                still_eval += 1
                if act == "walking":
                    energy_still += 1
                    verdict = "energy"
        if cls in ("still", "moving", "vehicle") and rep is not None and eff is not None:
            n_rep_blocks += 1
            n_mismatch_blocks += 1 if abs(rep - eff) > K["speedMismatchMs"] else 0
        rows.append({"t": round((w["t0"] - (wins[0]["t0"])) / 1000.0, 1), "gps": cls, "gps_ms": None if eff is None else round(eff, 2),
                     "activity": act, "acc_rms": None if w.get("acc_rms") is None else round(w["acc_rms"], 2),
                     "gyro_rms": None if w.get("gyro_rms") is None else round(w["gyro_rms"], 1), "verdict": verdict})

    moving_windows = sum(1 for r in rows if r["gps"] in ("moving", "vehicle") and r["activity"] != "unknown")
    if moving_windows >= K["minMovingWindows"] and moving_den > 0:
        frac = flat_w / moving_den
        if frac > 0:
            pen["flatWhileMoving"] = Wt["flatWhileMoving"] * frac
            if frac >= 0.25:
                flags.append("flat_motion_while_moving")
                notes.append((pen["flatWhileMoving"], f"GPS says the phone was moving for {moving_windows} windows but its sensors showed it still in {round(frac * 100)}% of them"))
    if still_eval >= K["minEvaluableWindows"] and energy_still / still_eval > 0:
        pen["energyWhileStill"] = Wt["energyWhileStill"] * energy_still / still_eval

    # --- jumps and what the phone did around them
    jump_info = []
    if jumps:
        flags.append("gps_jump")
        ctx = K["jumpContextS"] * 1000
        verdicts = []
        for j in jumps:
            around = [w for w in wins if w["activity"] != "unknown" and j["t0"] - ctx <= (w["t0"] + w["t1"]) / 2 <= j["t1"] + ctx]
            if not around:
                v = "unverified"
            elif sum(1 for w in around if w["activity"] in ACTIVE) / len(around) <= K["jumpMotionShare"]:
                v = "flat"  # one bump (the faker picking the phone up) does not make a jump 'moving'; a real walk across it does
            else:
                v = "motion"
            verdicts.append(v)
            jump_info.append({**j, "context_windows": len(around), "verdict": v})
        biggest = max(jumps, key=lambda j: j["dist_m"])
        if "flat" in verdicts:
            pen["jumpFlat"] = Wt["jumpFlat"]
            flags.append("gps_jump_flat_motion")
            notes.append((Wt["jumpFlat"], f"GPS jumped {_fmt_m(biggest['dist_m'])} in {biggest['dt_s']:.0f} s while the phone stayed still"))
        elif "motion" in verdicts:
            pen["jumpWithMotion"] = Wt["jumpWithMotion"]
            flags.append("gps_jump_with_motion")
            notes.append((Wt["jumpWithMotion"], f"GPS jumped {_fmt_m(biggest['dist_m'])} in {biggest['dt_s']:.0f} s (the phone was moving)"))
        else:
            pen["jumpUnverified"] = Wt["jumpUnverified"]
            notes.append((Wt["jumpUnverified"], f"GPS jumped {_fmt_m(biggest['dist_m'])} in {biggest['dt_s']:.0f} s and there was no motion data to check it"))

    # --- the site: where the trail ends, and whether the worker approached it
    sr = geo.site_relations(fixes, site)
    arrival = None
    if sr:
        if sr["end_outside"]:
            pen["outsideSite"] = Wt["outsideSite"]
            flags.append("gps_outside_site")
            notes.append((Wt["outsideSite"], f"GPS ended {_fmt_m(sr['end_m'])} from the site (radius {_fmt_m(sr['radius_m'])})"))
        if sr["start_m"] > K["approachFarM"] and sr["end_inside"]:
            if n_known >= K["minEvaluableWindows"]:
                share = sum(1 for w in wins if w["activity"] in ACTIVE) / n_known
                arrival = {"start_m": round(sr["start_m"]), "moving_share": round(share, 2), "checked": True}
                # a smooth ride is genuinely quiet: where the GPS says 'vehicle' the missing movement is already (lightly) counted by
                # flatWhileMoving, so the arrival rule does not count it a second time
                gps_moving = [r for r in rows if r["gps"] in ("moving", "vehicle")]
                veh = sum(1 for r in gps_moving if r["gps"] == "vehicle") / max(1, len(gps_moving))
                arrival["vehicle_share"] = round(veh, 2)
                if share < K["approachMinMovingShare"]:
                    pen["arrivalNoApproach"] = Wt["arrivalNoApproach"] * (1 - share / K["approachMinMovingShare"]) * (1 - veh)
                    if pen["arrivalNoApproach"] > 0.02:
                        flags.append("arrival_without_approach")
                    notes.append((pen["arrivalNoApproach"], f"Started {_fmt_m(sr['start_m'])} from the site and arrived with almost no movement in between"))
            else:
                arrival = {"start_m": round(sr["start_m"]), "checked": False}

    # --- signs of a fake provider
    ms = geo.mock_signatures(fixes)
    gps_grade = ms["acc_median_m"] is not None and ms["acc_median_m"] <= C.GEO["mock"]["maxAccForGpsGradeM"]
    too_perfect = bool(ms["too_perfect"] and (gps_grade or n_known >= 1))
    if too_perfect:
        pen["tooPerfect"] = Wt["tooPerfect"]
        flags.append("gps_too_perfect")
        notes.append((Wt["tooPerfect"], "GPS readings look artificial (no natural jitter)"))
    if n_rep_blocks >= K["speedMismatchMinBlocks"] and n_mismatch_blocks / n_rep_blocks >= 0.5:
        pen["speedMismatch"] = Wt["speedMismatch"] * n_mismatch_blocks / n_rep_blocks
        flags.append("gps_speed_mismatch")

    # --- integrity of the client-computed windows
    bad, raw_info = raw_check(wins, raw, K)
    if bad:
        pen["windowRawMismatch"] = Wt["windowRawMismatch"]
        flags.append("window_raw_mismatch")
        notes.append((Wt["windowRawMismatch"], "The motion summary does not match the raw motion sample"))

    known = bool(n_eval >= K["minEvaluableWindows"] or jumps or too_perfect or sr is not None)
    p_total = _noisy_or(pen.values())
    rhythm_share = rhythm_n / moving_n if moving_n >= K["minMovingWindows"] else 0.0
    base = K["baseScore"] + K["rhythmBonus"] * rhythm_share
    score = max(0.0, min(1.0, base * (1.0 - p_total))) if known else K["unknownValue"]
    notes.sort(key=lambda n: -n[0])
    duration = geo.trail_span_s(fixes)
    return {
        "motion_consistency": round(score, 4),
        "motion_known": known,
        "sensor_used": n_known > 0,
        "flags": list(dict.fromkeys(flags)),
        "penalties": {k: round(v, 4) for k, v in pen.items()},
        "reason": notes[0][1] if notes else None,
        "evidence": {
            "fixes": len(fixes), "reliable_fixes": len(rel), "dropped_fixes": info["dropped"], "duration_s": round(duration, 1),
            "distance_m": round(sum(s["dist"] for s in segs if not any(j["t0"] == s["t0"] and j["t1"] == s["t1"] for j in jumps))), "windows": len(wins), "windows_with_data": n_known,
            "evaluable_windows": n_eval, "rhythm_share": round(rhythm_share, 2),
            "jumps": jump_info, "site": None if not sr else {k: (round(v, 1) if isinstance(v, float) else v) for k, v in sr.items()},
            "arrival": arrival, "mock": {k: (round(v, 2) if isinstance(v, float) else v) for k, v in ms.items()},
            "raw_check": raw_info, "rows": rows[: C.TRAIL["maxWindows"]],
        },
    }
