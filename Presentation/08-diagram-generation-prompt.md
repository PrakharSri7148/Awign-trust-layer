# Prompt 2: generate the diagrams for the deck

Copy everything below the line into Claude. It produces 13 diagrams as SVG + PNG that you drop into the deck built by `07-ppt-generation-prompt.md` (the file names match the slide plan there). Check the result against the project's records before presenting.

---

You are a senior systems architect and a technical illustrator. Produce **13 presentation-grade diagrams** for a hackathon deck about **Trust Layer**, a system that verifies gig-worker field submissions (photo + location + identity) against three physical channels. The audience is technical judges, so each diagram must show the **real mechanism** (components, data, direction of flow, where trust is and is not placed), not a decorative box-and-arrow picture.

## Deliverables and format

- For each diagram: a standalone **SVG** (hand-authored, no external fonts or images) and a **PNG at 1920x1080** with a **transparent or #0B1020 background** (render the SVG; if you can run code, use `cairosvg`, `rsvg-convert` or headless Chrome; if you cannot render, give the SVG only, and a Mermaid version as a fallback).
- File names exactly: `D1-architecture`, `D2-three-channels`, `D3-edge-validator`, `D4-liveness-antispoof`, `D5-sensor-fusion`, `D6-environment`, `D7-decision-layer`, `D8-review-flywheel`, `D9-submission-sequence`, `D10-threat-model`, `D11-test-pyramid`, `D12-deployment`, `D13-roadmap`.
- **Open each PNG and inspect it yourself.** Fix text that overflows or is cut off, overlapping boxes, arrows that cross boxes, tiny text and low contrast. Re-render until clean. Then give me a contact sheet (one image with all 13 thumbnails) so I can review fast.

## Visual system (identical across all 13)

- Canvas 1920x1080, safe margin 80 px. Background #0B1020. Panels #141B33 with a 1 px #2A3560 stroke, corner radius 12.
- Text: #E8ECF8 primary, #8F9BC4 secondary. **Teal #2EE6A8 = trusted / pass / verified.** **Coral #FF5C7A = spoofed / flagged / attack.** **Electric blue #4C8DFF = data/flow.** Amber #FFB84D = learned or adaptive state / caution. Use these meanings consistently; add a small legend in the corner when more than two colours appear.
- Fonts: `Inter, "Helvetica Neue", Arial, sans-serif` for labels (min **22 px**, titles 40 px), `"JetBrains Mono", "SF Mono", Menlo, monospace` for field names, metrics and file names (min 20 px).
- Strokes 3 px for primary flow, 2 px for secondary. Arrowheads on every connector. Orthogonal or smoothly curved connectors, no crossings where avoidable (if unavoidable, use a small bridge hop).
- Each diagram has a **title that is a claim** (top left), at most **~60 words of text in total**, and one **"so what" caption line** at the bottom in secondary colour.
- Mark the **trust boundary** (phone = untrusted, server = trusted) with a dashed amber line wherever both appear, and label the sides "untrusted: the claimant controls this" and "trusted: we re-check everything".
- Where a number is shown, add a small chip `REAL` (teal outline) or `SIMULATED` (amber outline).

## The diagrams (content is the ground truth; do not add components that are not listed)

**D1-architecture: "A phone proposes, the server decides."**
Left, in an *untrusted* zone: Worker's phone (Android app = Trusted Web Activity opening the React web app in Chrome) containing: Capture UI (4 steps), Edge Validator (Web Worker, 7 checks, MediaPipe WASM), Visit Recorder (GPS every 5 s + 5 s IMU summaries, consent-gated). Arrow "multipart: photo + JSON payload (gps, trail, motion, network, device verdict)" to the right, in the *trusted* zone: FastAPI backend with four modules: Photo re-check (NumPy, same thresholds.json), Sensor Fusion engine, Environment engine (DB-IP: country/region/ASN, VPN/hosting; per-site fingerprint), and a Classifier (monotone HistGradientBoosting + SHAP). Below: SQLite (submissions, visits, sites, reviews, photos). Right: Reviewer dashboard (live feed, case file, review queue) fed from the DB. Include the `POST /visits` session handshake and "server clock owns the visit".

**D2-three-channels: "Three physical channels, one explainable verdict."**
Three columns converging into one verdict card. LIGHT (computer vision, the photo, on device + server), MOTION (accelerometer + gyroscope vs GPS trajectory), NETWORK (where the connection enters the internet). Under each, one example lie it catches: "blurry/reused/screen photo", "GPS jumped 22.2 km in 7 s while the phone stayed still", "network in GB, site in IN". Converging into: "p(fraud) + SHAP sentence". Caption: "Cheating means faking all three consistently."

