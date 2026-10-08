# Android APK: build and install (hackathon H5)

Do the browser test first: [phone-test-guide.md](phone-test-guide.md) Part B (same web code, 15 minutes).

The APK is a thin wrapper (Capacitor) around the same web app. The sensors, the camera and the recorder are the web code that was tested in Chrome; the wrapper adds the Android permissions and keeps the screen on. **None of this has been built or run on a phone yet:** the steps below are written from the Capacitor and Android documentation, and the config files they use are in the repo.

## What is already in the repo

| File | What it does |
|---|---|
| `client/capacitor.config.json` | `appId com.trustlayer.demo`, `webDir dist`, `server.androidScheme "http"` + `cleartext: true`: the page runs as `http://localhost` inside the app. Chrome treats `localhost` as a **secure context**, so GPS, motion and the camera work, and the app can call the laptop over plain `http://<LAN IP>:8000`. **No tunnel is needed for the APK.** |
| `client/tools/apk.mjs` (`npm run apk`) | builds the web app with the demo tools on, adds the Android permissions to the manifest, makes `MainActivity` keep the screen on, runs `npx cap sync android` and `./gradlew assembleDebug`, prints the APK path |
| `backend/main.py` CORS | accepts the app's origins `http://localhost`, `https://localhost`, `capacitor://localhost`, `ionic://localhost` and any extra origin in `EXTRA_CORS_ORIGINS` (comma separated) |
| `client/src/lib/api.js` | the backend address can be changed **inside the app**: Sensor feed → Server → enter `http://<laptop IP>:8000` → Test connection → Save (stored on the phone). Also `?api=<url>` in a browser, or `VITE_API_URL` at build time |

## One-time setup (needs your OK: it adds npm dependencies and installs Android tools)

1. **Android Studio** (it brings the SDK and a Java 17+ runtime). Phone: Settings → About → tap *Build number* 7 times → Developer options → **USB debugging** on.
2. In `client/`:
   ```bash
   npm i @capacitor/core @capacitor/cli @capacitor/android
   npx cap add android          # creates client/android/ (a normal Android Studio project)
   ```
3. Optional: the community keep-awake plugin (`@capacitor-community/keep-awake`) is **not needed**. `npm run apk` adds `FLAG_KEEP_SCREEN_ON` to `MainActivity` instead, because the Android WebView has no Screen Wake Lock API.

## Every build

```bash
cd client
npm run apk                                        # backend address set later in the app
npm run apk -- --api http://192.168.1.20:8000      # or bake a default in (your laptop's LAN IP: ipconfig getifaddr en0)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run apk` adds these permissions to `android/app/src/main/AndroidManifest.xml` if missing (idempotent; tested by `tools/apk.test.mjs`): `INTERNET`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `CAMERA`, `WAKE_LOCK`, `ACCESS_NETWORK_STATE`. The app asks for location and camera the first time the page uses them (Capacitor's WebView client turns the page's request into the Android permission dialog). Motion sensors need no permission on Android.

## The backend for the phone

The phone and the laptop must be on the **same WiFi** (a phone hotspot works; many venue/guest networks block device-to-device traffic, test early).

```bash
cd backend
DASHBOARD_TOKEN=<secret> .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
```

(`--host 0.0.0.0` makes it reachable from the phone. If you use a tunnel instead, add its address to `EXTRA_CORS_ORIGINS` only if you open the web app from it; the APK's own origin is already allowed.) macOS may ask whether Python may accept incoming connections: allow it.

In the app: **Sensor feed → Server** → `http://<laptop IP>:8000` → **Test connection** (green "Connected… N ms") → **Save**. With `DASHBOARD_TOKEN` set, "Register this spot as the site" and the dashboard need the token: open the Dashboard tab in the app and enter it there once.

## Check on the phone (what only the phone can tell)

| Check | Where to look | If it fails |
|---|---|---|
| GPS fixes arrive, accuracy ≤ ±20 m outdoors | Sensor feed → GPS | go outside; wait 30 s; Location must be "Precise" for the app |
| \|Acceleration\| / \|Rotation\| change when you move the phone | Sensor feed → Motion | the WebView should fire `devicemotion` without a prompt; if the numbers stay "-", note the Android version and WebView version |
| Activity shows "walking" with a rhythm 1.5-2.3 Hz while walking | Sensor feed → Activity now / Step rhythm | write down the numbers: the thresholds are uncalibrated (SYNTHETIC) |
| Screen stays on during the walk | Sensor feed → Session → wake lock says "kept on by the app" | if the screen still turns off, set the screen timeout to 10 min |
| Switching apps is counted | leave the app 10 s, come back: Time hidden goes up, the GPS restarts if it stalled | that time is not recorded, by design |
| Camera opens | Capture → Start camera | camera permission in Android settings → Apps → Trust Layer |

## Known unknowns (not testable on the laptop)

- Sensor rate in the WebView (Chrome on Android usually 60 Hz; some phones throttle to 5-20 Hz when battery saver is on: the rhythm detector needs ≥ 20 Hz).
- Whether a mock-location app's fixes look "too perfect" (constant accuracy, no jitter) to `fusion/geo.py`. Teleports are caught by the jump rule regardless.
- How a real WebView reports `navigator.connection` (often only `effectiveType`).
- iOS: not covered by this APK at all.
