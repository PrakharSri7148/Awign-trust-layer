# Prompt 1: generate the PowerPoint

Copy everything below the line into Claude (a chat that can create files, or Claude Code). Attach or paste your images when it asks for them. Generate the diagrams with `08-diagram-generation-prompt.md` and give those files to Claude too.

---

You are a principal engineer and a presentation designer. Build a **16:9 PowerPoint (.pptx)** that I will present to **technical judges at a hackathon** (people who build ML and systems for a living and will probe weak claims). The deck must make them think: "these people understood the problem, built something real, measured it honestly, and know exactly where it breaks." Impressive comes from **depth, specificity and honesty**, not from buzzwords.

If you can create files, produce a real `.pptx` (use the pptx skill if available, otherwise pptxgenjs or python-pptx), then **render every slide to an image and inspect it yourself** for overflow, overlap, unreadable text and low contrast; fix everything before you answer. If you cannot create files, output complete pptxgenjs code I can run.

## 1. The project (ground truth, do not invent beyond this)

**Name:** Trust Layer. **Context:** built for Awign-style gig/field-work platforms, where a worker submits "proof of work" (a photo, a check-in, a location) and the client pays for it.

**Problem.** A field submission claims a digital fact: "I was here and this is what I saw." It is weak in three places: the **photo** (blurry, dark, covered lens, reused, or a photo of a screen), the **location** (GPS spoofing takes about 90 seconds with a free app; the top spoofing apps have tens of millions of downloads) and the **identity** (a live person or a photo of one). Human review does not scale: India's gig workforce is projected by NITI Aayog to grow from 7.7 million to 23.5 million by 2030.

**Core idea.** Verify the claim against **three physical channels the claimant does not fully control**, and combine them into one explainable verdict:
1. **Light** (computer vision on the photo): runs on the phone and is re-checked on the server.
2. **Motion** (Sensor Fusion): the accelerometer and gyroscope are compared with the GPS trajectory.
3. **Network geography** (Environment Consistency): where the connection really enters the internet.
Cheating now means faking all three consistently. Frame it as **Physical AI as perception and verification**: models that reason about the phone as a physical body (optics, kinematics, radio) at the edge. It is NOT robotics and NOT a deep model we trained. Say so on the slide.

**Stack.** Client: Vite + React, framer-motion, recharts, a dark "command center" UI, Web Worker for the vision engine, MediaPipe WASM. Backend: FastAPI + SQLModel (SQLite), NumPy, scikit-learn, SHAP. Android: a Trusted Web Activity wrapper (Bubblewrap) opening the same web app in the phone's real Chrome. Demo delivery: one HTTPS address through a tunnel, with a hardened "public mode".

**Capture flow (4 steps):** Photo (in-app camera with a live HUD, burst, steadiness) -> Arrival (the visit/approach recording) -> AI scan (checks run visibly) -> Verdict (accepted / flagged / retake, with reasons).

### Component A: Edge Validator (computer vision)
- A Web Worker runs **7 pixel checks about 5 times a second**: blur, exposure, resolution, lens obstruction, glare, camera shake, noise/compression. Face tasks add a face check.
- **Blur metric:** edge steepness over local contrast per 3x3 tile. We **threw away the textbook Laplacian** after finding it scored a dim copy of the same photo 16x lower (it measures brightness, not focus).
- **Real photos:** blur AUC **0.990**; catches **96 of 98** blurry images; wrongly blocks **1 of 106** good ones. (REAL)
- **Never trust the client:** the server re-runs the same checks in Python (NumPy) from **one shared thresholds.json**. **100% verdict parity (37/37 variants).** If the device's claim and the server's measurement disagree, that mismatch is itself a flag (`client_missed_blur`, `client_verdict_mismatch`). Cost: UI tick **9.4 ms p50** on a laptop; server re-check **~320 ms p50 / 422 ms p95**. (REAL)
- **Liveness:** MediaPipe BlazeFace + FaceLandmarker (blendshapes, head pose from the transformation matrix). The server issues **two random actions** (blink, smile, head turn) plus a **single-use nonce**; the shutter stays locked until they are done; the server replays the timeline in Python.
- **Anti-spoof (screen replay):** FFT moire peaks, bezel/frame detector, flicker banding, landmark planarity (a flat picture moves as one homography; a face does not).
- **Integrity flags:** duplicate and near-duplicate photo, old photo, EXIF checks, `not_live_capture`, photo missing.
- **Burst capture picks the best frame:** 92% vs 20% for a single shot (on a synthetic stream).

