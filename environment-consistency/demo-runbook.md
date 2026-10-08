# Demo runbook (5 minutes), judge Q&A, failure table

Written for: you, running the hackathon demo. **Every number below comes from the P7 rehearsal on 2026-10-08** (a desktop Chrome playing the phone, against the single-origin public-mode build, with REAL IP-database lookups and the SYNTHETIC classifier). The addresses were REAL public addresses forwarded in a header, **not a real VPN**. On your phone the numbers will differ a little (your own carrier, a real VPN exit): the phone test (`phone-test.md`) is what confirms them. Do not quote a number from this page as a measurement of the real world.

## What the judges are told (say it, do not hide it)

1. "The photo is checked on the phone and again on the server. On top of that we check whether the phone's **movement** matches the **GPS trail**, and whether the **network** fits the claimed place."
2. "A web page **cannot read WiFi names or cell towers**. So the network check uses the phone's public IP address: its country, region and provider from an IP database (DB-IP), plus a learned profile of what the network usually looks like at this site. A native app could read WiFi and cell towers; that is the next step."
3. "IP location is **coarse** on purpose: mobile carriers and big networks resolve far from the phone (we measured it on the real database: Cloudflare's 1.1.1.1 resolves to Sydney and another Cloudflare address to Toronto). So a far-but-same-country address is only a weak sign and never flags by itself."
4. "The model that decides is trained on **simulated** data: our own simulator of walks, GPS spoofs and networks, run through the real detectors. It has never seen real fraud cases. Its accuracy figures are properties of the simulator, not of the real world."
5. "Only the classifier turns the signals into a decision. No single rule blocks anyone. The dashboard shows the sentence behind every flag."

## The 5-minute script

Before the judges arrive: `demo/demo-up.sh` is running, the preflight is green, the site was moved to this venue (Dashboard > Site location), and you did the **three genuine recorded visits** (Dashboard > Site location > Learned network says "Learned from 3 accepted visits"). DEMO chip OFF. The phone has the app open on the Capture page, the laptop shows the Dashboard (token entered).

| Min | You do (phone) | The dashboard shows | You say |
|---|---|---|---|
| 0:00 | Show the Capture page: task, Visit recording box ("Recording · N location fixes") | Site location card: this venue, radius 100 m, country IN; Learned network: 3 accepted visits | "This site is registered. The system has learned what the network here looks like from three real visits." |
| 0:45 | **Genuine visit**: walk the last 100 m with recording on, take the photo, submit | Accepted. Case file: Motion consistent (rehearsal: 98), Network consistent, trail ends inside the site circle | "Movement and GPS tell the same story; the network matches the site." Rehearsal: P(fraud) 0.01, environment 1.00 |
| 1:45 | Turn the **VPN on, exit in another country**; submit from the site | **Flagged**; sentence "The network is in `<their country>`, the site is in IN"; hosting/VPN note | "Same phone, same walk, but the network is in another country." Rehearsal (Singapore hosting exit): P 0.99, environment 0.21 |
| 2:45 | VPN on, exit in **India** | Not flagged; note "hosting / VPN network" | "A VPN alone is not an accusation. An honest worker on a company VPN is not flagged." Rehearsal (Amazon Mumbai): P 0.02, environment 0.455 |
| 3:30 | **GPS spoof** (mock-location app places you at the site while you stay still) | **Flagged** by the motion signal: "GPS jumped N km in 5 s while the phone stayed still"; trail drawing with a dashed red jump | "The GPS says we teleported; the accelerometer says the phone never moved." Rehearsal: motion 16, P 1.00 |
| 4:15 | Switch to the laptop: **Site location** card | Change log (when the site was moved, 'learned network forgotten'), Learned network table | "Every move of the site is logged; the learned network is visible and can be forgotten." |
| 4:45 | | | The honest-limits line (points 2-4 above), then questions |

**Prefer the VPN case over the plain foreign-ISP case on stage.** In the rehearsal a genuine walk from a real **US ISP address** was flagged but only just (P(fraud) **0.60**, environment 0.30, threshold 0.5), while the foreign VPN exit was flagged at **0.99**. The VPN is the dependable demo; if you show the foreign ISP, expect it to be near the line.

