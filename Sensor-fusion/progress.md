# Sensor Fusion — Progress

Plan: [`iteration-1.md`](iteration-1.md) · how it works: [`README.md`](README.md) · what is left (and what you have to do): [`iteration-2.md`](iteration-2.md).

**Status (2026-10-08): iteration 1 implemented (F0-F10); hackathon laptop side done (see "Hackathon" below).** Everything below was built and tested on a **simulator** and in **headless Chrome playing a phone**. Nothing has run on a real phone and no threshold is calibrated on real traces: every accuracy number is SYNTHETIC.

## Requirements (the goal, R1-R8 from `iteration-1.md` §0)

| # | Requirement | Status |
|---|---|---|
| R1 | accelerometer **and** gyroscope used | **met** (5 s windows: accelerometer RMS/peak + step rhythm, gyroscope RMS; either alone also works) |
| R2 | compared with a GPS **trajectory** | **met** (watchPosition track, speed with the GPS error subtracted, jumps, fake-provider signs) |
| R3 | plausible movement **leading up to arrival** | **partial by platform**: met for the time the app is open (the arrival rule: starts > 150 m away and ends inside the site with little movement in between); a web page cannot record while the screen is off, so a whole journey needs a native app |
| R4 | **flat motion despite a GPS jump** | **met** (`gps_jump_flat_motion`; verified end to end: a 14 km jump with a still phone is flagged with the reason in words) |
| R5 | WiFi/cell environment vs the claimed area | **partial on the web, by design**: browsers expose no WiFi names / cell towers. Built: learned per-site network profile (no trust-on-first-use), IP country/region/provider (needs the IP database: **run `tools/fetch_geoip.py`**, not installed yet), hosting/VPN heuristic, time zone, and the native `radio` field (scored and tested, no app sends it) |
| R6 | one motion-consistency signal | **met** (`motion_consistency` 0-1 + known flag + evidence) next to `environment_consistency` |
| R7 | learned input to the classifier, never a lone rule | **met** (5 inputs into the gradient-boosting model; fusion can only flag / send to review, never block; unknown never flags) |
| R8 | explainable to a reviewer | **met** (sentences from the measurements, case-file section with trail drawing, timeline and flags) |

## Phases

| Phase | Scope | Status |
|---|---|---|
| F0 | Baselines, data contract, `fusion.json`, folders | done |
| F1 | Trail/geo engine | done (`backend/fusion/geo.py`) |
| F2 | Motion windows + activity, JS and Python, parity, raw cross-check | done (JS and Python agree on 13/13 scripted signals, 104 values) |
| F3 | Consistency engine | done (`consistency.py`) |
| F4 | Environment engine (+ IP reader, native radio hook) | done; the IP reader is tested against fake records only |
| F5 | Backend: models/migration, `/visits`, `/sites`, validation, wiring, retention tool | done |
| F6 | Client: recorder, consent, Sensors step, `?record=1` | done |
| F7 | Simulator + classifier v2 | done (simulated; v1 kept for rollback) |
| F8 | Reasons + dashboard case file | done (screenshots looked at, two fixes came out of that) |
| F9 | Accuracy-report section + real-trace tooling | done (report section 5b; real-trace reader; the calibration tool is iteration 2) |
| F10 | e2e, regression, docs | done |

## Measured (2026-10-08)

| Suite | Baseline before (F0, re-measured) | After |
|---|---|---|
| Client `npm test` | 201 passed | **235 passed** |
| Backend `pytest -q` | 130 passed | **234 passed** (on the final code; 24 min because the report tests run the simulator) |
| Photo parity JS vs Python (`node tools/parity.mjs`) | 100% (37/37) | **100% (37/37)**, no disagreements |
| Fusion parity (`npm run fusion:parity`) | - | **13/13 cases, 104 values** |
| `npm run build` | OK | **OK** |
| E2E `npm run e2e` (isolated servers 8001/5173) | 229 PASS (per `edge-validator/progress.md`; not re-measured at F0) | **full suite 256 PASS / 1 FAIL (the layout check, fixed afterwards); **on the final code**: fusion 40, layout 38, fullstack 13, review 7, all PASS. The other scenarios (camera HUD, liveness, burst, timing) were not re-run after the last two changes (a CSS height and a scoring rule); they do not touch either** (the four new `fusion_*` scenarios are 29 of them) |
| Accuracy report (`npm run report`) | - | regenerated: section 5b (sensor fusion) added; REAL block says "not evaluated" (no traces); the weakest-areas list starts with that. The report's own tests take about 8 minutes because each one now runs the simulator |