**D3-edge-validator: "The same checks run on the phone and on the server, from one file."**
Top lane (phone): camera frame -> Web Worker -> 7 checks (blur, exposure, resolution, lens obstruction, glare, shake, noise/compression) + face (BlazeFace) -> live HUD meters -> shutter unlocks only on pass -> upload. Bottom lane (server): decode photo -> the same 7 checks in NumPy (+ face optional) -> server verdict (the one the classifier uses) -> integrity flags (client_missed_<check>, client_verdict_mismatch, duplicate/near-duplicate, old_photo, not_live_capture). Between the lanes, a centred shared node `thresholds.json` with arrows into both lanes, and a chip "100% verdict parity, 37/37". Annotate the blur node: "edge steepness / local contrast per 3x3 tile (not Laplacian)". Chips: 9.4 ms p50 (phone), ~320 ms p50 (server), both REAL.

**D4-liveness-antispoof: "A live face has to answer a question a photo cannot."**
A sequence diagram with three lifelines: Server, Phone (FaceLandmarker), Worker. Steps: server issues challenge (2 random actions from blink / smile / head turn + single-use nonce) -> phone shows the prompt -> worker performs actions -> phone records the blendshape/head-pose timeline (neutral -> active state machine) -> shutter unlocks -> upload photo + timeline + nonce -> server replays the timeline in Python, burns the nonce, answers pass/fail. Beside it, a panel "Screen-replay detectors": FFT moire peaks, bezel/frame detector, flicker banding, landmark planarity (a flat picture moves as one homography; a face does not).

**D5-sensor-fusion: "If GPS says you moved 22 km in 7 seconds, did your body accelerate?"**
Two input streams on the left: GPS trail (fix every 5 s, accuracy) and IMU summaries (per 5 s window). Middle: IMU -> window classifier (still / walking / moving; gait cadence via per-axis autocorrelation in the 1.2-2.8 Hz band) and GPS -> speed with error subtracted, jump detector, fake-provider fingerprints (no jitter, constant accuracy, straight line). Join both into a "Cross-check rules" box listing: GPS jump while phone still, GPS walking but phone still, arrival with no approach, ended outside the site, walking rhythm matches walking speed (raises score). Output: noisy-OR of 10 weighted signals -> motion_consistency 0..1 (1 = consistent) and a "no data -> 0.5 neutral, never a flag" side branch. A small inset timeline: GPS trail with a dashed coral jump above, an IMU strip flat below. Chip: "13/13 JS<->Python parity".

**D6-environment: "A spoofer can fake coordinates, not where the connection enters the internet."**
Request -> server reads the client IP (trusted proxy header in public mode) -> DB-IP lookup (country, region, ASN) + hosting/VPN detection + time zone -> compare with the registered site (country, distance; lenient because IP geolocation is coarse). A loop in amber: **per-site learned fingerprint** (link speed class etc.) that updates ONLY from trusted visits (accepted AND motion consistency >= 0.8), with a locked padlock labelled "a spoofer cannot teach us their own network". Output environment_consistency 0..1. Bottom: two example cases side by side: "Home WiFi, Bengaluru, 10 km, score 1.0" (teal) vs "UK VPN, London, data-centre ASN, 8,044 km, score 0.21, flagged" (coral), both REAL. Greyed-out box: "WiFi/cell identifiers: needs a native app (roadmap)".

**D7-decision-layer: "Worse evidence can never lower the fraud probability."**
Five inputs on the left: photo_quality, motion_consistency, environment_consistency, motion_known, env_known. Into a model box "HistGradientBoosting (depth 3, 150 iters, lr 0.1), monotone constraints [-1,-1,-1,0,0]" followed by a "runtime monotone guard". Out: p(fraud) -> threshold: p > 0.5 flagged, p < 0.3 "No issues detected", between = accepted with notes. Parallel branch: SHAP -> three signal-family bars + an engine-written sentence ("GPS jumped 14.0 km in 6 s while the phone stayed still"). A small graph inset: x = environment score, y = fraud probability, a monotonically falling curve with the previous violating bump (0.17 safer than 0.24) crossed out in coral, labelled "caught and fixed". Chips: 94%/3%/AUC 0.98 in-distribution, 80%/5%/AUC 0.92 shifted, both SIMULATED.

