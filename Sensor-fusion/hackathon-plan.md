# Hackathon plan: close sensor fusion end to end, then test on a real Android phone

Goal: in front of the judges, show that a real phone's movement is compared with its GPS trail, that a genuine arrival is accepted and a faked location is flagged with a reason a human can read. Nothing here changes the design; it is the shortest path from "works in headless Chrome" to "works on your phone, live".

## 0. The 4 answers I need from you (nothing else)

| # | Question | Why | My default if you do not answer |
|---|---|---|---|
| Q1 | Do you have **Android Studio + a phone with USB debugging** (and which Android version)? | decides how the APK is built | no Android Studio: install the app from the browser first (step P0) and build the APK later |
| Q2 | Backend for the demo: **your laptop + a free public HTTPS tunnel (cloudflared / ngrok)**, or a cloud host? | the phone needs an HTTPS address for the backend (sensors and camera only work on HTTPS pages) | laptop + cloudflared |
| Q3 | Does the phone have a **mock-location app** (Developer options → "Select mock location app", e.g. "Fake GPS location")? | this is how you fake the location live on stage | if not, install one; or show the fake with Chrome DevTools → Sensors → Location on the laptop |
| Q4 | Will you demo **outdoors**, with about 100 m to walk? | indoor GPS is too poor to prove a genuine walk | outdoors; if not, I show the spoof live and the genuine walk from a pre-recorded trace |

## 1. What I build (code, about half a day)

| Step | What | Why |
|---|---|---|
| H1 | Backend accepts the app's origin (`https://localhost`, `capacitor://localhost`), and the client takes the backend URL from a build setting | an APK page is not served from your dev server |
| H2 | A **"Register this spot as the site"** button (and a small Sites form in the dashboard) | the arrival and "outside the site" checks need the site's location; you stand at the venue and tap once instead of typing coordinates |
| H3 | A **fusion summary on the verdict screen** (what the phone said vs what the GPS said, in one line each, green/red) | the judges see the point on the phone itself, not only on the dashboard |
| H3b | **Everything the feature fetches, visible on screen** (your request): a live **Sensor feed** panel on the Capture page (GPS lat/lng, accuracy, speed, heading, fixes so far; live accelerometer and gyroscope numbers with a waveform; current activity still/walking/moving and the step rhythm; network speed class; visit id, clock offset, wake-lock and permission state; a mini trail drawing) and a **"What was fetched"** panel on the verdict screen. What it cannot fetch (WiFi/cell, the mock-location flag, background data) is shown as "not available", with the reason | a person can see and feel the feature working, and see its limits |
| H3c | **Phone hardening** (written for real phones even though I can only test on the laptop): re-take the screen wake lock when the app comes back to the foreground, count the time the app was hidden, restart a stalled GPS watch, set the backend address inside the app (a tunnel or laptop address changes every run), Capacitor config for the Android wrapper and the Android permission list | phones behave differently from headless Chrome |
| H4 | **Demo reset** (clear submissions and the learned network profile for the demo site) and a seeded "before" state | start every run of the demo clean |
| H5 | **Capacitor wrapper** + Android permissions (location, camera, motion, wake lock, internet) + `npm run apk` script that builds the debug APK | the APK; sensors and camera work in the WebView over `https://localhost` |
| H6 | A short **demo script** and a **fallback video** plan (below) | live demos fail; have a recording |

Not built (deliberately, for the hackathon): IP database (optional 30-second command), native WiFi/cell scanning, real-label retraining, privacy tooling beyond what exists.

## 2. How to close it fast, in order

| Phase | Time | What | Done when |
|---|---|---|---|
| P0 | 30 min | **No APK yet.** Start the backend, open a cloudflared tunnel, set `VITE_API_URL` to it, serve the client over HTTPS (`npm run dev:https` or a build served through a second tunnel), open it in **Chrome on the Android phone**. Do the walk and the fake-GPS test | the case file shows a consistent walk and a flagged teleport from the real phone. **This is the real risk check**; the APK is only a wrapper around it |
| P1 | 2-3 h | I do H1-H4 | tests and the end-to-end scenarios pass again |
| P2 | 1-2 h | H5: Capacitor + APK, install with `adb install` | the APK shows the same behaviour as P0 |
| P3 | 1 h | rehearse the demo twice, record the fallback video | two clean runs |

## 3. The demo (3 minutes)

1. **Genuine arrival (60-90 s):** register the spot, tap "Start recording my visit", walk about 100 m toward the spot and stand there, take the photo, submit → *Verified*, verdict shows "phone movement matches the GPS trail".
2. **Fake location (60 s):** switch on the mock-location app (a jump to the site while the phone stays still on the table), submit → *Flagged*, reason "GPS jumped N km in a few seconds while the phone stayed still".
3. **Dashboard (45 s):** open both cases: the trail drawing, the GPS-vs-phone timeline with the mismatch outlined, the reason, the review queue.
4. **One honest sentence:** "The model is trained on simulated trails; we measured it on a simulator, and real-phone calibration is the next step."

## 4. Things that will bite you on stage

- **GPS needs sky.** Do the genuine walk outdoors; start recording at least 30 s before you walk, and wait for "±10 m" or better in the recording line.
- **Screen must stay on** during the walk (the recorder asks for a wake lock; also set the screen timeout to 10 minutes).
- **Android may pause the app** if you switch apps: stay on the page.
- **Public tunnel = public backend.** Set `DASHBOARD_TOKEN` before the event and do not post the URL.
- **Do not claim accuracy.** Say "simulated", show the report's section 5b only as such.
- **Have the fallback:** a screen recording of the full demo and the e2e screenshots in `edge-validator`/scratch.

## 5. After the hackathon

`iteration-2.md` (real traces, calibration, retraining, privacy decisions, the native-app decision).