### Component B: Sensor Fusion (motion vs GPS)
- While the app is open it records a GPS fix every 5 s and, per 5 s window, **summaries** of accelerometer/gyroscope (never the raw stream), for at most 10 minutes, with explicit consent.
- Server classifies each window as **still / walking / moving**. Walking uses **gait cadence from per-axis autocorrelation in the 1.2 to 2.8 Hz band**.
- Rules: GPS speed with GPS error subtracted, **impossible jumps**, fake-provider fingerprints (no jitter, constant accuracy, ruler-straight path), distance to the registered site, arrival with no approach, ended outside the site, GPS-says-walking-but-phone-still, walking rhythm matching walking speed. **Ten weighted signals combine as a noisy-OR into a 0..1 consistency score.**
- **Real phone (Oppo F19 Pro):** a genuine walk read as walking at **2.3 Hz**. A **mock-location spoof was flagged 100%**: "GPS jumped 22.2 km in 7 s while the phone stayed still". The real phone also exposed a bug the simulator never would: a constant **0.22 m/s^2 offset** made a phone lying on a table read as "moving"; fixed in both the JS and Python ports. (REAL)
- Another lesson: the walking detector was off by 2x because acceleration magnitude is rectified; indoor GPS drift looked like walking in 16 of 18 cases until fixed.
- **Unknown is not suspicious:** no sensor data gives a neutral 0.5 with `fusion_insufficient_evidence`, never a flag. JS and Python fusion ports agree on **13 of 13 cases / 104 values**.

### Component C: Environment Consistency (network geography)
- A web page cannot read WiFi names or cell towers, so we use the request IP's country, region and operator (DB-IP database), hosting/VPN detection, time zone, plus a **per-site network fingerprint learned only from trusted visits** (accepted AND motion consistency >= 0.8), so a spoofer cannot teach the system their own network.
- **Real test, same phone, same walk:** home WiFi in Bengaluru, ~10 km from the site: **score 1.0**. Through a **UK VPN**: London, data-centre network, **8,044 km** away: **score 0.21, flagged**: "The network is in GB, the site is in IN." (REAL)
- Honesty: IP geolocation is coarse (Cloudflare 1.1.1.1 resolves to Sydney in our database; a carrier-NAT address was misclassified as public until fixed), so the distance rule is lenient and a same-country VPN is not an accusation.

### The decision layer
- Inputs: `[photo_quality, motion_consistency, environment_consistency, motion_known, env_known]`.
- Model: `HistGradientBoostingClassifier` (depth 3, 150 iterations, lr 0.1) with **monotone constraints** `[-1,-1,-1,0,0]` plus a runtime guard: **a worse photo, motion or network score can never lower the fraud probability**. We caught our own earlier model violating this (a foreign VPN scored *safer* at env 0.17 than at 0.24), probed it, fixed the labels, constrained the trees and added the guard.
- **SHAP** per submission gives the three bars, and the engines write a plain sentence ("GPS jumped 14.0 km in 6 s while the phone stayed still"). Flagged if p > 0.5; "No issues detected" below p = 0.3.
- **Human in the loop:** every flag goes to a review queue (approve / reject / retake). Decisions become the first real labels; retraining is gated at >= 200 reviewed cases and >= 50 per class.
- **Simulated accuracy (SYNTHETIC, always say "simulated"):** in-distribution **94% recall / 3% honest flagged / AUC 0.98**; in a deliberately **shifted world 80% / 5% / AUC 0.92**. The simulator is physics-based (AR(1) GPS noise, 25-50 Hz raw IMU, gait models, 24+ scenarios, an IP-database error model).

### Engineering and security
- **Tests:** 281 client unit tests, 525 backend tests, **361 end-to-end checks across 32 scenarios** in real headless Chrome with a fake camera against an isolated backend (including replay attacks); JS<->Python parity suites; thousands of simulated trails.
- **Public mode** refuses to start unless a dashboard token, trusted-proxy header, DB path, model and IP database are set; no /docs; exact-origin CORS; request-size caps; security headers (Permissions-Policy limited to this origin); logs without IPs or tokens. A preflight script gives a green/red table. Rehearsal: `npm run e2e:public`.
- **Privacy:** consent before recording, summaries not raw streams, coordinates retained 30 days by default, a purge tool, token-protected dashboard.
- **A bug we could not root-cause:** a "good photo refused" report on a device. We shipped a diagnostic and wrote down that it was not solved. (Credibility slide material.)

