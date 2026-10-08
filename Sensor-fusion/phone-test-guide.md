# Phone test guide: set up, then test (real Android phone)

Do the parts in order. **Part B is the important one**: it runs the same web code the APK wraps, so if it works, the APK will almost certainly work; if it does not, you find out in 15 minutes instead of after a build.

Time needed: Part A 15 min, Part B 30 min (outdoors), Part C 15 min, Part D (APK) 45 min the first time.

What you need: the Android phone and a USB cable, the laptop, the **same WiFi** for both (a phone hotspot also works; guest/office/venue WiFi often blocks phone-to-laptop traffic: test early), and an open space outdoors with about 100 m to walk.

---

## Part A. Set up (once)

### A1. The phone (Oppo F19 Pro, ColorOS)

Menu names below are from ColorOS 11/12 as I know it; yours may be worded slightly differently. Use the search box at the top of Settings if a path is not where I say.

1. **Developer options:** Settings → **About device** → **Version** → tap **Build number** 7 times (enter your PIN). Then Settings → **Additional settings** → **Developer options**.
2. In Developer options switch on **USB debugging** (needed only for the USB variant and the APK) and **Stay awake** (screen stays on while charging).
3. **Mock-location app:** install one from the Play Store (for example "Fake GPS location"). Then Developer options → **Select mock location app** → choose it. Leave it **off** for now.
4. **Screen timeout:** Settings → Display & Brightness → **Auto lock / Screen timeout** → the longest (10 minutes, or "Never" if offered) for the outdoor walk.
5. **ColorOS kills background apps, and that matters here.** Settings → **Battery**: switch **Power saving mode / Super power saving** off. Then Settings → Apps → **App management** → **Chrome** → **Battery usage** (or Battery → Chrome): set it to **Allow background activity / Don't optimize**, and switch **Auto launch** on if it is there. Also keep Chrome in the foreground and the screen on during the walk: a web page stops recording when the screen is off.
6. **Precise location:** Settings → **Location** → on, then **Google Location Accuracy** (or "Improve accuracy") → on. Open **Chrome** → ⋮ → Settings → **Site settings** → **Location** → "Ask first" (not blocked), and **Motion sensors** → allowed.
7. Update **Chrome** from the Play Store. Connect the phone to the **same WiFi** as the laptop (note: ColorOS may show "WiFi has no internet" and offer to switch to mobile data; **choose to stay on WiFi**).

The F19 Pro has an accelerometer and a gyroscope, so the motion rows should fill in.

### A2. The laptop
1. Its WiFi address was `192.168.0.178` when I checked (`ipconfig getifaddr en0`; it can change, so check again). Call it `<IP>` below.
2. **Backend, listening on the network.** Stop the one you normally run and start it like this:
   ```bash
   cd backend
   .venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
   Do **not** set `DASHBOARD_TOKEN` for the first tests (the token is kept per browser tab and makes the phone steps fiddly). Set it only for the real event.
3. macOS asks "Do you want python to accept incoming network connections?" → **Allow**.
4. **Your client on 5174 was running as plain http when I checked: restart it as https** (I did not touch your server). **Client over HTTPS** (phones give GPS and motion only to HTTPS pages):
   ```bash
   cd client
   npm run dev:https
   ```
   If your usual `npm run dev` is running on 5174, stop it first; the address must start with `https://`. (`Sensor-fusion/demo-start.sh --https` does steps 2 and 4 for you and prints the address, but it **reuses** whatever is already on 8000/5174, so an old http server would be reused.)
5. Check from the laptop: `curl http://<IP>:8000/health` prints `{"status":"ok"}`.

### A3. First look on the phone
1. Phone Chrome → `https://<IP>:5174/?demo=1`
2. Chrome warns "Your connection is not private" (self-signed certificate) → **Advanced → Proceed to <IP>**.
3. You should see the Capture page. `?demo=1` is what shows the developer tools (the "Register this spot" button and the Server box).
4. Scroll below the camera: the **Sensor feed** panel should be there, saying "start the visit recording above to see live values".

If the page does not open: same WiFi? `curl` in A2.5 works? Firewall prompt allowed? Try `https://<IP>:5174` in the laptop's own browser.

---

## Part B. The first real test: the web page in Chrome (outdoors)

Go outside with the phone. Stand where you want the "site" to be (call this **the spot**).

