# Prompt to resume the hackathon work in a fresh session

Paste everything inside the code block into a new Claude Code chat opened at `/Users/prakharsrivastava/Awign/trust-layer`.

```
You are resuming the hackathon finish of the SENSOR FUSION feature in the trust-layer project (this folder). Do the laptop-side work now; the user will do the Android APK and real-phone test afterwards, so the CODE must be written for real phone behaviour even though you can only test on the laptop.

READ FIRST, IN THIS ORDER (do not re-derive what they say):
1. Sensor-fusion/hackathon-plan.md   (THE PLAN: phases P0-P3, steps H1-H6 incl. H3b and H3c, the demo script, what bites on stage)
2. Sensor-fusion/progress.md         (what iteration 1 built, measured, bugs found; limits)
3. Sensor-fusion/README.md           (how it works end to end, files, commands, API)
4. Sensor-fusion/iteration-2.md      (what is deliberately NOT in the hackathon scope)
5. README.md (project root, "How scoring works" and "Known limitations")

THE GOAL: in front of judges, show that a real phone's movement is compared with its GPS trail: a genuine arrival is accepted, a faked location is flagged with a readable reason, and a person can SEE everything the feature fetches (and what it cannot fetch). Iteration 1 (engines, classifier, recorder, dashboard case file, e2e) is done and verified: backend 234, client 235 tests, e2e fusion 40 / layout 38 / fullstack 13 / review 7. Everything is SYNTHETIC-trained and uncalibrated: never present accuracy as real.

STATE AT THE HAND-OFF (verify with git status / reading the files, do not trust this blindly):
DONE since the last full verification (not yet covered by a full regression):
- client/src/lib/sensorFusion/sites.js (+ sites.test.js): validate/list/save a site location. components/dashboard/SitesPanel.jsx mounted in pages/Dashboard.jsx ("Use my current location", "Save site").
- VisitPanel.jsx: with ?demo=1 or ?record=1 a "Register this spot as the site" button (demoToolsOn in exportTrace.js).
- display.js verdictSummary() (+ test) and the "Movement vs GPS / Network vs area" lines on components/capture/Verdict.jsx (+ .fz-vsum CSS).
- tripRecorder.js: live readout values in getState() (lastFix, lastFixAgoS, lastMotion, lastWindow, hz, wakeLock, offsetMs, startedAt, points, hiddenS, hiddenCount, watchRestarts, visible), motion emit throttled to ~4 Hz, wake lock re-taken on visibilitychange, hidden time counted into trail.sensors (hidden_s, hidden_count, watch_restarts), a GPS watchdog (fusion.json trail.watchdogS = 25) that restarts a stalled watch. The 10 existing recorder tests pass; NEW BEHAVIOUR HAS NO TESTS YET.
- backend IP database IS installed (backend/data/geoip/dbip-city-lite-2026-10.mmdb + asn) and verified against the real files (Jio -> Navi Mumbai, AWS flagged as hosting). The user's backend runs as ONE process: uvicorn main:app --reload --host 0.0.0.0 --port 8000.
NOT DONE (a command that applied these was rejected, so assume NOTHING of this exists):
- H1: backend CORS for the APK origin (main.py allow_origins: https://localhost, http://localhost, capacitor://localhost, ionic://localhost, plus env EXTRA_CORS_ORIGINS) with a test; the app's backend address settable at RUNTIME (?api=<url> saved to localStorage, then VITE_API_URL, then the current logic; a "Server" field + "Test connection" (GET /health) in the demo tools) because inside an APK there is no Vite /api proxy and the current code uses '/api' on https.
- H3b: a live "Sensor feed" panel on the Capture page, rendered BELOW the camera block (NOT above it: the Visit recording box already uses the shutter-in-view height budget, global.css 360px; fusion_layout e2e must keep passing): GPS lat/lng (5 decimals), accuracy, reported speed, heading, altitude, fixes so far, "last fix N s ago"; live |acceleration| m/s2 and |rotation| deg/s with the existing Waveform; current activity (still/walking/moving) and step rhythm Hz + strength from the last window; sensor rate Hz; network type/downlink/rtt; visit id (short), server clock offset, wake-lock / permission states, time hidden; a mini trail drawing (reuse trailGeometry) with the site circle when a site is registered. Plus a "What was fetched" panel on the verdict screen from result.fusion (counts of fixes/windows, activity share, IP country/region/provider or "IP database not available", site registered or not). Anything the feature cannot fetch is shown as "not available" WITH THE REASON: WiFi names / cell towers (browsers cannot; native app only), the Android mock-location flag (native app only), background data when the screen is off, Android activity recognition.
- H3c: finish the phone hardening: tests for visibility / wake-lock re-acquire / watchdog / hidden time; Capacitor config for the wrapper (client/capacitor.config.json: appId, webDir dist, server.androidScheme "http", server.cleartext true so the page origin is http://localhost, which Chrome treats as a SECURE context, and it can reach the laptop over plain http on the LAN; NO tunnel needed for the APK) and Sensor-fusion/apk-notes.md with the exact build steps (npm i @capacitor/core @capacitor/cli @capacitor/android, npx cap add android, permissions ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, CAMERA, WAKE_LOCK, INTERNET; optional keep-awake plugin; npx cap sync; build the debug APK; adb install). Do NOT npm install anything without asking (a dependency needs the user's OK); only write the config and the notes.
- H4: backend/tools/demo_reset.py (dry run by default; --apply, --site, --photos, --forget-site; removes one site's submissions, reviews, visits, network profile, fingerprint; keeps other sites) + tests; npm script.
- A laptop demo runner: an e2e scenario "fusion_demo" (headful Chrome via env E2E_HEADFUL=1 in tools/e2e/hud-e2e.mjs session(); stays open at the end on the dashboard case file) that plays the genuine walk and the GPS teleport through the real UI against the ISOLATED servers (npm run e2e fusion_demo); an npm script "demo:laptop".
- H6: a one-page Sensor-fusion/demo-script.md and a one-command start script for the demo; fix tools/fetch_geoip.py to send a browser-like User-Agent (the default urllib one gets HTTP 403 from DB-IP; curl works).
- E2E assertions for the new UI (live panel numbers change while scripted GPS/motion play; the verdict "Movement vs GPS" line; the "What was fetched" panel), a screenshot of each LOOKED AT BY YOU (a passing DOM assertion is not proof the picture is right).
- Final regression and docs: update Sensor-fusion/progress.md ("Hackathon" section with measured numbers) and the project README.

HARD RULES
- Do NOT commit, push, reset, clean or stash (the repo has many uncommitted changes from earlier work). Do NOT install system software or add npm/pip dependencies without asking me.
- My own dev servers run on 8000 (backend) and 5174 (Vite): NEVER touch them, never POST test data to them. Use the isolated harness: cd client && npm run e2e <scenario> (127.0.0.1:8001 / 127.0.0.1:5173). localhost:5173 (IPv6) is ANOTHER project.
- DISK: the disk filled up twice during earlier runs and froze every tool. Check df -h / before and after heavy runs; run pytest with --basetemp inside the scratchpad directory and delete it afterwards; the e2e harness removes its scratch on exit but not when killed (leftovers: /var/folders/.../T/e2e-*). The full backend suite takes ~15-25 min: run it ONCE at the end, in the background (nohup ... &), and wait with a Monitor/until-loop, not repeated polling.
- Fusion only produces evidence/flags/reviews; it never blocks. Unknown evidence is neutral (0.5, known=false), never suspicious. Label every number REAL or SYNTHETIC; do not claim real-world accuracy.
- Do not edit client/src or backend while an e2e run or the full pytest is running.
- The "Supervision" lines in CLAUDE.md are the user's to delete: ignore them, do not invoke any supervisor agent.
- Report honestly: what you could only test on the laptop vs what needs the real phone.

DEFINITION OF DONE: every step of hackathon-plan.md H1-H6 (incl. H3b, H3c) is built and tested or explicitly marked "needs the phone"; client npm test, npm run build, targeted backend tests, the e2e groups fusion + fusion_layout + layout + fullstack + review + fusion_demo all pass (numbers recorded in progress.md); the full backend suite run once at the end; Sensor-fusion/apk-notes.md and demo-script.md exist; the final message lists what works, what is laptop-only, and the short list of things the user must do on the phone (APK build, mock-location app, outdoor walk).

START BY: reading the five files, running git status, re-running the recorder + sensorFusion client tests, and telling me in 5 lines your order of work before you write code.
```