### Impact (illustrative arithmetic, NOT a measurement; label the assumptions on the slide)
Per **1,00,000 submissions**, assuming **3% bad evidence**, **Rs 200 per task**, **Rs 10 per human review**, using the simulated shifted-world numbers (80% caught, 5% of honest workers sent to review):
- Bad payouts stopped: 2,400 = **Rs 4.8 lakh**. Review effort: 7,250 reviews = **Rs 72,500**. **Net about Rs 4 lakh per lakh submissions.**
- **Break-even precision = review cost / task value = 5%.** If real recall is half and honest flags are 8%, it is still net positive at about Rs 1.5 lakh.
- Reviewers see about 7% of volume instead of sampling blindly.

### Limits (put these on a slide, confidently)
Every classifier accuracy figure is simulated. One real phone only. No real liveness-spoof samples and no fairness slices across skin tones yet. A modified client or an emulator can inject realistic sensor streams (we raise the cost of cheating, we do not make it impossible). No background tracking (the trail covers only the time the app is open). The web cannot read WiFi/cell identifiers. Honest workers can be flagged in awkward cases (a smooth highway ride, indoor GPS, a VPN, a carrier IP resolving far away). Photo thresholds were tuned on synthetic degradations of a few real photos.
**Next:** record real traces and recalibrate; native Android plugin for WiFi/cell fingerprints and the mock-provider flag; real liveness and fairness test sets; retrain on reviewer labels; optionally a small CNN beside the interpretable features.

