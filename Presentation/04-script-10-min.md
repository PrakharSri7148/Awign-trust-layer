# 10-minute presentation script: Trust Layer, end to end

Speaking pace ~140 words/minute. Total spoken text ≈ 1,300 words ≈ 9 min 15 s, which leaves about 45 seconds for pauses and demo beats. `[SLIDE]` = what is on screen. `[DEMO]` = optional 20-30 s live beat (cut them first if you run long; the script still works without them). Numbers marked **R** are REAL, **S** are SYNTHETIC: say "simulated" out loud for every S number.

---

## 0:00 - 1:00 | The problem

`[SLIDE: a field worker, a phone, "Proof of work"]`

"Platforms like Awign run on one promise: *work was done, here is the proof*. A million-plus gig partners across thousands of pin codes photograph a shelf, visit a site, check in with a selfie. The client pays for that proof.

And the proof is weak in exactly the three places a cheater needs. The **photo** can be blurry, reused, or a picture of a screen. The **location** is one free app away from a lie: GPS spoofing takes about ninety seconds, and the top spoofing apps have tens of millions of downloads. And the **identity**: is that a live person, or a photo of a person?

India's gig workforce is projected by NITI Aayog to go from 7.7 million to 23.5 million by 2030. Verification by humans does not scale to that. So the question we asked is: *can the phone itself produce evidence a cheater cannot easily fake?*"

## 1:00 - 2:00 | The idea: verify against the physical world

`[SLIDE: three channels: Light, Motion, Network → one explainable verdict]`

"Our answer is a **trust layer** that checks a digital claim, *I was here and this is what I saw*, against **physical evidence the claimant doesn't fully control**.

Three channels. **Light**: computer vision on the photo, on the phone and again on the server. **Motion**: the accelerometer and gyroscope against the GPS trajectory. **Network**: where the connection physically enters the internet. That's what I'd call **Physical AI** as perception and verification: models that reason about the phone as a physical body, kinematics, optics and radio, not a robot, but sensing-grounded AI running at the edge.

On top sits one monotone gradient-boosted classifier with SHAP, so every verdict comes with a sentence a reviewer can read. Nothing blocks a worker on a single signal; the system flags for review."

## 2:00 - 4:00 | Edge Validator: computer vision on the device

`[SLIDE: live camera with HUD, 10-segment meters]` `[DEMO: open the camera, cover the lens, show Focus/Lens meters react]`

"First, the **Edge Validator**. When the worker frames a photo, a Web Worker runs seven pixel checks about five times a second: blur, exposure, resolution, lens obstruction, glare, camera shake, noise and compression. For selfie tasks, MediaPipe's BlazeFace and FaceLandmarker add the face check and a **liveness challenge**: the server issues two random actions, a blink, a smile, a head turn, and a single-use nonce. The shutter stays locked until the worker actually performs them.

Three engineering points. One: our blur metric is edge steepness over local contrast per tile. We *threw away* the textbook Laplacian when we found it scored a dim copy of the same photo sixteen times lower. On real photos it reaches an **AUC of 0.99, catches 96 of 98 blurry images and wrongly blocks 1 in 106 good ones, R**. Two: the same logic runs in Python on the server from one shared thresholds file, with **100% verdict parity** across 37 variants. The server never trusts the phone. Three: a screen replay is hunted by moiré peaks in the frequency domain, a bezel detector, and landmark planarity, a flat picture moves as one homography, a face doesn't.

The UI thread cost is a **median 9 milliseconds per tick**; the server's full re-check is **about 320 ms R**."

## 4:00 - 6:00 | Sensor Fusion: Physical AI on the phone

`[SLIDE: GPS trail with a dashed red jump; below it the accelerometer timeline flat]` `[DEMO: the mock-location spoof; show 'GPS jumped 22.2 km in 7 s while the phone stayed still']`

"Second, **Sensor Fusion**, the heart of the Physical AI idea. While the app is open it records a GPS fix every five seconds and, per five-second window, *summaries* of the accelerometer and gyroscope. Never the raw stream.

On the server we ask a physical question: *if the GPS says you moved 22 kilometres in seven seconds, did your body accelerate?* We classify each window as still, walking or moving using a gait cadence from per-axis autocorrelation in the 1.2 to 2.8 hertz band, and line it up against GPS speed, jumps, and the statistical fingerprints of a fake provider. Ten weighted signals combine as a noisy-OR into a consistency score between zero and one.

On a **real Oppo phone**, a genuine walk read as walking at 2.3 hertz. The mock-location spoof was **flagged at 100%**: GPS jumped 22.2 kilometres while the phone sat still. And the phone found a real bug our simulation never would: a constant 0.22 metre-per-second-squared offset made a phone lying on a table read as *moving*. We fixed it in both ports and the table now reads *still*.

Missing sensors are never suspicious: no data means a neutral 0.5, not a flag."

## 6:00 - 7:00 | Environment Consistency: the third channel

`[SLIDE: map pin in Bengaluru vs a VPN exit in London; 'GB vs IN']`