## What the simulator says (SYNTHETIC: the model's behaviour in the authors' simulated world, not real accuracy)

- The simulator builds raw GPS fixes (AR(1) noise), raw accelerometer/gyroscope streams and networks for 24 scenarios (genuine walks/drives/stationary/pocket, "hard genuine" traps, spoofs) and runs them through the **real** F1-F4 code; it holds no thresholds or weights (a test checks this, and that changing a weight moves its output). 2,150 rows (1,300 genuine / 850 fraud).
- Results (new random draw / shifted world): fraud caught **88% / 81%**, honest flagged **2% / 7%**, AUC **0.975 / 0.924** (in-distribution split: 82% / 3% / 0.959). The "hard genuine" traps (indoor drift, tunnel dropout, smooth highway, desktop, VPN, first visit, throttled sensors, legacy client, short trail) were flagged **1%** of the time in both worlds (worst single scenario: tunnel dropout 9%, smooth highway 3%).
- **Which input matters** (models retrained without one input, scored on the shifted world): all inputs AUC 0.931; **without motion 0.612** (fraud caught 28%); without environment 0.883; without photo 0.925. Motion consistency carries about 76% of the SHAP weight.
- **Weak spots (SYNTHETIC):** wrong-area network fraud is missed 62-68% (needs the IP database or a native app); a *good* spoofing app (realistic noisy path, phone on a table) is missed 25% in the normal world and **72% in the noisy-GPS world**, because noisy GPS leaves too little evidence that the GPS says "walking"; replayed motion on a frozen mock location is caught only 70-72% (through the "too perfect GPS" sign); the weak-evidence pair is wrong 17-58% by construction. On the other side, genuine workers flagged in the noisy-GPS world: 7%.
- GPS-jump speed ceiling: at 10 m/s the rule would call 80% of tunnel drives and 100% of highway drives "jumps"; from 25 m/s up none, and teleports are caught 100% at every ceiling (deployed: 55).
- All 10 probe cases behave as intended; SHAP ranking is the same in 3 retrainings.

## Bugs and surprises found by running it

1. **The "walking rhythm" detector was wrong for real phones.** My first version took the autocorrelation of the acceleration *magnitude*; the magnitude of a gravity-free vector is rectified, so a 2 Hz step shows up at 4 Hz, outside the walking band. Fixed (before the simulator existed) by summing the per-axis autocorrelations, which does not depend on how the phone is held; there is a test that rotates the axes.
2. **Indoor GPS drift looked like walking.** With a stationary phone and 25-55 m GPS error, 16 of 18 simulated rows raised "GPS moving, phone still". Fixed with a 2x error margin on the speed estimate, a 50 m usable-accuracy limit, and an "ambiguous" class when the accuracy is too coarse to tell standing from walking; now 0 of 18. (`thresholds-changelog.md`)
3. **One bump flipped a spoof into "moving".** A faker picking up the phone near the jump made the jump look genuine; the verdict now uses the share of movement around the jump (<= 25% = still).
4. **A smooth ride counted twice.** A quiet tunnel/highway drive was penalised once as "GPS moving, phone still" (lightly) and again as "arrived without approach". The arrival rule now discounts the share of the trail the GPS says was a vehicle. Tunnel false-flag rate dropped from 44% to 19% in the simulator (still the weakest honest-worker number; see below).
5. **Chrome now has `DeviceMotionEvent.requestPermission` on desktop** (and answers "denied" without a sensor). My "has the function = iOS needs a tap" test would have disabled auto-start everywhere, and "denied = don't listen" would have dropped real events. Now iOS is detected as iOS, and the recorder listens regardless (a denial just means no events; real events win over the label). Found by running the page in real Chrome, not by any unit test.
6. **The teleport drawing was useless** (a 14 km jump shrank the 60 m site circle to nothing and the path was drawn straight through the jump) and my own teleport e2e had a second hidden jump (the first fix was at the site). Both fixed after looking at the screenshots; the jump distance is no longer counted as "distance travelled".
7. **Honest retries** (see Open): found in a self-review, not by a test.
8. A wrong-typed `trail` first came back as a 422 from schema validation; it is now accepted as any JSON and becomes the flag `trail_invalid`.

