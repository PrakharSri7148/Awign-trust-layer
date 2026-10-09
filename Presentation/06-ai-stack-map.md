# Where the AI, Computer Vision and Physical AI are in this project

Use this when a judge asks "what AI is in here?". It separates what is deep learning, what is classical ML, and what is signal processing, so you never over-claim.

## The framing (say it in 20 seconds)

> "A field task claims a digital fact: *I was here, and this is what I saw*. We verify it against **physical evidence** the claimant does not fully control: **light** (computer vision on the photo), **motion** (accelerometer and gyroscope against the GPS trajectory) and **radio/network geography** (where the connection really enters the internet). That is Physical AI as perception-and-verification: models that reason about the physical world through sensors, running at the edge, and an explainable classifier on top."

Be ready for: *"Is that really Physical AI?"* Answer: it is perception and verification, not robotics or actuation. The phone is the physical agent we model: kinematics, optics and radio. We do not claim a robot, and we do not claim deep learning where we use signal processing.

## The map

| Layer | Technique | Class of AI | Runs where | Evidence in repo |
|---|---|---|---|---|
| **Computer vision: image quality** | Edge-steepness ÷ contrast per 3×3 tile (blur); orientation anisotropy (shake); luma/crush/clip stats (exposure); halo detection (glare); robust σ + JPEG blockiness (noise); texture-less edge-touching region (lens covered) | Classical CV / signal processing (no training) | On-device (Web Worker) and server (NumPy) | `client/src/lib/photoQuality/`, `backend/photo_quality/` |
| **Computer vision: faces** | MediaPipe **BlazeFace** detection + box/landmark geometry | Deep learning (pretrained, not trained by us) | Browser WASM and server | `face/facecheck.js`, `backend/photo_quality/face.py` |
| **Computer vision: liveness** | MediaPipe **FaceLandmarker**: blendshapes (blink, smile, jaw open) + head pose from the transformation matrix, neutral→active state machine | Deep learning (pretrained) + rule-based state machine | Browser; server replays the timeline in Python | `face/liveness.js`, `backend/photo_quality/liveness.py` |
| **Computer vision: anti-spoof** | FFT moiré peaks, bezel/frame detector, flicker banding, landmark planarity (homography) | Classical CV | Browser + server recompute | `passive/`, `backend/photo_quality/passive.py` |
| **Physical AI: kinematics** | Gait cadence by per-axis autocorrelation (1.2-2.8 Hz), activity rules, GPS speed/jump/mock-provider statistics, rule-weighted noisy-OR consistency score | Signal processing + physics-based rules | Phone records summaries, server judges | `backend/fusion/windows.py`, `geo.py`, `consistency.py` |
| **Physical AI: radio/network geography** | IP → country/region/ASN (DB-IP), hosting/VPN detection, per-site learned link fingerprint (trusted-visit-only learning) | Lookup + online-learned profile | Server | `backend/fusion/environment.py`, `ipctx.py` |
| **Physical AI: simulation** | Physics-based simulator: AR(1) GPS noise, raw 25-50 Hz accelerometer/gyro, gait models, network behaviour, 24+ scenarios, IP-database error model | Synthetic data generation (sim-to-real gap acknowledged) | Offline | `backend/fusion/simulate.py` |
| **Machine learning: decision** | `HistGradientBoostingClassifier` (depth 3, 150 iters, lr 0.1) with **monotone constraints** `[-1,-1,-1,0,0]` on `[photo, motion, environment, motion_known, env_known]` + runtime monotone guard | Classical ML | Server | `backend/classifier.py`, `train_classifier.py` |
| **Explainable AI** | SHAP per submission → three signal-family bars + a sentence written by the engines | XAI | Server | dashboard case file |
| **Human-in-the-loop** | Review queue → `review` table → labelled dataset (guarded at ≥ 200 reviewed, ≥ 50 per class) | Active labelling pipeline | Dashboard | `backend/reviews.py`, `reviewed_dataset.py` |

## What is NOT in the project (say it before they ask)

- No LLM or generative model runs inside the product. (The system was built with AI-assisted engineering; the shipped pipeline is the table above.)
- No face recognition or identity matching. The face check says "a clear, live face is there", not "who".
- No deep model we trained ourselves. The deep models are MediaPipe's pretrained BlazeFace and FaceLandmarker.
- No real-fraud training data. The classifier learned from a physics-based simulator, and every classifier accuracy figure is labelled SYNTHETIC.

## Why this design is defensible

1. **Edge AI**: instant feedback, works on weak networks, the photo never has to leave the phone to be rejected.
2. **Explainability**: every refusal or flag carries numbers and a sentence a worker or reviewer can understand (SHAP + measured values).
3. **Monotone by construction**: worse evidence can never lower P(fraud): auditable behaviour.
4. **Never trust the client**: every device check is recomputed on the server; mismatches are themselves flags.
5. **Unknown is not suspicious**: missing sensors lower the evidence, not the worker's score.
6. **Defence in depth across physical channels**: light, motion and network fail in different ways; an attacker has to fake all three consistently.

## Next steps for the AI (honest roadmap)

| Step | Why | Needs |
|---|---|---|
| Record real traces (`?record=1`) and recalibrate `fusion.json` | Replace simulator assumptions with measurements | Labelled real phone traces |
| Real worker-camera photo sets (good/blurry/dark/glare/covered, good selfies, live and spoof samples) | Real recall, APCER/BPCER, fairness slices | Samples in `edge-validator/samples/` |
| Native Android plugin: WiFi/cell fingerprint + mock-provider flag | The strongest network and location evidence the web cannot read | Owner's go-ahead |
| Learn from reviewer labels | Move the classifier from SYNTHETIC to REAL labels | ≥ 200 reviewed cases, ≥ 50 per class |
| Optional learned quality model (small CNN) beside the interpretable features | Higher recall on subtle shake/noise | Real labelled captures |
