# Environment consistency: iteration 2, deploy, package and rehearse (everything except the phone test)

Date: 2026-10-08
Status: **implemented up to what needs you (2026-10-08)**: P0, P1, P4-P8 done and verified; P2 and P3 written, not run (blocked on N1 and N3). Evidence and open items: `progress.md`. Starts after [`iteration-1.md`](iteration-1.md) (E0-E6) is done. Live state: [`progress.md`](progress.md). Prompt: [`iteration-2-prompt.md`](iteration-2-prompt.md).
Audience: you (section 1), then the engineer / agent who implements it.

**Goal of this iteration.** When it is finished, the only thing left is **the final phone test** (section 5): install the APK on your Android phone and walk through the demo. Everything before that (public hosting, security, APK packaging files, preflight, reset tool, demo runbook, rehearsal in a desktop browser, the phone-test pack) is done and verified here.

The demo-is-real rule from iteration 1 section 0 still holds. The only fake thing allowed is a test IP provider inside **automated tests**, which the server refuses to load in public mode.

---

## 1. What I need from you

| # | What | When | Notes / default |
|---|---|---|---|
| **N1** | **Choose how the backend becomes reachable from the internet** and create the account. Recommended: **Cloudflare Tunnel** (free, no browser warning page, needs a domain you own, about 10 USD/year) **or an ngrok free static domain** (free, one per account, but may show a "visit site" warning page that can spoil a full-screen app: we test it in P2 and fall back to Cloudflare if it does). Tell me which, the chosen **domain name**, and that you have logged in to the tool on your laptop (`ngrok config add-authtoken ...` or `cloudflared tunnel login`). I never see your token | before P2 | default: ngrok static domain. A random "quick tunnel" address is **not** acceptable: it changes on every restart and the APK is tied to the address |
| **N2** | **Your laptop is the server for the demo**: it must stay awake, plugged in, and online. Bring a phone hotspot as a second internet source. Tell me the laptop OS (macOS here) | demo day | the runbook has a `caffeinate` line and a fallback |
| **N3** | **Build the APK once, early** (I give you the exact commands in `docs/apk-build.md`; they run on your machine because they need Java and the Android SDK): `bubblewrap init --manifest https://<domain>/manifest.webmanifest`, `bubblewrap build`, then `bubblewrap fingerprint list`, and send me the **SHA-256 fingerprint**. Needs JDK 17 and the Android SDK (Android Studio has it). Choose and remember a keystore password | after P3 | without the fingerprint the app still works but shows a browser address bar at the top; I mark full-screen as "optional polish" |
| **N4** | **A VPN app on the phone** with a choice of exit country (any consumer VPN with a free tier that lets you pick a country), and **a mock-location app** (or use a second laptop with Chrome DevTools) for the GPS-spoof case. You enable "mock location app" in Developer options | phone test | needed for the two wrong-network and spoof demo cases |
| **N5** | **Record a 2-3 minute backup video** of the full demo on your phone screen once the phone test passes | after the phone test | insurance against venue WiFi |
| **N6** | Phone details for the log: model, Android version, Chrome version | phone test | |

## 2. Design decisions

| # | Decision | Why |
|---|---|---|
| D1 | **One public address for everything.** The backend serves the built client (`client/dist`) and the API from the same HTTPS origin, through the tunnel | one domain = no CORS problem, no mixed content, one `assetlinks.json`, the APK points at one address |
| D2 | The laptop is the server; the IP database and the model stay on it | the database is 130 MB and gitignored; a cloud host adds nothing for a demo |
| D3 | **Public mode** (`PUBLIC_MODE=1`) is a single switch that makes the server refuse to start unless it is safe | removes the "forgot to set the token" class of mistakes |
| D4 | The APK is a **Trusted Web Activity** (Bubblewrap): it opens the site in the phone's real Chrome | real Chrome means real Network Information API, GPS, sensors and camera |
| D5 | Nothing fake is shipped: no demo IP switch, no seeded visits, no mock dashboard data | the demo is real |
| D6 | Every pre-demo check is automated in one command (`preflight`) | no gap depends on someone remembering |

## 3. Phases

Order: P0, P1, P2, P3, P4, P5, P6, P7, P8. After each phase run its tests and update `progress.md` (built / measured / bugs found / open).

