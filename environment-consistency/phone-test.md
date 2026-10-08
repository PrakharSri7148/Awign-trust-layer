# The phone test (the last step, yours)

Written for: you, standing at the demo place with your Android phone and the laptop. **This test has not been done.** Everything before it (the public server, the security, the APK packaging files, the preflight, the rehearsal in a desktop browser) is done and verified; what only a real phone can show is listed at the end.

Fill the results into `templates/phone-test-results.csv` (copy it first). Send the file, or the failing rows, to the assistant; the triage table below says what is usually behind each failure.

## Before you leave (laptop)

1. `export DASHBOARD_TOKEN="<long random secret>"`, `export DEMO_DOMAIN="<your fixed address>"`, `export TUNNEL=ngrok` (or `cloudflare`), then `demo/demo-up.sh` (see `tunnel-runbook.md`). Leave it running.
2. In a second terminal: `cd backend && .venv/bin/python tools/preflight.py --url "https://$DEMO_DOMAIN"`. Every line must be green. `assetlinks.json` may say `NEEDS N3` until you built the APK (then the app shows a URL bar; everything else works).
3. A clean demo database (the demo uses `backend/data/demo.db`, not your development database): `cd backend && TRUST_LAYER_DB=data/demo.db .venv/bin/python tools/demo_reset.py --all-sites` is a dry run; add `--apply` to really clear (it makes a backup first and keeps the registered sites).
4. Plugged in, no sleep, phone hotspot ready as a backup. The DEMO chip in the dashboard top bar must be OFF.
5. Phone: the APK installed (`docs/apk-build.md`) or just Chrome; **location, camera and motion allowed**.

## The steps (stand at the demo place)

| # | Step | Pass if | If it fails |
|---|---|---|---|
| 0 | **Move the site to the demo place.** Open `https://<DOMAIN>/dashboard` on the phone or the laptop, enter the token, open **Site location**, stand at the venue, tap **Use my current location** (wait for a fix better than ±50 m, or type the coordinates), keep **Forget the learned network** ticked, **Review change**, **Confirm and save**. Set country **IN** and a radius of 100 m | the panel shows the venue's coordinates; the change log lists the move; the "Learned network" card says "Nothing learned yet" | the form shows the backend's message; if the GPS accuracy is poor, type the coordinates |
| 1 | Open the app (or `https://<DOMAIN>/` in Chrome). Allow location, camera, motion | the Capture page loads over HTTPS; no certificate warning | wrong domain, tunnel down, Chrome too old: read the preflight |
| 2 | On **mobile data** (WiFi OFF) open `https://<DOMAIN>/api/env/check?site_id=site_demo_1` | shows your carrier, your country and a distance. **Write the distance down.** If it is above 300 km and you are standing at the site, the rule is too strict for your carrier: tell the assistant (the 300 km limit is a guess) | `could not read this caller's address`: `TRUSTED_PROXY_HEADER` does not match the tunnel (ngrok: `x-forwarded-for`, Cloudflare: `cf-connecting-ip`) |
| 3 | The same on the **WiFi** you will use at the venue | the venue ISP and a small distance | |
| 4 | **Three genuine visits** at the site. Tap **Start recording my visit** BEFORE you walk, record at least 60 seconds, walk the last 100 m, take the photo, submit. Do it three times | all three accepted. In the dashboard, **Site location > Learned network** says "Learned from 3 accepted visits" (and `tools/seed_check.py` says READY). Visits with no motion data (motion `absent`) do NOT count | motion or photo flags: open the case file and read the sentence. "Phone sensors: motion absent" means the browser gave no sensor data: use Chrome (or the APK), allow motion |
| 5 | A genuine visit, switching WiFi to mobile data right before submitting | accepted; the case file shows a network note if the speed class is new | |
| 6 | Turn the VPN on with an exit in **another country**; submit from the site | **flagged**; the sentence names both countries ("The network is in NL, the site is in IN") | check which country the VPN really exits in (`/api/env/check`) |
| 7 | VPN on with an exit in the **same country** | the "hosting / VPN" note appears; **not flagged** by the VPN alone | if flagged, send the case file (score, flags, distance) |
| 8 | Mock-location app puts the phone at the site while you sit elsewhere (or the DevTools override); the phone stays still | flagged by the motion signal (`gps_jump_flat_motion`) | |
| 9 | Dashboard on the laptop with the token | the three genuine visits, the VPN case and the spoof case are listed with their reasons; the DEMO chip is off | |
| 10 | Record the 2-3 minute backup video | | |

## What this test can show that nothing before it could

| Not verifiable without the phone | Why |
|---|---|
| The real carrier's IP resolution and its distance to your site | measured only in step 2 |
| A real VPN exit (country, hosting flag) | the rehearsal forwarded real public addresses in a header, it did not route through a VPN |
| Real WiFi/cell behaviour and the browser's link information on your phone | the rehearsal scripted these |
| Android Chrome's real motion sensor rate and the trail from walking | scripted in the rehearsal |
| The APK, full-screen mode, permissions inside the app | needs the device |
| The ngrok warning page (if you use ngrok) | only the tunnel shows it |

## If something fails: the likely cause and where the fix is

| Symptom | Likely cause | Files that change |
|---|---|---|
| Honest worker flagged on mobile data | the carrier resolves far away | `ipFarKm` / `weights.ipFar` in `client/src/lib/sensorFusion/fusion.json` + a row in `Sensor-fusion/thresholds-changelog.md`, then retrain (`backend/train.sh`) |
| A foreign VPN is not flagged | the VPN's provider is not in the hosting keyword list, or the exit resolves to India | `environment.hostingKeywords` in `fusion.json` (log it); `backend/fusion/environment.py` |
| The three visits do not make "Learned from 3" | motion absent / recording off / motion score below 0.8 | nothing to change: record again with the recording on; the rule is `learnMinMotion` in `fusion.json` |
| `/api/env/check` shows a private address or the tunnel's address | wrong `TRUSTED_PROXY_HEADER` or hops | the variable in your shell; `backend/fusion/ipctx.py` `client_ip` |
| 413 or 411 when submitting | a photo larger than the cap, or a client sending no length | `MAX_PHOTO_BYTES`, `backend/public_mode.py` `body_cap` |
| The dashboard says 401 | normal: enter the token in the Live feed | |
| The app shows a URL bar | the fingerprint is not in `backend/data/assetlinks.json` yet | `backend/data/assetlinks.json` (N3) |
| The page is blank in the app | the address in the app is not the current tunnel address | rebuild the app (`docs/apk-build.md`) |