## Changes from the plan

- **No demo site is seeded** (plan D11 said it would be): a made-up location would flag every demo submission made from somewhere else. Register real sites with `PUT /sites/<id>`.
- **No supervisor agent** (plan D12), by your decision. I tried to remove the "Supervision" section from `CLAUDE.md`, but the permission system blocked emptying the file and I did not work around it: **the two lines are still there; delete them yourself** (the `edge-validator-ai` agent file in `.claude/agents/` is also still there).
- **The IP database** (plan D9): you chose "install it". `maxminddb` is installed in the backend venv and in `requirements.txt`; the free DB-IP "lite" city + ASN files are **not** downloaded: the sandbox blocked my download command. `tools/fetch_geoip.py` is written and tested with a fake opener; **you run it once** (see `README.md`).
- **`fusion_insufficient_evidence` means "the phone's movement was not compared with the GPS trail"**, even when a GPS-only check against a registered site did run (the score is then "known" but GPS-only; the case file says so).
- The visit is matched to **worker + site**, not the task: switching task after walking to the site must not lose the approach.
- Recorder times are kept on the device clock and corrected by the server-clock offset when the snapshot is made, so the recorder can start inside the tap (iOS motion permission) before the visit is open.

## Open (carried to `iteration-2.md`)

- **Honest retries:** fixed after a self-review: the same worker re-sending the same photo for the same task and site (a lost response on a bad network) is a retry, not a replay (no `trail_replayed`, and the network profile is not taught twice); another photo on the same visit, or another worker on the same trail, is still a replay (tested).
- Everything in `iteration-2.md` §0 (IP database download, real sites, real traces, a real phone, the native-app decision, privacy decisions, unknown-evidence policy, reviewers).
- **Honest workers can still be flagged** (simulated rates in report section 5b: the hard-genuine group, quiet tunnel/highway rides). The real rate is unknown.
- **Replayed real motion on a frozen fake location** and **wrong-area network** fraud are the least-caught spoofs (SYNTHETIC numbers in the report); the latter needs the IP database or a native app.
- The list endpoint loads every row's full sensor report from the database on each 5-second dashboard poll (as it already did for the photo report); fine for thousands of rows, worth fixing before tens of thousands.
- iOS Safari / Android Chrome behaviour, wake lock, screen-off, battery: untested.

## Hackathon (2026-10-08): laptop side done, phone side waiting for you

Plan: [`hackathon-plan.md`](hackathon-plan.md) · demo: [`demo-script.md`](demo-script.md) · APK: [`apk-notes.md`](apk-notes.md). Everything below was tested on the laptop (headless Chrome playing a phone, isolated servers 8001/5173). **Nothing has run on a real phone and no APK has been built.**