| Phase | Scope | Exit criteria | Needs |
|---|---|---|---|
| **P0** Single-origin build | backend serves `client/dist` with a single-page-app fallback (client routes `/` and `/dashboard`), the client uses the same-origin `/api` base the existing `dev:https` mode uses (backend accepts it), correct cache headers (hashed assets cached, `index.html` not), `npm run build:prod` + start script | on an isolated port: the page loads, a submission works, a hard refresh on `/dashboard` works, API paths are not shadowed by the SPA fallback | iteration 1 |
| **P1** Public-mode hardening | `PUBLIC_MODE=1`: refuses to start without `DASHBOARD_TOKEN`, `TRUSTED_PROXY_HEADER`, a database path and the model file; disables `/docs` and `/openapi.json`; the test IP provider is refused; `ENV_CHECK` is allowed but reports that it is on; exact-origin CORS from `ALLOWED_ORIGINS` (unneeded with D1, but kept strict); honours `X-Forwarded-Proto`; request body caps; logs never print raw IPs or tokens; security headers (`Permissions-Policy` allowing geolocation, camera, accelerometer and gyroscope for this origin only, `X-Content-Type-Options`, `Referrer-Policy`); the dashboard asks for the token and works through it | tests: starts only when safe, each missing variable gives a clear message; dashboard and photo endpoints return 401 without the token; the capture endpoints stay open (workers have no token) with the existing rate limit | N1 for the proxy header value |
| **P2** Tunnel runbook | exact commands and config for the chosen tunnel (N1), `TRUSTED_PROXY_HEADER` value (`x-forwarded-for` for ngrok, `cf-connecting-ip` for Cloudflare) and `TRUSTED_PROXY_HOPS`, a `demo-up` script (starts the backend in public mode, the tunnel, then preflight), a keep-awake line, the ngrok warning-page check, the hotspot fallback | with the tunnel up, `curl https://<domain>/health` works from outside; `GET /env/check` from your phone on mobile data shows **your real carrier IP, country and provider** (this is the first real-network check) | **N1** |
| **P3** TWA packaging files | `manifest.webmanifest` (name, short name, `display: standalone`, `start_url`, `scope`, theme and background colours, icons 192/512 and a maskable 512 generated from the project's logo), `<link rel="manifest">` in `index.html`, `twa-manifest.json` ready for Bubblewrap (host = your domain, location delegation on, notifications off, no splash flicker), `/.well-known/assetlinks.json` served from `backend/data/assetlinks.json` (placeholder until N3), a manifest validator script, and `docs/apk-build.md` (JDK, SDK paths, the four commands, `adb install`, how to read the fingerprint, how to rebuild if the domain changes) | validator passes; the manifest and icons load from the public URL; `assetlinks.json` is served with the right content type | N1; N3 for the real fingerprint |
| **P4** Preflight | `tools/preflight.py`, exit code 0 only if every check passes: DB-IP files present and fresh (< 45 days) and a lookup works; at least one site registered and its coordinates plausible; model file loads and the monotone scan passes; `PUBLIC_MODE` flags correct; `DASHBOARD_TOKEN` set; trusted-proxy header set; the public URL answers `/health` and serves the manifest and `assetlinks.json`; `client/dist` is built; disk space; the database is the demo database; the DEMO (mock) flag is not baked into the build; prints a green/red table | tests for each check with a broken setup; a clear red line for each failure | P0-P3 |
| **P5** Demo hygiene | `tools/demo_reset.py`: dry run by default, `--apply` makes a timestamped backup of the database and photos, then removes submissions, visits, learned profiles and photos, **keeps the registered sites**; `tools/seed_check.py` (read-only) prints how many accepted visits each site has learned (so you know whether the "unseen network" demo is ready); the runbook tells you to clear the browser's DEMO flag | reset leaves sites intact and is reversible from the backup; refuses to run in public mode with active requests unless `--force` | P4 |
| **P6** Demo runbook | `environment-consistency/demo-runbook.md`: the 5-minute script scene by scene (what you do on the phone, what the dashboard shows, the exact expected scores from iteration 1 E1), the line you say about simulated training data and about WiFi/cell, a judge Q&A sheet (why IP and not WiFi? what if a VPN user is honest? what if the carrier IP is far? what is simulated? how would a native app improve it? how are location and IP data protected?), the failure table (laptop asleep, no internet, tunnel down, DB missing, GPS permission denied) with the one-line fix for each, and the backup-video checklist | every number in the script comes from a run in P7, not from this plan | P7 |
| **P7** Rehearsal and verification | full regression (pytest, npm test, build, fusion parity, `npm run e2e` on isolated ports); new e2e scenarios, run in headless Chrome as the phone against the **single-origin public-mode build**: near-site genuine (accepted), foreign-country network (flagged, sentence names both countries), foreign VPN exit (flagged), honest same-country VPN (not flagged by VPN alone), carrier gateway far (not flagged), unregistered site (note), unknown (never flagged), GPS teleport with flat motion (motion flag), refreshing the dashboard with and without the token; the **test** IP provider is used only here and the e2e asserts it is refused in public mode; screenshots of the capture flow and the case file at phone and desktop widths, looked at and described; fill the measured numbers into the runbook | all green vs the iteration 1 baseline; the rehearsal table in `progress.md` shows each scenario's real output | P0-P6 |
| **P8** Phone-test pack | `environment-consistency/phone-test.md` (section 5 below, with the exact URLs and values filled in), a results log (`templates/network-tests-template.csv`), a triage table "if this fails, the likely cause and the fix", and a list of the files that change if a result is wrong (so a fix is quick) | the pack is complete; **the agent states clearly that the phone test is not done** | N1-N6 |

## 4. Definition of done for iteration 2

- P0-P8 ticked in `progress.md` with evidence; the preflight run (all green) is pasted into `progress.md`.
- The public URL serves the app, the dashboard needs the token, `/env/check` works, the manifest and `assetlinks.json` are valid, and the preflight is green.
- The rehearsal in headless Chrome passes every scenario in P7 with the real database lookups (not just fakes), except where the scenario needs a real foreign IP, which only the phone test can provide. Each such case is marked "needs phone test".
- Nothing fake is reachable in public mode. The final message says plainly: **everything is done except the phone test**, and lists the gaps that only the phone can close.

## 5. The last step: the phone test (yours; the agent helps fix what fails)

Do it on your real Android phone with the APK from N3, with `demo-up` running on the laptop. Use a fresh demo database (`demo_reset.py --apply`), a registered site, and stand at that site.

| # | Step | Pass if | If it fails |
|---|---|---|---|
| 0 | **Move the site to the demo place.** On the dashboard open **Site location**, stand at the hackathon venue, tap **Use my current location**, keep **Forget the learned network** ticked, confirm, save. Check the change log shows the move | the panel shows the venue's coordinates and the log lists the change; `/env/check` (step 2) reports a small distance | the form shows the backend's message; if GPS accuracy is poor, type the coordinates |
| 1 | Install the APK (or open the URL in Chrome first). It opens full-screen (or with a URL bar if no fingerprint). Allow location, camera and motion | the Capture page loads over HTTPS; permissions are granted | check domain, `assetlinks.json`, Chrome version |
| 2 | Open `/env/check?site_id=<site>` on **mobile data** | shows your carrier, your country, a distance to the site; note the distance. If it is above the rule (300 km), set `ipFarKm` from this number and log it in `thresholds-changelog.md` | the rule is a guess; adjust with this evidence |
| 3 | Same on the **WiFi** you will use at the venue | shows the venue ISP and a small distance | |
| 4 | Genuine visit 1, 2, 3 at the site (the learned network was cleared in step 0, so these three rebuild it) (walk the last 100 m, take a photo, submit) | all three accepted; the site now has a learned profile | motion or photo flags: read the case file |
| 5 | Genuine visit, switching WiFi to mobile data before submitting | accepted; the case file shows the network note if the class is new | |
| 6 | Turn on the VPN, exit in another **country**; submit from the site | flagged; the sentence names both countries (`ip_country_mismatch`) | check the P7 output for that case |
| 7 | Turn on the VPN, exit in the **same** country | the VPN note appears; not flagged by the VPN alone | |
| 8 | Mock-location app places the phone at the site while you sit elsewhere (or the DevTools override); phone still | flagged by the motion signal (`gps_jump_flat_motion`) | |
| 9 | Open the dashboard on the laptop (token) | the three genuine visits, the VPN case and the spoof case are listed with reasons; the DEMO chip is off | |
| 10 | Record the backup video (N5) | | |

The results go into `templates/network-tests-template.csv`. Any failure is fixed by the agent from the triage table; the phone steps are then repeated.

## 6. Risks still open when this iteration ends

1. **Venue internet**: the laptop and the phone both depend on it. Backup: hotspot, and the backup video.
2. **The tunnel address is part of the APK.** If you change the domain you must rebuild the APK (the runbook says how).
3. **Carrier IP distance** is measured in step 2 of the phone test, not before.
4. **A genuine on-site network does not prove the GPS**, and the classifier is trained on simulated data. Both are said on stage.