Other rehearsal results (REAL addresses, SYNTHETIC classifier): a carrier gateway 850 km away in the same country: accepted, P 0.01, environment 0.65, note "far from the site" (weak sign only); a private address (no network evidence): accepted, environment unknown (0.50), never flagged; no site registered: accepted, the case file says "No site is registered for this task".

## Judge Q&A

| Question | Answer (short, true) |
|---|---|
| Why the IP address and not WiFi? | A web page cannot read WiFi names or cell towers (the browser forbids it). The IP gives country, region and provider. A native app could add WiFi and cell identifiers; the server already accepts and scores them, no app sends them yet. |
| What if an honest worker uses a VPN? | A VPN in the same country is a weak sign and is not flagged by itself (rehearsal: accepted, P 0.02). A VPN that exits in another country is flagged for review, not rejected: it cannot be told apart from a spoofer behind that country's network. |
| What if the carrier's IP resolves far away? | That is common for mobile carriers. The distance rule is lenient (300 km, weight 0.35) and a far same-country address never flags alone (rehearsal: 850 km, accepted). The phone test measures your own carrier. |
| What is simulated? | The classifier's training data (a simulator of walks, spoofs, networks), and therefore every accuracy number. The IP database, the phone's sensors, the GPS and the camera in the demo are real. |
| How would a native app improve it? | WiFi and cell-tower identifiers (hashed) compared with those seen at the site; background trail before the app is opened; a mock-location flag from Android. |
| How are location and IP data protected? | Dashboard, photos, sites and reviews need a token. Only a shortened IP is stored (last octet zeroed; IPv6 keeps 48 bits) and a retention tool removes it and the GPS points after 30 days (a default, the owner's decision). Logs hide IPs and tokens. The page makes no third-party requests. |
| Can it be fooled? | Yes. A modified app or an emulator can send any sensor stream; replayed real motion on a frozen fake location is invisible to the motion rules; a spoofer with an accomplice at the site passes the network check. It raises the cost of faking, it does not make it impossible. |
| Why trust the model? | We do not, yet: it is trained on our own simulator. The first real labels come from reviewers and from tests like this one. |

## If something goes wrong

| What happens | One-line fix |
|---|---|
| The laptop went to sleep / the app shows a blank page | wake it; `demo/demo-up.sh` keeps it awake with `caffeinate`; reload the app |
| No internet at the venue | connect the laptop to your phone hotspot; the tunnel reconnects, the address does not change. If the phone itself has no data, play the backup video |
| The tunnel is down (page cannot be reached) | in the `demo-up.sh` terminal restart it; check `https://<DOMAIN>/health` |
| The dashboard says 401 | type the dashboard token into the box in the Live feed |
| The app shows a URL bar at the top | the APK fingerprint is not in `backend/data/assetlinks.json` yet (cosmetic) |
| A visit is not accepted at the site | open the case file and read the sentence: motion `absent` = no sensor data (use Chrome / the APK and allow motion); a short trail = record at least 60 s first |
| "Learned from 3" does not appear | the visits were without sensor data; record three more with the recording box showing "Recording" and motion granted |
| GPS permission denied | allow location for the site in Chrome's site settings, reload |
| The IP database is missing | top bar chip "IP database not installed": `cd backend && .venv/bin/python tools/fetch_geoip.py`, restart `demo-up.sh` |
| The VPN case is not flagged | check the VPN really exits in another country: `https://<DOMAIN>/api/env/check?site_id=site_demo_1` shows the country the server sees |

## Backup video checklist (N5)

Record 2-3 minutes of the phone screen after the phone test passes: the Capture page with the recording box, a genuine accepted visit, the VPN-in-another-country flag with its sentence, the same-country VPN not flagged, the GPS spoof flagged, then the dashboard (Site location, Learned network, change log). Say the honest-limits lines at the start. Keep the file on the phone and on the laptop.