| Step | What was built | Status |
|---|---|---|
| H1 | Backend CORS for the APK origins (`http(s)://localhost`, `capacitor://localhost`, `ionic://localhost`) + `EXTRA_CORS_ORIGINS`; the backend address is settable at runtime (`?api=<url>` saved on the device, `?api=reset`, a "Server" box with **Test connection** (`GET /health`), then `VITE_API_URL`, then the old logic) | built; 13 api unit tests + a CORS test; the Server box is on screen in the feed screenshot; **needs the phone** to confirm the laptop's LAN address works from the APK |
| H2 | "Register this spot as the site" (uses the recording's fresh fix, else one request) and a Sites form in the dashboard | built; the e2e registers a site through the page (`fusion_demo`) |
| H3 | "Movement vs GPS / Network vs area" lines on the verdict screen | built; e2e: green for the walk, red with the jump in words for the teleport; screenshots looked at |
| H3b | Live **Sensor feed** under the camera (GPS lat/lng/accuracy/speed/heading/altitude/fixes/last-fix age, \|acceleration\|, \|rotation\|, rate, waveform, activity + step rhythm, visit id, clock offset, wake lock, time hidden, GPS restarts, permissions, network, mini trail with the site circle, a "not available + reason" list) and **What was fetched** on the verdict screen | built; e2e asserts the numbers change while walking and checks both panels; screenshots looked at |
| H3c | Hardening tests (visibility, wake lock re-acquire / released by the system / refused, GPS watchdog, hidden time), `capacitor.config.json`, `tools/apk.mjs` (`npm run apk`: permissions + keep-screen-on patch, tested on sample files) | tests pass; **needs the phone** (`apk-notes.md`; Capacitor is not installed, I added no dependency) |
| H4 | `backend/tools/demo_reset.py` (+ `npm run demo:reset`), dry run by default | built + tested (only the named site is touched; other sites keep submissions and network profile) |
| H5 | Capacitor config + `npm run apk` script | written; **not run** (needs `npm i @capacitor/*`, Android Studio, your OK) |
| H6 | `demo-script.md`, `demo-start.sh` (reuses servers already on 8000/5174, never restarts them), `npm run demo:laptop` (visible Chrome, scripted walk + teleport, stays open on the case file) | built; `fusion_demo` passes headless; the visible-browser mode was **not watched by me**: run `npm run demo:laptop` once |
| extra | `tools/fetch_geoip.py` sends a browser-like User-Agent (DB-IP answered 403 to urllib), tested | done |

**Bugs found by running it (both would have hit the demo or a real phone):**
1. After "New submission" on the (now longer) verdict screen the page kept its scroll position and the camera shutter sat under the sticky header; it now scrolls to the top.
2. A cold one-shot `getCurrentPosition` at submit time often times out (it did in headless Chrome: the verdict said "GPS unavailable" although the recording had fixes). The submission now falls back to the recording's fresh fix (at most 30 s old) so the arrival checks still have a position.

The Sites panel was moved below the submission feed so the review queue and feed stay where they were.

**Measured on the final code:**

| Suite | Result |
|---|---|
| Client `npm test` | **276 passed** (was 235) |
| `npm run build` | OK |
| `npm run fusion:parity` | 13/13 cases, 104 values |
| E2E (isolated servers) | fusion **60** (incl. the new `fusion_notarrived`), layout **38**, fullstack **13**, review **7**, fusion_demo **5**: all PASS on a quiet machine |
| Backend targeted (`test_fusion_tools.py`: demo reset, CORS, User-Agent) | pass |
| Full backend `pytest` | **237 passed, 6 failed** (25 min, run once at the end). **The 6 failures are not from the hackathon work:** 5 in `tests/test_classifier_env_defects.py` (SHAP "Additivity check failed") and `test_the_committed_training_data_is_reproducible` (2430 rows now vs 2150 expected). During the run `classifier.py`, `fraud_classifier.pkl`, `fusion/simulate.py`, `train_classifier.py` and `synthetic_fusion_data.csv` were being modified by the separate environment-consistency work (they were unmodified at the start of this session; I changed only `main.py`, `tools/fetch_geoip.py` and `tests/test_fusion_tools.py` in the backend), so the model and its code/data were out of step. I did not touch them. **Re-run `pytest` once that work is finished and its model is retrained and committed to confirm all green**; my targeted tests (`test_fusion_tools.py`) all pass |

All e2e inputs are scripted GPS and motion, so these are SYNTHETIC: "accepted, motion 0.97" and "flagged for a 14 km jump" show the pipeline works, **not** how often it is right on real phones.

**Arrival step (added after the first hackathon pass, at the user's request):** the sensor fusion runs only after the photo is taken and passed the on-device check. The button after the photo is now **"I've reached the site · send my location"** (with a hint saying what happens), the stepper's second step is **Arrival**, and the verdict starts with an **Arrival at site** line (inside = green, clearly outside = red "arrival not confirmed, sent for review", close = amber, no fix / no registered site = grey with the reason). Only the company sets a site's location (dashboard Sites panel); the worker cannot. Outside the site flags `gps_outside_site` for review, it never blocks. e2e: before the tap nothing has been sent; a worker 499 m away gets the red line and the flag (screenshot looked at). No new backend endpoint: the photo submit still carries and re-checks everything, so the arrival step cannot be skipped.

**Open risk, not fully diagnosed:** during one pass `fusion_demo` failed (the scripted genuine walk came out *flagged* at motion 0.68, then a camera selector timed out) while another session was running a full pytest, retraining the classifier and an e2e on the same machine; on a quiet machine it passed three times in a row (accepted 0.975). The scripted walk is timing-based, so a heavily loaded laptop can distort it. I did not capture the exact cause. **Run `npm run demo:laptop` on an otherwise idle laptop, and re-run it twice before the event.** Two e2e runs cannot overlap (ports 8001/5173); if another session uses them, wait.

**Laptop-verified:** the feed and verdict panels, the server-address logic, the recorder hardening logic (fake clock, fake wake lock), site registration, demo reset, the demo flow. **Needs the phone:** that the APK builds; the Android WebView's sensor rate and `devicemotion` without a prompt; the screen staying on (the activity flag); how real GPS and a mock-location app look to `fusion/geo.py`; that the phone can reach the laptop over the LAN; the outdoor walk. No threshold is calibrated.

## Real-phone test (2026-10-08, Oppo F19 Pro, ColorOS, Chrome over HTTPS on the same WiFi)

First real-phone run, done by the user following [`phone-test-guide.md`](phone-test-guide.md). **The numbers below come from the user's screenshots and descriptions; the three end-to-end results are the user's report ("everything is perfect, all 3 tests"), I did not see those verdict screens.** One phone, one day, one place: this shows the pipeline works on a real phone, it is **not** an accuracy measurement.

| What | Real-phone result |
|---|---|
| Page over HTTPS (self-signed) from the laptop, same WiFi | works |
| GPS | indoors ±14 to ±20 m, outdoors **±8 to ±10 m**, position changes as the phone moves |
| Accelerometer / gyroscope in Chrome on ColorOS | delivered with no prompt; **36-47 Hz** (above the 20 Hz the walking detector needs) |
| Screen wake lock | held |
| Server clock offset | about +1.3 s (the phone's clock is 1.3 s behind; corrected) |
| Camera / location permission | allowed |
| Walking | `walking`, rhythm **2.3 Hz**, strength about **0.45** (the cut-off is 0.35: a small margin; a hand-held phone may dip to `moving` in some windows) |
| Standing still | `still` |
| A hard rhythmic shake | read as `walking` (2.78 Hz, strength 0.57): sensors alone cannot tell a rhythmic shake from steps (a known limit, not a bug) |
| Genuine walk, fake location (mock-location app), not-at-the-site | **all three behaved as expected, per the user's report** |

**The defect the phone found (and the fix):** with the phone flat on a table and untouched the app said **`moving`**: the gravity-free acceleration sensor of this phone reads a constant offset of about **0.22 m/s2** at rest (rotation 0.0), and `acc_rms` was the root-mean-square of the acceleration *magnitude*, so the offset counted as movement (the "still" limit is 0.15). Consequence: in the fake-location test a phone lying on a table would have read as moving, and the jump would not have been called "phone still". Fix: movement is now measured as variation **around the window's own mean** (a constant offset is not movement), in both ports (`client/src/lib/sensorFusion/windows.js`, `backend/fusion/windows.py`; fewer than 3 samples keep the raw size). Tests in both languages (offset only = still; a real shake on top of an offset still counts and equals the no-offset value). Re-measured on the phone: the table now reads **`still`**. Thresholds in `fusion.json` were **not** changed. Parity 13/13.

**Consequence for the simulated training data:** the simulator pushes raw streams through these engines, so strictly the committed training data / model were generated with the old definition. The simulated streams are zero-mean, so the effect should be small, but it is **not re-trained or re-measured**. See the backend line below.

**Measured after the fix:** client 281 passed; fusion parity 13/13; backend fusion tests (`test_fusion_engines.py`, `test_fusion_api.py`) 88 passed; e2e fusion 60, layout 38, fullstack 13, review 7, fusion_demo 5, all PASS.

## Limits to repeat in every report

1. A web page cannot track in the background; "leading up to arrival" means while the app is open.
2. A web page cannot read WiFi/cell identifiers. A native app can (the server side is ready); whether to build one is yours to decide.
3. A modified client or an emulator injecting realistic sensor streams can fool this; the visit session and replay checks raise the cost only.
4. Indoor/urban GPS noise and smooth car rides are the main false-positive risks.
5. Every accuracy number is SYNTHETIC until real traces and reviewed submissions exist.
6. Location history is personal data: the consent text is a draft; retention (default 30 days for coordinates), access and wording are your decisions.

## What you need to do next

See `iteration-2.md` §0 (U1-U8). In order: run `tools/fetch_geoip.py`; register real sites; record real traces with `?record=1`; test once on a real phone over HTTPS; tell me about the native-app, privacy and review-policy decisions.