### B1. Start recording and check the live feed (5 min)
1. Open `https://<IP>:5174/?demo=1`. Allow **Location** when Chrome asks. (Camera is asked later.)
2. In the Visit recording box tap **Start recording my visit**. Allow motion/location if asked.
3. Scroll to the **Sensor feed** and watch it for a minute. Check each row against this table:

| Row | Expected | If not |
|---|---|---|
| GPS · allowed, Latitude/Longitude | numbers with 5 decimals | "denied": Chrome → site settings → Location → allow, reload |
| Accuracy | **±10 m or better** after 30-60 s outdoors | wait; move away from buildings |
| Last fix | under 10 s ago, keeps resetting | a growing number means the GPS stalled (the app restarts it after 25 s; "GPS restarts" goes up) |
| Fixes kept | goes up about every 5 s | |
| \|Acceleration\| and \|Rotation\| | small numbers that **change when you shake the phone**; the waveform moves | "-" or "no sensor": note it and send a screenshot (see Part E) |
| Sensor rate | **20 Hz or more** (usually 50-60) | below 20: battery saver on? tell me the number |
| Activity now | `still` while you hold it still | |
| Server clock offset | a number in ms (the visit opened) | "-": the server is not reachable, see the Server box below |
| Screen wake lock | `held` | `not held`: set the screen timeout to 10 min |
| Network | a type such as `4g` | "not exposed" is possible on some phones: fine |

4. In **Sensor feed → Server** (only visible with `?demo=1`): the address should work as is, but tap **Test connection**; it should say "Connected … ms". If it fails, enter `http://<IP>:8000` → Test connection → Save.

### B2. Register the spot as the site (1 min)
1. Standing at the spot with the recording running and accuracy ±10 m or better, tap **Register this spot as the site**.
2. It says "This spot (±N m) is now site_demo_1, radius 80 m." The trail drawing in the feed now shows a circle (the site).

### B3. Genuine arrival (the main test, 5 min)
1. Walk about **100 m away** from the spot (more is fine).
2. Tap **Stop** in the Visit recording box, then **Start recording my visit** (a fresh visit that starts far away).
3. Wait about 20 s until the feed shows a fix. Then **walk back to the spot at a normal pace**, phone in your hand (not locked), screen on. Watch the feed:
   - **Activity now** becomes `walking`, **Step rhythm** about 1.5-2.3 Hz with a strength above 0.3
   - the trail drawing grows toward the circle; Distance goes up
4. Stand on the spot for about 20 s (Activity: `still`).
5. Take the photo (camera → shutter). The app checks the photo on the phone first. When it passes, a hint appears: *Photo checked. When you are standing at the site, tap the button…*. Standing at the spot, tap **I've reached the site · send my location**. Only now are your GPS and the recorded movement sent and checked.
6. Expected: **VERIFIED**. Under "Why?", **"Arrival at site" is green** ("GPS places you at the site: N m from its centre") and "Movement vs GPS" is green: "The phone's movement matches the GPS trail". "What was fetched" lists the fixes, motion windows, walking share, site registered, and the WiFi/cell/mock-flag rows as "not available" with the reason. The IP line says "private / local network address" (you are on your own WiFi: that is correct, not a fault).

Write down: motion consistency (open the Dashboard on the laptop: `http://localhost:5174/dashboard` → the newest row → Sensor fusion), the walking share, the step rhythm.

### B4. Fake location (5 min)
Goal: the GPS jumps to the spot while the phone stays still.
1. Tap **New submission** (the recording restarts by itself).
2. Open the mock-location app and set a fixed pin **several km away** from the spot. Switch it **on**.
3. Put the phone **on a table or the ground and leave it**. In Chrome the feed's Latitude/Longitude now shows the far pin. Wait about 25 s (about 5 fixes).
4. In the mock app move the pin **onto the spot** (or switch it off so the real GPS jumps back). Wait 25 s more. Do not touch the phone.
5. Pick the phone up, take the photo, then tap **I've reached the site · send my location**.
6. Expected: **FLAGGED FOR REVIEW**. "Arrival at site" may be green (the fake GPS *does* say you are at the site; that is the point) while "Movement vs GPS" is red, with a reason like "GPS jumped N km in N s while the phone stayed still". "What was fetched": GPS jumps shown in **red**. The Dashboard case file shows a dashed jump line and mismatch cells outlined.