**D8-review-flywheel: "Every flag makes the next model less simulated."**
A circular flow: submission -> classifier -> flagged -> review queue -> human decision (approve / reject / retake) -> review table -> labelled dataset (gate: >= 200 reviewed, >= 50 per class) -> retrain (replace simulator labels) -> better classifier -> back to the start. Also show: trusted-visit-only network learning feeding the Environment engine, and the worker retake path. Centre text: "SIMULATED labels today -> REAL labels from reviews".

**D9-submission-sequence: "From tap to verdict, with the server owning the clock."**
Sequence diagram with lifelines Worker/Phone, Backend, Classifier, Reviewer. Steps: Worker consents -> POST /visits (server time, visit_id) -> phone records the trail (<= 10 min) -> in-app camera + HUD + (liveness) -> POST /submissions (multipart: photo + payload incl. visit_id, trail, motion, device verdict) -> backend: photo re-check, fusion, environment -> classifier + SHAP -> response (accepted / flagged, reasons, scores) -> if flagged: queue -> Reviewer decision. Mark "one submission per visit" and "device verdict is advisory".

**D10-threat-model: "Each attack is caught by a different channel; the residual risk is stated."**
A matrix: rows = attacks, columns = Light, Motion, Network, Residual risk. Rows: blurry / covered-lens photo; reused or near-duplicate photo; photo of a screen; mock-location GPS teleport; indoor GPS drift pretending to walk; foreign VPN; same-country VPN; spoofer trying to train the site fingerprint; modified client sending a fake device verdict; replay of real motion on a frozen fake location; emulator injecting realistic sensor streams. Cells: filled teal circle = detects, half = weakens, empty = blind, coral highlight on the rows where residual risk is real ("replay of real motion" and "emulator" = raises cost, not impossible). Use only claims consistent with the facts here.

**D11-test-pyramid: "Five levels of evidence, and the bugs each one found."**
A pyramid, bottom to top: Unit (281 client + 525 backend tests); Parity (JS<->Python: 100% photos, 13/13 fusion cases, 104 values); End-to-end (361 checks, 32 scenarios, headless Chrome + fake camera + isolated backend, incl. replay attacks); Simulation (thousands of trails, plus a shifted world); Real devices (one Oppo phone, a real tunnel, a UK VPN, a mock-location app). To the right, one bug per level: Laplacian measured brightness not focus (16x); walking detector off by 2x (rectified magnitude); indoor drift looked like walking (16/18); carrier-NAT IP counted as public; classifier non-monotone; 0.22 m/s^2 phone offset (found only on the real phone). Add a note on the top: "good-photo-refused: not root-caused, diagnostic shipped".

**D12-deployment: "One HTTPS address, hardened, reachable by judges."**
Laptop (backend in PUBLIC_MODE + built client served from the same origin, SQLite, model, DB-IP) -> tunnel -> public HTTPS domain -> Android Trusted Web Activity (Bubblewrap) and any browser. List public-mode guards as small chips: refuses to start without dashboard token / trusted-proxy header / DB path / model / IP DB; no /docs; exact-origin CORS; request-size caps; security headers; logs without IPs or tokens. Include "preflight.py: green/red table" and "demo-up.sh" as the one-command start.

**D13-roadmap: "What we have not proven, and how we will."**
Two columns joined by arrows. Left "Not proven yet" (amber): classifier accuracy is simulated; one real phone; no liveness-spoof samples; no fairness slices across skin tones; modified client / emulator can inject sensors; web cannot read WiFi/cell; no background tracking. Right "Next" (teal): record real traces (?record=1) and recalibrate fusion.json; real liveness and fairness test sets; native Android plugin (WiFi/cell fingerprint + mock-provider flag); retrain on reviewer labels (>= 200 cases); optional small CNN beside the interpretable features. Each left item has an arrow to the right-hand item that closes it.

## Rules

- No invented numbers, components or integrations. If a diagram seems to need something not given here, leave a `[TODO]` label and tell me.
- Keep label wording close to the text above (judges will see the same words in the speaker notes).
- Prefer clarity over density: if a diagram exceeds the word budget, split the detail into a second panel rather than shrinking the text below the minimum sizes.
- Accessibility: never rely on colour alone; use shape or icon plus a text label for pass vs fail.

## Output

1. The 26 files (13 SVG + 13 PNG) and the contact sheet.
2. A table: diagram -> slide number it belongs to -> one-sentence description of what it should make the judge understand.
3. A list of anything you assumed or left as `[TODO]`.
4. Mermaid source for D1, D5, D7 and D9 as an editable fallback.
