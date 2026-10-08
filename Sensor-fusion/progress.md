# Sensor Fusion — Progress

Plan: [`iteration-1.md`](iteration-1.md) · how it works: [`README.md`](README.md) · what is left (and what you have to do): [`iteration-2.md`](iteration-2.md).

**Status (2026-10-08): iteration 1 implemented (F0-F10).** Everything below was built and tested on a **simulator** and in **headless Chrome playing a phone**. Nothing has run on a real phone and no threshold is calibrated on real traces: every accuracy number is SYNTHETIC.

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
| Client `npm test` | 201 passed | **{{CLIENT}}** |
| Backend `pytest -q` | 130 passed | **{{BACKEND}}** |
| Photo parity JS vs Python (`node tools/parity.mjs`) | 100% (37/37) | **100% (37/37)**, no disagreements |
| Fusion parity (`npm run fusion:parity`) | - | **13/13 cases, 104 values** |
| `npm run build` | OK | **OK** |
| E2E `npm run e2e` (isolated servers 8001/5173) | 229 PASS (per `edge-validator/progress.md`; not re-measured at F0) | **{{E2E}}** (the four new `fusion_*` scenarios are 29 of them) |
| Accuracy report (`npm run report`) | - | regenerated: {{REPORT}} |

## What the simulator says (SYNTHETIC: the model's behaviour in the authors' simulated world, not real accuracy)

- The simulator builds raw GPS fixes (AR(1) noise), raw accelerometer/gyroscope streams and networks for 24 scenarios (genuine walks/drives/stationary/pocket, "hard genuine" traps, spoofs) and runs them through the **real** F1-F4 code; it holds no thresholds or weights (a test checks this, and that changing a weight moves its output). 2,150 rows (1,300 genuine / 850 fraud).
- {{SIM}}

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
- **No supervisor agent** (plan D12), by your decision. {{CLAUDE_MD}}
- **The IP database** (plan D9): you chose "install it". `maxminddb` is installed in the backend venv and in `requirements.txt`; the free DB-IP "lite" city + ASN files are **not** downloaded: the sandbox blocked my download command. `tools/fetch_geoip.py` is written and tested with a fake opener; **you run it once** (see `README.md`).
- **`fusion_insufficient_evidence` means "the phone's movement was not compared with the GPS trail"**, even when a GPS-only check against a registered site did run (the score is then "known" but GPS-only; the case file says so).
- The visit is matched to **worker + site**, not the task: switching task after walking to the site must not lose the approach.
- Recorder times are kept on the device clock and corrected by the server-clock offset when the snapshot is made, so the recorder can start inside the tap (iOS motion permission) before the visit is open.

## Open (carried to `iteration-2.md`)

- **Honest retries:** {{RETRY}}
- Everything in `iteration-2.md` §0 (IP database download, real sites, real traces, a real phone, the native-app decision, privacy decisions, unknown-evidence policy, reviewers).
- **Honest workers can still be flagged** (simulated rates in report section 5b: the hard-genuine group, quiet tunnel/highway rides). The real rate is unknown.
- **Replayed real motion on a frozen fake location** and **wrong-area network** fraud are the least-caught spoofs (SYNTHETIC numbers in the report); the latter needs the IP database or a native app.
- The list endpoint loads every row's full sensor report from the database on each 5-second dashboard poll (as it already did for the photo report); fine for thousands of rows, worth fixing before tens of thousands.
- iOS Safari / Android Chrome behaviour, wake lock, screen-off, battery: untested.

## Limits to repeat in every report

1. A web page cannot track in the background; "leading up to arrival" means while the app is open.
2. A web page cannot read WiFi/cell identifiers. A native app can (the server side is ready); whether to build one is yours to decide.
3. A modified client or an emulator injecting realistic sensor streams can fool this; the visit session and replay checks raise the cost only.
4. Indoor/urban GPS noise and smooth car rides are the main false-positive risks.
5. Every accuracy number is SYNTHETIC until real traces and reviewed submissions exist.
6. Location history is personal data: the consent text is a draft; retention (default 30 days for coordinates), access and wording are your decisions.

## What you need to do next

See `iteration-2.md` §0 (U1-U8). In order: run `tools/fetch_geoip.py`; register real sites; record real traces with `?record=1`; test once on a real phone over HTTPS; tell me about the native-app, privacy and review-policy decisions.
