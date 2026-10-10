# Building the Android app (Trusted Web Activity)

The Android app is a thin shell that opens your public address in the phone's REAL Chrome, full screen. Because it is real Chrome, the browser's location, motion sensors, camera and network information all work exactly as they do in the browser.
You run every command here yourself (they need Java, the Android SDK and a signing key that must stay on your machine). The assistant never runs Bubblewrap, never sees your keystore or its password, and never runs `adb`.

> **Status 2026-10-10: the APK build is IN PROGRESS, and the rule above was changed by you for this build.** You asked the assistant to do the build, so it ran the steps below itself:
> 1. `npm i -g @bubblewrap/cli`, then `bubblewrap doctor` (it downloaded its own JDK 17 and Android SDK into `~/.bubblewrap`; your system Java 25 is not used).
> 2. Copied `android/twa-manifest.template.json` to `android/twa-manifest.json` with the domain `fountain-drool-moving.ngrok-free.dev` (your ngrok fixed address from 2026-10-09; the tunnel must be UP during `bubblewrap build`, which downloads the icons from it).
> 3. Created the signing key with `keytool` (alias `trustlayer`) in `android/android.keystore`. **The assistant generated the password and saved it in `android/keystore-password.txt`** (readable only by you). Back both files up outside the project; never commit or share them.
> 4. Ran `bubblewrap build --skipPwaValidation`. Result: see `environment-consistency/progress.md` (row N3) for whether it succeeded.
>
> Still to do after the build: put the fingerprint and the package id into `backend/data/assetlinks.json`, restart the demo, install the APK on the phone. Known risk: ngrok's free "Visit Site" warning page may make Chrome fail to verify `assetlinks.json`, so the app may show a URL bar (it still works).

You need: the tunnel up with your fixed address (see `environment-consistency/tunnel-runbook.md`), Node, and an Android phone with USB debugging (or just the APK file, to copy to the phone).

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