"Third, **Environment Consistency**. A spoofer can fake coordinates and even motion, but not where their connection enters the internet. A web page can't read WiFi names or cell towers, so we use the request's IP, its country, region and operator from the DB-IP database, hosting and VPN detection, plus a per-site network fingerprint learned **only from trusted visits**, so a spoofer can't teach the system their own network.

Real test, same phone, same walk: over home WiFi, **Bengaluru, ten kilometres from the site, score 1.0**. Through a **UK VPN**, the server saw London on a data-centre network 8,044 kilometres away: score 0.21, flagged, with the sentence *'The network is in GB, the site is in IN.'* A same-country VPN is not an accusation. We measured IP geolocation on the real database, 1.1.1.1 resolves to Sydney, so the distance rule is deliberately lenient."

## 7:00 - 8:00 | The decision, and the human loop

`[SLIDE: the case file: scores, SHAP bars, review queue]`

"The classifier takes five inputs and is **monotone by construction**: a worse photo, motion or network score can *never* lower the fraud probability. That sounds obvious, but we caught our own earlier model violating it: a foreign VPN scored *safer* at environment 0.17 than at 0.24. We probed it, fixed the labels, constrained the trees, and added a runtime guard.

Every flag goes to a **review queue**. A human approves, rejects or asks for a retake, and those decisions become the first *real* labels. Until we have two hundred reviewed cases, we say plainly that the classifier is trained on a physics-based simulator."

## 8:00 - 9:00 | How we tested it, and what fought back

`[SLIDE: test pyramid and a 'bugs we found' list]`

"We tested at five levels. **Unit**: 281 client tests and 525 backend tests. **Parity**: JavaScript against Python, 100% on photos, 13 of 13 cases, 104 values, on fusion. **End to end**: real headless Chrome with a fake camera against an isolated backend, 361 checks across 32 scenarios, including replay attacks. **Simulation**: thousands of simulated trails, including a *shifted world* to stress it. And **real devices**: a real phone, a real tunnel, a real VPN, a real mock-location app.

What fought back: a Laplacian metric that was wrong, a walking detector that was off by a factor of two because acceleration magnitude is rectified, indoor GPS drift that looked like walking in 16 of 18 cases until we fixed it, carrier-NAT addresses that Python called public, a classifier that went the wrong way, and a 'good photo refused' report where we could not establish the root cause on the device. We shipped a diagnostic instead and wrote down that we hadn't solved it."

## 9:00 - 9:40 | Impact in numbers

`[SLIDE: per 1,00,000 submissions table]`

"What's it worth? Illustrative arithmetic, not a measurement: per 1,00,000 submissions, at an assumed 3% bad-evidence rate, a task value of ₹200 and ₹10 per human review. Using our *simulated, shifted-world* accuracy, 80% caught and 5% of honest workers sent to review, the system stops about **2,400 bad payouts, ₹4.8 lakh**, for **₹72,500 of review effort**: a net of roughly **₹4 lakh per lakh submissions**. The break-even precision is just **5%**; even if real recall is half and honest flags are 8%, it is still net positive at about ₹1.5 lakh. Reviewers look at about 7% of volume instead of sampling blindly. Replace our assumptions with Awign's real fraud rate and task value, and the formula stays the same."

## 9:40 - 10:00 | Honest limits and close

`[SLIDE: Limits + Next]`

"What we have *not* proven: every classifier accuracy number is **simulated**; liveness has no real spoof samples; face fairness across skin tones is unmeasured; a modified client can inject sensor streams. We raise the cost of cheating, we don't make it impossible. Next: record real traces, build the native Android plugin for WiFi and cell fingerprints and the mock-flag, and retrain on reviewer labels.

The point is this: **light, motion and network, three physical channels, one explainable verdict.** Cheating now means faking all three consistently. Thank you."

---

## Cue card: the 12 numbers to remember

| Number | What | R/S |
|---|---|---|
| AUC **0.990**, 96/98 caught, 1/106 false block | Blur check on real photos | R |
| **100%** (37/37) | JS↔Python verdict parity | R |
| **~320 ms** p50 / 422 p95 | Server photo re-check | R |
| **9.4 ms** p50 UI tick | On-device live check | R (laptop) |
| **92% vs 20%** | Burst vs single shot best-frame | S stream |
| **100%** flagged, 22.2 km in 7 s | Mock-location spoof on the real phone | R |
| **0.22 m/s²** | Real-phone sensor offset bug | R |
| **8,044 km**, env 0.21 | UK VPN vs Bengaluru site | R |
| **94% / 3% / AUC 0.98** | Recall / honest flagged, in-distribution | S |
| **80% / 5% / AUC 0.92** | Same in the shifted world | S |
| **281 / 525 / 361** | Client tests / backend tests / e2e checks | R |
| **5%** | Break-even precision (review cost ÷ task value) | formula |

## If you have 5 minutes instead

Keep: Problem (0:45), Idea (0:45), Sensor Fusion with the spoof demo (1:15), Environment with the VPN comparison (0:45), Limits + close (0:30). Drop the Edge Validator detail to one sentence and skip the testing section. Use `environment-consistency/demo-runbook.md` for the stage script.
