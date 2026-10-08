# Sensor Fusion — Iteration 2: real data, real phones, and the decisions that are yours

Date: 2026-10-08
Status: **planned, not started.** Iteration 1 built and tested the whole pipeline on a simulator and in headless Chrome ([progress.md](progress.md)). Iteration 2 is what that cannot do by itself: it needs your data, your phones, and a few decisions only you can make.

Audience: you (the first half is a to-do list for you), then the engineer / agent who implements the code items. Read first: `Sensor-fusion/README.md`, `progress.md`.

## 0. What you have to do (nothing here blocks you from using the app today)

| # | What | Why it matters | Where it is explained |
|---|---|---|---|
| U1 | **Install the IP database:** `cd backend && .venv/bin/python tools/fetch_geoip.py`, then restart the backend. (I could not download it from my session: the sandbox blocked it.) Credit DB-IP (CC BY 4.0) wherever the data is shown | without it the network signal is the weak link-speed profile only; the IP-country / region / VPN rules do nothing. The reader has only been tested against fake records, so also look at one real case file afterwards (Network line: country, region, provider) | README "The IP database" |
| U2 | **Register your real sites**: `PUT /sites/<site_id>` with `{"lat", "lng", "radius_m", "country"}` (example below) | the arrival check, the "outside the site" check and the IP-distance check all need to know where the site really is. Nothing is seeded on purpose | below |
| U3 | **Record real traces** into `Sensor-fusion/samples/<scenario>/` with `?record=1` (walks, drives, stationary, indoor, and spoofs) | every accuracy number is SYNTHETIC until these exist; they are also how the thresholds get calibrated | `samples/README.md` |
| U4 | **(Hackathon prepared: see [apk-notes.md](apk-notes.md) and [demo-script.md](demo-script.md); the phone run is still yours.)** **One real phone over HTTPS** (`cd client && npm run dev:https`), Android Chrome and, if workers use iPhones, iOS Safari: do a genuine walk and one fake-location test | headless Chrome played the phone in every test so far; the real motion permission, wake lock, sensor rate and screen-off behaviour are unknown | `samples/README.md` |
| U5 | **Decide: native app or not.** A web page cannot read WiFi names or cell towers, so the "WiFi/cell environment inconsistent with the claimed area" part of the goal is only approximated on the web (IP database + learned network profile). A native app (Android/iOS) can send hashed WiFi/cell identifiers: the server field (`radio`) and scoring already exist and are unit-tested; the app does not | this is the one place where the goal as you wrote it cannot be fully met without new work outside this web app. Also the only way to record the journey in the background (a web page stops when the screen is off) | README "What is partial" |
| U6 | **Privacy decisions**: approve or rewrite the consent text (`client/src/lib/sensorFusion/consent.js`, currently a DRAFT), choose the retention period for stored coordinates (default 30 days; `tools/purge_trails.py` is a dry run until you run it with `--apply` and schedule it), and decide who may see coordinates (today: anyone with the dashboard token) | location history is personal data | `Sensor-fusion/README.md` |
| U7 | **Decide the policy for unknown evidence** per task: `optional` (default: a note only) or `required` (sends the case to review, never blocks). It is `policy.tasks` in `fusion.json` | tells the system which tasks must have sensor evidence | `iteration-1.md` §3.7 |
| U8 | **Tell me when there are reviewers** (who, and how they log in): once ~200 reviewed cases exist (50+ per class) the classifier can be retrained on real labels instead of the simulator | the only route from SYNTHETIC to REAL accuracy | `backend/tools/reviewed_dataset.py` |

Register a site (with `DASHBOARD_TOKEN` set, add `-H "Authorization: Bearer <token>"`):

```bash
curl -X PUT http://localhost:8000/sites/site_blr_014 -H 'Content-Type: application/json' \
  -d '{"lat": 12.9716, "lng": 77.5946, "radius_m": 80, "country": "IN", "label": "Shop 14"}'
```

## 1. Code items (for the next implementation session)

| Phase | Scope | Needs |
|---|---|---|
| G0 | **Check the IP reader against the real DB-IP files** (record shapes, IPv6, missing ASN) and add a test using a tiny real-format sample; show the attribution line in the dashboard footer | U1 |
| G1 | **Sites admin in the dashboard**: list, add and edit a site's location on a form (today it is a `curl`), with a "no site registered" warning on cases from unregistered sites; import from CSV | U2 |
| G2 | **Calibration tool** `backend/tools/fusion_calibrate.py`: per scenario folder, prints the feature distributions (GPS speed classes, activity shares, jump counts, accuracy), the flag rates, and suggests threshold changes; never edits `fusion.json` itself (changes go through `thresholds-changelog.md`) | U3 |
| G3 | **Retune on real traces**: the activity thresholds (`still.accRms`, `gyroRms`, walking cadence), the GPS error allowance, `jumpSpeedMs`, `vehicleWeightScale`, the arrival rule; re-measure the hard-genuine false-flag rate on real quiet rides and indoor traces (the simulator's tunnel/highway false-positive rate was the weakest honest-worker number) | U3, U4 |
| G4 | **Real-phone fixes** found in U4: iOS permission flow, wake-lock/background behaviour, sensor rate throttling, the Capture page's battery use, what happens when the screen locks mid-visit (resume works from storage; verify) | U4 |
| G5 | **Retrain on reviewed labels** when the threshold in U8 is met: extend `reviewed_dataset.py` to export the five fusion inputs, retrain, compare with the simulator model on the same held-out reviewed cases, and keep the simulator model as the fallback | U8 |
| G6 | **Native app hook** (only if U5 = yes): a documented contract and a reference client for `radio` (hashed BSSIDs + cell IDs), per-site known-radio learning from approved visits (already in `pipeline.py`), and a background trail upload; the server side needs little | U5 |
| G7 | **Operations**: schedule `purge_trails.py`, a dashboard tile with the share of submissions with "not enough sensor data" and the flag rates per week, a per-task policy file with a reload, and rate limits on `/visits` tuned from real use | U6, U7 |
| G8 | **Verification**: full regression, accuracy report with a REAL block that has numbers, the final "what changed" summary | all of the above |

## 2. What iteration 1 left open on purpose

- **Quiet rides:** a smooth tunnel or highway drive (phone barely vibrating) is the simulator's biggest honest-worker false-positive source (the report prints the rate). The rule counts a vehicle with a still phone only lightly (`vehicleWeightScale`), but there is no real data on how quiet real rides are.
- **Replayed real motion on a frozen mock location** is invisible to the motion rules by construction; only "GPS too perfect" and the network can see it. The report shows how often that is enough (SYNTHETIC).
- **Wrong-area network fraud** is mostly invisible without the IP database (U1) or a native app (U5).
- **The accuracy numbers are SYNTHETIC.** They show that the model learned the simulator, not how often real spoofers are caught.
- **iOS Safari and Android Chrome were never tested**, only desktop headless Chrome playing a phone.

## 3. Definition of done for iteration 2

U1-U4 done (or each explicitly deferred by you), G0-G3 and G8 done with the numbers in `progress.md`; the accuracy report's REAL block shows real traces with intervals; the weakest-areas list in the report no longer starts with "Sensor fusion has no real trace behind it". G4-G7 are done or marked as waiting for a decision (U5-U8).
