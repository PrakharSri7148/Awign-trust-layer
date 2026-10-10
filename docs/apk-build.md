# Building the Android app (Trusted Web Activity)

The Android app is a thin shell that opens your public address in the phone's REAL Chrome, full screen. Because it is real Chrome, the browser's location, motion sensors, camera and network information all work exactly as they do in the browser.
You run every command here yourself (they need Java, the Android SDK and a signing key that must stay on your machine). The assistant never runs Bubblewrap, never sees your keystore or its password, and never runs `adb`.

> **Status 2026-10-10: the APK is BUILT and signed; not yet installed on the phone.** You asked the assistant to do the build, so it ran the steps itself (this changes the rule above for this build):
>
> 1. `npm i -g @bubblewrap/cli`, then `bubblewrap doctor` (downloaded its own JDK 17 and Android SDK into `~/.bubblewrap`; your system Java 25 is not used).
> 2. `android/twa-manifest.json` = the template with domain `fountain-drool-moving.ngrok-free.dev` and **`minSdkVersion` 24** (the template said 21; the androidbrowserhelper library needs 24, the build failed until it was raised; the template is fixed too).
> 3. Signing key made with `keytool` (alias `trustlayer`): `android/android.keystore`; the assistant generated the password and saved it in `android/keystore-password.txt`. **Back both up outside the project; never commit or share them.**
> 4. Accepted the Android SDK licenses by hand (`sdkmanager --licenses`; otherwise `bubblewrap build` hangs forever on a hidden prompt) and installed build-tools 36.1.0.
> 5. `bubblewrap update` then `bubblewrap build --skipPwaValidation` (`build` alone does NOT generate the project).
> 6. **ngrok problem:** ngrok's free warning page is returned to Bubblewrap for the icon URLs ("invalid Content-Type text/html"). Workaround used: the icons were served from a throw-away local server (a folder with only the two PNGs, port 8765, stopped afterwards) and `iconUrl`/`maskableIconUrl` in `twa-manifest.json` point to it. If you rebuild, serve those two files the same way again (or the build fails at `update`).
>
> **Result (REAL):** `android/app-release-signed.apk` (1.6 MB, package `app.trustlayer.demo`, minSdk 24), also `app-release-bundle.aab`. `apksigner verify` passes; SHA-256 of the key: `26:DA:3C:1E:A3:AD:CA:BA:BB:47:0A:15:3C:69:FD:32:C8:4C:89:76:D4:D0:8D:7B:9C:46:A1:4F:92:99:E7:C1` (public, safe to share). It is in `backend/data/assetlinks.json`, and the live address already serves it.
>
> **Not verified (needs the phone):** installing, the first launch, the permissions, and whether Chrome accepts `assetlinks.json` through ngrok's warning page (if not, the app shows a URL bar; it still works).

## Once: the tools

```bash
npm install -g @bubblewrap/cli
bubblewrap doctor            # offers to download a JDK 17 and the Android SDK for you; accept the defaults
```
If you already have Android Studio, point Bubblewrap at its SDK when `doctor` asks.

## The four commands

Replace `<DOMAIN>` with your fixed public address (no `https://`). The package id `app.trustlayer.demo` is a suggestion; if you change it, change it everywhere below and in `backend/data/assetlinks.json`.

```bash
cd android
cp twa-manifest.template.json twa-manifest.json
sed -i '' 's/<DOMAIN>/YOUR-DOMAIN-HERE/g' twa-manifest.json      # macOS; or edit the file by hand
bubblewrap build                                                   # asks you to create a keystore the first time: choose a password and REMEMBER IT
bubblewrap fingerprint list                                        # prints the SHA-256 fingerprint of your signing key
```

(Alternative that asks you every question interactively: `bubblewrap init --manifest https://<DOMAIN>/manifest.webmanifest`, then `bubblewrap build` and `bubblewrap fingerprint list`.)

`bubblewrap build` writes `app-release-signed.apk` in the `android` folder. **Keep `android.keystore` and its password safe**: without them you cannot update the app under the same identity. Never commit them and never send them to the assistant.

## Tell the server about the key (N3: send the assistant the fingerprint)

1. Copy the SHA-256 fingerprint from `bubblewrap fingerprint list` (it looks like `AB:CD:12:...`; it is public, it is safe to paste into the chat).
2. Put it into `backend/data/assetlinks.json` (replace both `REPLACE_...` values: the package id and the fingerprint), restart the demo (`demo/demo-up.sh`).
3. Check it is served: open `https://<DOMAIN>/.well-known/assetlinks.json` in a browser; you should see your fingerprint. The preflight checks this too.

Without this step the app still works but Chrome shows a **URL bar at the top** (the app is not verified as belonging to your site). Everything else is the same, so treat full screen as optional polish.

## Install on the phone

```bash
adb install app-release-signed.apk       # phone connected by USB, USB debugging on
```
or copy the APK to the phone and open it (allow "install unknown apps" for your file manager once).

## First launch

Open "Trust Layer". It should open the Capture page full screen (or with a URL bar if the fingerprint is not in yet). Allow **location**, **camera** and **motion** when asked. If it shows an error page, the tunnel is down or the address in the app is not the current one.

## If the domain changes

The address is baked into the app. Change `<DOMAIN>` in `android/twa-manifest.json`, run `bubblewrap build` again (same keystore), put the new fingerprint in only if you made a new key, and reinstall the APK.

## Which files are involved

| File | What it is |
|---|---|
| `client/public/manifest.webmanifest`, `client/public/icons/*` | what Chrome and Bubblewrap read (served by the backend) |
| `android/twa-manifest.template.json` | the Bubblewrap settings: your address, location delegation ON (so Chrome can use the phone's location), notifications OFF, no splash fade |
| `backend/data/assetlinks.json` | served at `/.well-known/assetlinks.json`: proves the app belongs to your site |
| `backend/tools/validate_manifest.py` | checks the manifest and the icons (also part of the preflight) |
