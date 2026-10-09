# 5-minute presentation script: Trust Layer

Speaking pace ~140 words/minute. Spoken text ≈ 505 words ≈ 3 min 40 s, leaving about 80 seconds for the two live demo beats and pauses. If a demo fails, switch to the backup video and keep talking; the script reads the same. Say "simulated" out loud for every number marked **S**. **R** = real.

**Before you start:** `demo/demo-up.sh` running, preflight green, site registered at the venue, phone on the Capture page, laptop on the Dashboard with the token entered, DEMO chip OFF. Full stage setup and failure table: `environment-consistency/demo-runbook.md`.

---

## 0:00 - 0:40 | Problem

`[SLIDE: worker + phone + "Proof of work = photo + GPS"]`

"Gig platforms pay for one thing: proof that work was done. That proof is a photo and a GPS point, and both are cheap to fake. GPS spoofing is a free app and about ninety seconds of setup. A photo can be blurry, reused, or a picture of a screen. India's gig workforce is projected to reach 23.5 million by 2030, so checking every submission by hand cannot scale. We asked: can the phone itself produce evidence a cheater cannot easily fake?"

## 0:40 - 1:20 | Idea

`[SLIDE: Light + Motion + Network → one explainable verdict]`

"Our answer is a trust layer that checks the claim *I was here and this is what I saw* against three physical channels the worker doesn't fully control. **Light**: computer vision on the photo. **Motion**: the accelerometer and gyroscope against the GPS trail. **Network**: where the connection really enters the internet. That's Physical AI as perception and verification. A monotone gradient-boosted classifier with SHAP turns the three into one verdict with a sentence a reviewer can read, and nothing blocks a worker on a single signal."

## 1:20 - 2:30 | Motion: Sensor Fusion (demo 1)

`[SLIDE: GPS trail with a dashed red jump over a flat accelerometer timeline]`
`[DEMO 1, ~25 s: mock-location app on, submit from the site; show the flagged case: 'GPS jumped N km in N s while the phone stayed still']`

"While the app is open, it records GPS and five-second summaries of the accelerometer and gyroscope. The server asks a physical question: if GPS says you moved twenty-two kilometres in seven seconds, did your body accelerate? We detect walking by gait rhythm, between 1.2 and 2.8 hertz, and line it up with GPS speed, jumps and the signature of a fake provider.

On our real Oppo phone, the mock-location spoof was **flagged at 100%**: GPS jumped 22.2 kilometres while the phone sat still **R**. The same phone also found a bug our simulation never would: a constant sensor offset made a phone on a table read as moving. We fixed it in both the browser and server code."

## 2:30 - 3:30 | Network: Environment Consistency (demo 2)

`[SLIDE: Bengaluru site vs London VPN exit]`
`[DEMO 2, ~20 s: VPN on, exit in another country, submit; show the flagged sentence 'The network is in GB, the site is in IN']`

"A spoofer can fake coordinates, but not where their connection enters the internet. A web page can't read WiFi or cell towers, so we use the request's IP: country, region, operator, and hosting or VPN detection, plus a per-site network profile learned only from trusted visits, so a spoofer can't teach us their own network.

Same phone, same walk: on home WiFi the server saw Bengaluru, ten kilometres from the site, score 1.0. Through a UK VPN it saw London, 8,044 kilometres away, score 0.21, flagged **R**. A VPN inside the same country is not an accusation. And we measured the IP database honestly: it puts 1.1.1.1 in Sydney, so the distance rule is deliberately lenient."

## 3:30 - 4:00 | Light: Edge Validator

`[SLIDE: live camera HUD with 10-segment meters]`

"The photo is checked on the phone about five times a second by a Web Worker, then re-checked on the server from the same thresholds file, with **100% verdict parity** **R**. Blur detection reaches **AUC 0.99** on real photos and wrongly blocks 1 in 106 good ones **R**. Selfie tasks add MediaPipe face landmarks and a liveness challenge, a random blink, smile or head turn, bound to a single-use server nonce."

## 4:00 - 4:30 | Proof it works

"Tested at five levels: 281 client and 525 backend tests, JavaScript-to-Python parity, 361 end-to-end checks in real headless Chrome including replay attacks, a physics-based simulator, and a real phone with a real tunnel and VPN. In simulation, the classifier catches **94% of fraud and flags 3% of honest workers; in a shifted world 80% and 5%** **S**. As arithmetic, not measurement: that is roughly **₹4 lakh saved per lakh submissions** at an assumed 3% fraud rate and ₹200 per task."

## 4:30 - 5:00 | Limits and close

"What we haven't proven: the classifier is trained on simulation, we tested one real phone, liveness has no real spoof samples, and a modified client can inject sensor data. We raise the cost of cheating; we don't make it impossible. Next: real traces, a native Android plugin for WiFi and cell fingerprints, and retraining on reviewer labels. Light, motion and network: three physical channels, one explainable verdict. Thank you."

---

## Timing guard

| If you are at... | Do this |
|---|---|
| 2:00 and Demo 1 is not done | Skip to the slide, say the 22.2 km result, move on |
| 3:15 and Demo 2 is not done | Skip the live VPN; state "London, 8,044 km, flagged" from the slide |
| 4:00 | Drop the Edge Validator slide to one sentence ("checked on-device and re-checked on the server, 100% parity") |
| Anything fails | Play the backup video; keep the same words |

## Likely first question (have this ready)

"Is the 94% real?" → "No, it is simulated; the real evidence is the blur AUC of 0.99 on real photos and the real-phone tests: a spoof flagged at 100% and a foreign VPN flagged. Real accuracy needs reviewer-labelled traces, and the review queue that produces them is already built."