If it is **not** flagged, note it: that is a real finding (a slow-moving pin looks like driving; move it in one step and far, more than 5 km).

Switch the mock-location app **off** when done.

---

### B5. Not at the site (2 min, optional)
Walk 100-200 m away from the spot, take a photo and tap **I've reached the site**. Expected: "Arrival at site" is **red** ("GPS places you N m from the site … arrival not confirmed, sent for review") and the case is flagged `gps_outside_site`. Nothing is blocked.

---

## Part C. Optional: record real traces (this is what makes the numbers real)

Every accuracy number in this project is SYNTHETIC until real traces exist. Fifteen minutes of walking gives the first real data.
1. Open `https://<IP>:5174/?record=1`, start the recording.
2. For each scenario in `Sensor-fusion/samples/README.md` (walk to site from 150 m+, phone in pocket, stationary, indoor, mock-app spoof) pick it in the scenario box, add a note (phone model, Android version, what you did), tap **Download trace**.
3. Move the files from the phone's Downloads to the matching `Sensor-fusion/samples/<scenario>/` folder (cable, or share to yourself). They contain where you were: do not publish them.
4. Later: `cd client && npm run report`.

---

## Part D. The APK (after Part B works)

Full detail: [`apk-notes.md`](apk-notes.md). Short version:
1. Install **Android Studio** (it brings the Android SDK and Java).
2. **Ask me (or confirm) before this step, it adds npm packages:**
   ```bash
   cd client
   npm i @capacitor/core @capacitor/cli @capacitor/android
   npx cap add android
   ```
3. Build and install (phone connected by USB, "Allow USB debugging" on the phone):
   ```bash
   npm run apk
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```
4. Open the app. The developer tools are on automatically. **Sensor feed → Server** → `http://<IP>:8000` → **Test connection** → **Save** (the app is not served from the laptop, so it must be told where the backend is). The backend must run with `--host 0.0.0.0` (A2.2).
5. Repeat B1-B4 inside the app. Extra things to check in the app: the wake lock row says "kept on by the app", and the screen stays on during the walk; switch to another app for 10 s and back: "Time hidden" goes up.

---

## Part E. If something fails, and what to send me

| Symptom | Likely cause | Try |
|---|---|---|
| Page will not load on the phone | different WiFi, firewall, an http server on 5174 | A2, A3 checks |
| "Could not reach the server" / no Server clock offset | backend not on 0.0.0.0, or a wrong address in the Server box | Test connection; `curl http://<IP>:8000/health` from the laptop |
| Accuracy stays above ±30 m | indoors, or GPS cold start | go outside, wait 1-2 min |
| \|Acceleration\| stays "-" | Chrome motion sensors blocked, battery saver | Site settings → Motion sensors → allow |
| Activity says `moving`, not `walking` | thresholds are uncalibrated (starting values) | send me the Step rhythm and \|Acceleration\| numbers; I will retune |
| Genuine walk got **FLAGGED** | quiet GPS or the site was registered somewhere else | open the case file, send a screenshot; do not register the site again from far away |
| Spoof not flagged | slow pin movement; or the mock app's trail looks real | move the pin far in one step; send the case file |
| Screen turned off mid-walk | timeout / Stay awake | it is counted as "Time hidden"; restart the visit |

**Known on the Oppo F19 Pro (tested 2026-10-08):** motion arrives at 36-47 Hz with no prompt; a phone flat on a table reads `still`; walking reads `walking` at about 2.3 Hz; GPS is ±8-10 m outdoors after a minute; a hard rhythmic shake also reads `walking` (sensors cannot tell it from steps).

**Send me, for each test:** a screenshot of the Sensor feed *while walking*; a screenshot of the verdict screen (including "What was fetched"); the Dashboard case-file screenshot; the phone model and Android version; and what felt wrong. From that I can fix thresholds or code without guessing.

## Results sheet (fill in)

| Test | Phone | Result (VERIFIED / FLAGGED / other) | Motion score | Notes |
|---|---|---|---|---|
| B3 genuine walk | | | | |
| B4 mock location | | | | |
| APK genuine walk | | | | |
| APK mock location | | | | |

What this does and does not show: a pass means the pipeline works on one real phone on one day. It is **not** an accuracy measurement; do not quote one.
