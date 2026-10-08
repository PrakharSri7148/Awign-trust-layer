# Sensor Fusion iteration 1: prompt for a fresh session

> **Historical.** Iteration 1 was implemented in the session that followed this file (see `progress.md`). It is kept as the record of what was asked. The prompt for what is left is not needed yet: iteration 2 starts with things only you can supply (`iteration-2.md`).

Paste everything inside the code block into a new Claude Code chat opened at `/Users/prakharsrivastava/Awign/trust-layer`.

```
You are implementing Sensor Fusion iteration 1 for the trust-layer project in this folder.

READ FIRST, IN THIS ORDER (do not skip; do not re-derive what they already state):
1. CLAUDE.md (project root)
2. README.md (project root; especially "How scoring works" and "Known limitations")
3. Sensor-fusion/iteration-1.md  (the plan: goal, verified current state, design, phases F0-F10, tests, acceptance criteria, decisions)
4. Sensor-fusion/progress.md     (the live state; you must keep it current)
5. edge-validator/README.md, and the Phase 8 sections of edge-validator/progress.md (for the harness recipes, pitfalls and conventions you must reuse)

THE GOAL (the user's words):
"At submission time, the phone's accelerometer/gyroscope data and WiFi/cell environment are compared against the claimed GPS trajectory, producing a motion-consistency signal. A genuine visit shows plausible movement leading up to arrival; a spoofed one typically shows flat motion despite a sudden GPS jump, or a WiFi/cell environment inconsistent with the claimed area. This signal is not judged in isolation; it is passed forward as one of the learned inputs to the AI classifier."
Today the code does NOT do this: backend/signals.py compute_motion_score ignores GPS, GPS is neither scored nor stored, the gyroscope is not used by fusion, and the ambient score is a hash of link speed vs the first submission. Make the goal true, honestly.

WHAT TO DO: execute ALL phases F0 to F10 of iteration-1.md in one go, in the order given there (F0, F1, F2, F3, F4, F5, F7, F6, F8, F9, F10), without stopping to ask between phases. After EACH phase: run the relevant tests, then update Sensor-fusion/progress.md (tick checklist boxes only with evidence, add a phase-log entry: built / measured / bugs found / open, state what is REAL vs SYNTHETIC).

SUPERVISION: CLAUDE.md requires invoking the `edge-validator-ai` subagent after every milestone, before a new phase, and after two consecutive test failures, and halting on STOP. That agent reads edge-validator/progress.md by default, so tell it explicitly: "audit Sensor-fusion/progress.md and the Sensor-fusion work against Sensor-fusion/iteration-1.md". If it cannot be invoked in this session, write "not invocable" in the Supervision log of progress.md. Do NOT substitute a stand-in and call it the real review.

HARD RULES
- Fusion produces sub-scores and evidence only; NEVER let a fusion rule set status/blocks by itself. Only the classifier turns signals into a probability. Fusion can add flags / send to review; it must not block (decision D5).
- UNKNOWN IS NOT SUSPICIOUS. No sensors, legacy client, short trail, no site profile => known=false, a neutral value, flag fusion_insufficient_evidence. This must be pinned by tests. (Today "no samples" scores 0 and looks like a spoof; fix that.)
- Honesty: label every number REAL or SYNTHETIC. The classifier's accuracy comes from a simulator; never present it as real-world accuracy. The simulator MUST produce raw trails and run them through the real F1-F4 code; do not sample the scores directly and do not import the scoring weights into the simulator.
- R5 (WiFi/cell) can only be partly met on the web (browsers expose no SSID/BSSID/cell IDs). Build what iteration-1.md section 3.6 says (site network profile without trust-on-first-use, pluggable IP-context provider with a NullProvider default, native radio hook), and say plainly in progress.md that R5 is partial on web.
- Remove the false sentence "near-zero movement despite location change" from classifier.py and client/src/lib/mock.js (reasons must state only what was measured).
- Keep what works: the SHAP keys (photo_quality, motion_consistency, ambient_fingerprint), the motion_score/ambient_score column names (fusion_version marks new rows), /sites/{id}/reset-fingerprint, old payloads (every new field optional), old DBs (migration + test). Keep the v1 model file as fraud_classifier_v1.pkl for rollback.
- Thresholds go in ONE shared file client/src/lib/sensorFusion/fusion.json read by both JS and Python (env override FUSION_CONFIG), all marked "starting values, uncalibrated". Keep JS and Python in parity for any logic that exists in both (add a parity script). Do not change client/src/lib/photoQuality/thresholds.json.
- Privacy: location history is personal data. Downsample (about 1 fix per 5 s, max 10 min), size/count caps, retention tool tools/purge_trails.py (dry run by default), coordinates shown only to authenticated dashboard users, trail drawn as an SVG (NO map tiles, NO third-party requests). The consent text is a DRAFT; the retention period and consent wording are the user's decisions.
- Do NOT commit, push, reset, clean or stash (the repo has many uncommitted changes from earlier work). Do NOT install system software. Do NOT add a dependency (especially a geo-IP library or database) without asking me first, with a recommendation.
- Decisions that are mine (ask me, with a recommendation, instead of silently choosing; if I am not around, keep the default in iteration-1.md section 9 and mark it "default used, awaiting user" in progress.md): trail retention, consent wording, geo-IP provider, native app, whether unknown evidence on required tasks goes to review, whether to create a dedicated sensor-fusion supervisor agent.

ENVIRONMENT RULES (from earlier phases; they cost time when ignored)
- My own dev servers run on 8000 (backend, --reload) and 5174 (Vite). NEVER touch them and NEVER POST test submissions to 8000 (it is my real DB). Use the isolated harness: cd client && npm run e2e (isolated backend on 127.0.0.1:8001 with a temp DB and PHOTO_DIR, separate Vite on 127.0.0.1:5173, refuses to run on busy ports). localhost:5173 on this machine is ANOTHER project: always use 127.0.0.1.
- Backend tests: cd backend && .venv/bin/python -m pytest -q (the full run takes minutes; run the targeted files while iterating). Client: cd client && npm test, npm run build. Use TRUST_LAYER_DB / PHOTO_DIR env vars for isolated backends.
- Do not edit client/src while an e2e run is active (Vite reloads pages mid-scenario and causes spurious failures). Do not run npm install while my Vite is up; node_modules already has what is needed.
- For GPS/motion e2e use puppeteer-core (already in client/node_modules): page.setGeolocation for fixes, window.dispatchEvent of synthetic DeviceMotionEvents for sensors. Desktop Chrome fires devicemotion with all-null fields: count those as "null_events", never as "still".
- Do not wait for background jobs with pgrep -f loops (they match themselves); wait on a pid or an output file. ffmpeg is not installed.
- A passing unit test and a passing DOM assertion are not proof the UI is right (a CSS class collision once produced an empty picture while every assertion passed). Look at screenshots of the new case-file section at phone and desktop widths and say what you saw.

TESTS YOU MUST WRITE (details in iteration-1.md section 6)
- Pure unit tests for every rule in F1-F4 (boundaries, unknown paths, monotonicity: more flat windows never raise the score).
- The headline scenarios: GPS teleport + still phone => flagged even with a perfect photo; same trail with walking-rhythm motion across the jump => the motion signal alone does not flag; genuine scripted walk-in => accepted; bad photo alone => still not flagged.
- False-positive traps (indoor drift with 50-100 m accuracy, tunnel dropout and re-acquire, smooth highway, phone in pocket, desktop/no sensor, VPN user, first visit to a site, throttled sensor rate): measure the false-flag rate on these separately and print it in the report.
- Adversarial: mock static location, perfectly linear mock drive, replayed real accelerometer on a mock trail (expected to be only partly caught; say so), noise-only accelerometer, replayed genuine trail under a new visit, forged visit_id, oversize or non-monotonic trail.
- API: genuine trail accepted, teleport+still flagged, legacy payload still works, malformed trail => 422 or a flag, never a 500; old DB migrates.

DEFINITION OF DONE
- Every phase F0-F10 checklist in progress.md is ticked with evidence, or explicitly marked "blocked on the user" with exactly what is needed.
- Each requirement R1-R8 in progress.md has a status: met / partial (with the reason) / blocked on the user.
- All acceptance criteria in iteration-1.md section 7 hold; grep shows the false sentence is gone.
- Suites green with numbers compared to your own F0 baseline (client npm test, backend pytest, parity, npm run e2e on isolated servers, npm run build); accuracy report regenerated with the new Sensor fusion section (every table labelled REAL or SYNTHETIC, with the leakage statement and the hard-genuine false-flag rate).
- progress.md, project README.md ("How scoring works" and "Known limitations") and Sensor-fusion/README.md updated.
- Your final message lists: what works; what was measured (REAL vs SYNTHETIC); what is still open; bugs you found while testing; and what I need to provide (real traces, decisions).

START BY: reading the five files, running the F0 baselines, then telling me in 5 lines your plan for F0-F1 (and any decision you need from me) before you write code.
```

## What to prepare while it works (so it is not blocked)

1. **Answer the decisions** in `iteration-1.md` §9 that are marked as yours: trail retention (default 30 days), consent wording, geo-IP provider (default none), whether native/background tracking is planned, and whether unknown evidence on `required` tasks goes to review.
2. **Site coordinates**: latitude, longitude and a radius in metres for at least two real sites (the demo site is seeded otherwise).
3. **Real traces** into `Sensor-fusion/samples/<scenario>/` once the record mode exists (`?record=1`): `walk_to_site/` (5+), `drive_then_walk/` (3+), `stationary_at_site/` (5+), `indoor_poor_gps/` (3+), and spoof tests `spoof_teleport/` (Chrome DevTools → Sensors → Location override), `spoof_mock_android/`, `spoof_static_home/`. One line per trace: phone, OS/browser, what happened. No other people's location data without their consent.
4. **One physical phone over HTTPS** (`npm run dev:https`) for at least one genuine walk. Earlier phases were only tested in headless Chrome.
5. **Keep your own servers (8000, 5174) running as they are.** The agent is told never to touch them.