**What is NOT in the product (state it, it builds trust):** no LLM or generative model in the shipped pipeline; no face recognition or identity matching; no deep model we trained ourselves (the deep models are MediaPipe's pretrained ones); no real-fraud training data.

## 2. Slide plan (about 17 main slides + 3 appendix; adjust, but keep the story)

1. **Title:** "Trust Layer: verifying proof-of-work against the physical world". Subtitle and team/event placeholder.
2. **The problem:** the weak three (photo, location, identity) with 2 or 3 hard numbers (90 seconds to spoof, 7.7M -> 23.5M gig workers).
3. **The insight:** "Don't ask the phone if it's honest; check it against physics." The three channels as one visual (diagram D2).
4. **System architecture** (diagram D1), with a one-line caption per layer.
5. **The capture-to-verdict journey:** the 4 steps with UI screenshots (images I will provide).
6. **Edge Validator: pipeline and parity** (diagram D3). Callouts: 7 checks at ~5 Hz, 9.4 ms, shared thresholds, 100% parity, server never trusts the phone.
7. **Edge Validator: the engineering story:** the Laplacian we threw away (16x), then the real-photo result (AUC 0.990, 96/98, 1/106) as a native chart.
8. **Liveness and anti-spoof** (diagram D4): random challenge + nonce, moire/bezel/planarity.
9. **Sensor Fusion: the physics** (diagram D5): GPS trail vs IMU windows, gait 1.2 to 2.8 Hz, noisy-OR of 10 signals.
10. **Real phone proof:** genuine walk vs mock-location spoof side by side (images/chart), the 22.2 km in 7 s sentence, and the 0.22 m/s^2 bug the real phone found.
11. **Environment Consistency** (diagram D6): IP -> DB-IP, VPN detection, trusted-visit-only learning (attack-resistant by design). Bengaluru 1.0 vs UK VPN 0.21 with 8,044 km.
12. **Decision layer** (diagram D7): 5 inputs, monotone constraints, why monotone matters, the bug we caught in ourselves, SHAP sentence on a real case-file screenshot.
13. **Human-in-the-loop flywheel** (diagram D8): flags -> reviewers -> labels -> retrain, with the >= 200 / >= 50 gate.
14. **Threat model:** attack vs which channel catches it vs residual risk (diagram D10, or a native table). Be candid about replay of real motion on a frozen fake location.
15. **Testing and what fought back** (diagram D11 pyramid + a "bugs we found" list).
16. **Impact model:** a native bar chart of the per-1,00,000 arithmetic, with assumptions in a footnote and the 5% break-even.
17. **Honest limits and roadmap** (diagram D13): two columns, "Not proven yet" and "Next".
18. **Close:** one sentence: "Light, motion and network: three physical channels, one explainable verdict. Cheating now means faking all three consistently." Plus the demo/QR placeholder.
- **Appendix A:** deployment path (diagram D12: laptop -> tunnel -> HTTPS -> Android TWA).
- **Appendix B:** "Where is the AI?" the table of technique / class of AI / where it runs (classical CV vs pretrained deep vs classical ML vs signal processing), plus the "what is NOT in the product" list.
- **Appendix C:** every number with its source and a REAL / SYNTHETIC tag (12-row table).

## 3. Rules for content quality

- Each slide has **one claim as its title** (a full sentence stating the takeaway, e.g. "A spoofer can fake coordinates but not where their connection enters the internet"), not a topic label.
- Maximum about 25 words of body text per slide besides labels; the rest is visual. Prefer a diagram, chart or big-number callout to bullets.
- Use **big-number callouts** for the headline facts (0.990, 100%, 22.2 km, 8,044 km, 9.4 ms).
- **Tag evidence honestly:** a small `REAL` or `SIMULATED` chip next to every metric. Never present a simulated accuracy without the chip.
- Do **not** invent numbers, customers, partners, benchmarks or features. If you need a fact that is not above, put `[TODO: ...]` on the slide and list it in your answer.
- Every slide gets **speaker notes** (60 to 110 words) written as what I should say, with the likely judge question and a one-line answer. The whole talk must fit **10 minutes** (about 35 seconds per main slide); put the 5-minute cut list at the end of your answer.
- Technical credibility cues to weave in: monotone constraints, SHAP, noisy-OR, autocorrelation, FFT moire, homography, parity testing, sim-to-real gap, shifted-distribution test, break-even analysis.

## 4. Visual design

- Match the product's **dark "command center"** look: near-black navy background (#0B1020-ish), off-white text, one accent for "good/verified" (teal or green), one for "flagged" (red/coral), one neutral highlight (electric blue or amber). Same palette across every slide and every diagram.
- Fonts: one geometric sans for headings and a monospace for code, metrics and filenames (for example Inter / JetBrains Mono, with safe fallbacks if the machine lacks them). Minimum body size 16 pt, titles 28 to 36 pt.
- Generous margins, consistent grid, no clip-art, no stock photos, no gradients behind text, no decorative shapes without meaning. Dark backgrounds, so check contrast.
- Use native, editable PowerPoint **charts** (not pictures) for: real-photo blur result, simulated recall in-distribution vs shifted, and the impact bars.
- Diagrams will come as image files named `D1-...png` etc. Place each full-bleed or large and centered, with a short caption. Until I provide them, add a labelled placeholder rectangle with the diagram's name and size.

## 5. Images: ask me for what you need

Before building, give me a **numbered shopping list** of the images you want, one line each with: what it shows, ideal size or orientation, and which slide. At minimum consider:
1. Capture screen with the live camera HUD and 10-segment meters (slide 5/6).
2. The AI-scan step and the Verdict screen, accepted and flagged (slide 5).
3. Dashboard overview and a case file with the SHAP bars and the sentence (slides 12/13).
4. The sensor trail map with the dashed red GPS jump (slide 10).
5. The real Oppo phone photo or screenshot of the genuine walk vs the mock-location spoof (slide 10).
6. Blurry/good photo pair with the blur meter reacting (slide 7).
7. The UK VPN case file: "The network is in GB, the site is in IN." (slide 11).
8. The Android app on the phone (appendix / close).
9. A team photo or logo, if any (title/close).
Then **wait for my images**, and for anything I do not have, leave a clearly marked placeholder and carry on. Crop and place the images I give you with a thin border and a caption; never stretch them.

## 6. Output

1. The `.pptx` (or the code), with speaker notes.
2. The image shopping list and a table of diagram placeholders still unfilled.
3. A list of every `[TODO]` and every claim you were unsure about.
4. The 5-minute cut list (which slides to drop).
5. Five likely judge questions with 2-sentence answers, drawn only from the facts above.
