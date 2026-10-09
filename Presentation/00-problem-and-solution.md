# Trust Layer: problem statement and proposed solution

**One line:** a gig worker's proof of work is a photo and a GPS point, and both are cheap to fake. Trust Layer checks the claim *"I was here, and this is what I saw"* against physical evidence the phone produces, using **computer vision** and **Physical AI**, and returns one explainable verdict for a human reviewer.

Labels used below: **R** = measured on real photos or a real phone. **S** = measured on our simulator (a property of the simulator, not of real fraud). **A** = an assumption you replace with your own figure.

---

## 1. Problem statement

### Who is affected
Gig platforms that pay for field work (audits, due diligence, last-mile delivery, site verification) and the honest workers on them. Awign alone reports 1.5 million+ gig partners across 12,000+ pin codes. India's gig workforce is projected to grow from 7.7 million to 23.5 million by 2029-30 (NITI Aayog). These are public figures: cite them as "reported".

### What goes wrong
A task submission claims a digital fact: *this worker was at this place and photographed this thing.* The evidence for that fact is weak:

| Weak point | How it is attacked | Why current checks miss it |
|---|---|---|
| **GPS point** | A free mock-location app moves the phone's position in about 90 seconds (vendor-reported) | The app only reports coordinates, so a faked point looks like a real one |
| **Photo** | Blurry, dark, reused, old, or a photo of a screen or print | A person has to look at each photo, or nobody does |
| **Network** | A VPN or a remote location hides where the worker really is | Nobody compares the network with the claimed place |

### Why the usual answers fail

1. **Manual audit does not scale.** Checking every submission by hand is impossible at millions of workers, so sampling lets fraud through.
2. **A hard rule hurts honest people.** Blocking on one weak signal (indoor GPS, a dark room, a VPN) strands workers who did the job.
3. **"Photo + GPS" validation has a blind spot.** A pure mock-location spoof with a good photo passes it. By construction it catches about 0% of these.
4. **A black-box score is unusable.** A reviewer needs to know *why* a case was flagged, in words.

### The problem, stated precisely
> **How can a platform verify at scale that a field-task submission is genuine, using only a worker's phone, without blocking honest workers and without a black-box score?**

Requirements the answer must meet:

- works from a **web page or an Android app**, no special hardware;
- gives the worker **instant feedback** on a bad photo, even on a weak network;
- treats **missing evidence as neutral, never suspicious**;
- gives a reviewer a **plain-language reason** and keeps a human in the loop;
- **cannot be defeated by editing one input**, such as the GPS coordinates.

---

## 2. Proposed solution

### The idea
Instead of trusting what the phone *says*, check it against three **physical channels** the claimant does not fully control. Faking one is easy. Faking all three consistently is hard.

```
 Worker's phone ──► LIGHT    computer vision on the photo ──────┐
  (camera,          MOTION   accelerometer/gyro vs GPS trail ───┼─► explainable classifier ─► verdict + reason
   sensors,         NETWORK  where the connection really        │     (monotone, SHAP)         │
   network)                  enters the internet ───────────────┘                              ▼
                                                                              human review queue ─► real labels
```

### Where Computer Vision and Physical AI are used

| Channel | What it does | Technique | Class |
|---|---|---|---|
| **Light: Computer Vision** | Checks the photo for blur, shake, exposure, glare, low resolution, covered lens and noise, live on the camera about 5 times a second | Classical computer vision on-device (Web Worker), re-run on the server with the same thresholds | Signal processing, no training |
| **Light: Computer Vision (face)** | For selfie tasks: finds a face and runs a random liveness challenge (blink, smile, head turn) tied to a single-use server nonce | MediaPipe BlazeFace and FaceLandmarker (pretrained deep learning) plus a state machine | Deep learning, pretrained |
| **Light: Computer Vision (anti-spoof)** | Looks for a photo of a screen or print: moiré, bezel, banding, flat landmarks | FFT and geometry | Classical CV |
| **Motion: Physical AI** | Asks a physical question: *if GPS says you moved 22 km in 7 seconds, did your body accelerate?* Detects walking by gait rhythm (1.2-2.8 Hz) and checks it against GPS speed, jumps and the signature of a fake location provider | Kinematics and signal processing on accelerometer and gyroscope | Physics-based rules |
| **Network: Physical AI** | Compares the connection's country, region and operator, and VPN/hosting detection, with the claimed site. Learns a per-site profile from trusted visits only | IP database lookup plus an online-learned fingerprint | Lookup and learned profile |
| **Decision** | Combines the three scores into one fraud probability | Gradient-boosted classifier, **monotone by construction** (worse evidence can never lower the risk), explained per case with **SHAP** | Classical ML, explainable |
| **Human in the loop** | Flagged cases go to a review queue; reviewer decisions become the first real labels | Review table and labelled dataset | Active labelling |

**Physical AI here means perception and verification, not robotics.** The phone is the physical agent: we model its optics, its motion and its radio. We do not claim a robot. We do not claim deep learning where we use signal processing. No generative model runs in the product, and there is no face recognition (the check says a live face is there, not whose).

### What the worker and the reviewer see

- **Worker:** a live camera guide that refuses a bad photo before it is sent, with the numbers and the reason.
- **Reviewer:** a verdict with a sentence the engines wrote from what they measured, for example *"GPS jumped 22.2 km in 7 s while the phone stayed still"* or *"The network is in GB, the site is in IN."* The case file shows the photo, the GPS trail drawn against the phone's motion, and the network checks.

### Design rules that make it safe to deploy

1. **Never trust the client.** Every on-device check is recomputed on the server. A mismatch is itself a flag.
2. **Unknown is not suspicious.** No motion sensor, a declined recording or a new site gives a neutral score, and the worker is never flagged for it.
3. **Flag, don't block, on the fusion signals.** Only a clearly bad photo is refused. Motion and network send a case to review.
4. **Explainable by default.** Every flag carries numbers and a sentence.
5. **Privacy mechanisms exist.** Consent screen, 30-day default retention for coordinates, token-protected dashboard. The wording and retention period are the owner's decision.

---

## 3. Feasibility

### It is built and runs end to end

| Component | Status |
|---|---|
| On-device photo engine (7 checks, live HUD, burst, face, liveness) | Built, tested, ported to Python for the server re-check |
| Sensor fusion (GPS trail vs accelerometer/gyro) | Built (`backend/fusion/`, `client/src/lib/sensorFusion/`) |
| Environment consistency (IP, VPN, per-site learned network) | Built, with a public-mode HTTPS deployment through a tunnel |
| Classifier plus SHAP plus review queue and dashboard | Built |
| Android app | Web app wrapped as a Trusted Web Activity; build steps in `docs/apk-build.md` (APK not yet built) |
| Engineering quality | 281 client tests, 525 backend tests, 361 end-to-end checks passing in real headless Chrome, JavaScript-to-Python parity 13/13 (104 values) **R** |

### Why it is practical to run

- **No new hardware.** It uses the camera, accelerometer, gyroscope, GPS and network the phone already has.
- **Cheap to run.** The server re-check of a photo takes p50 323 ms, p95 422 ms **R**. The live HUD ticks at p50 9.4 ms **R**. Inference needs no GPU.
- **Edge first.** A bad photo is rejected on the phone, so it works on weak networks and sends nothing it does not need to.
- **Same code, web and app.** The Android app opens the same web code, so one codebase serves both.
- **Pretrained models only.** The only deep models are MediaPipe's, so there is no large training pipeline to maintain.

### Evidence that it works

| Claim | Result | Label |
|---|---|---|
| Blurry photos caught on-device | AUC 0.990; 96 of 98 flagged; 1 of 106 good photos wrongly blocked | R |
| Too-dark photos | 31 of 31 caught, AUC 0.997 | R |
| Phone and server agree on the verdict | 100% (37 of 37) | R |
| Fake-location (teleport) spoof on a real phone | Flagged: "GPS jumped 22.2 km in 7 s while the phone stayed still" | R, 1 phone |
| Foreign VPN on a real phone | Flagged: UK exit, 8,044 km from the site, "The network is in GB, the site is in IN" | R, 1 phone |
| Genuine walk and home network | Accepted (Bengaluru, 10 km from the site, environment score 1.0) | R, 1 phone |
| Fusion classifier, in the simulator | Catches 94% of fraud, flags 3% of honest workers, AUC 0.98 | S |
| Fusion classifier, shifted simulator | 80% / 5% / AUC 0.92 | S |
| Motion is the most important signal | Permutation AUC loss 0.272, versus 0.013 for photo alone | S |

The real phone also found a bug the simulator never would (a constant sensor offset made a phone on a table read as moving). It was fixed in both the browser and server code. That is the kind of loop the project is built for.

### Honest limits (so a judge does not find them first)

1. **The classifier is trained on a simulator.** The 94% and 80% are properties of that simulator. Real accuracy needs reviewer-labelled data, and the review queue that produces it is already built.
2. **One real phone, one place, one day.** Mobile-data carrier behaviour was not measured.
3. **No real liveness spoof samples yet.** Face false-reject and fairness across skin tones and lighting are not measured.
4. **A web page cannot read WiFi or cell towers.** Only a native Android plugin can. The server already accepts and scores that input.
5. **A modified client or emulator can inject sensor streams.** An accomplice standing at the site passes the network check. We raise the cost of cheating. We do not make it impossible.
6. **Honest workers can still be flagged** in awkward cases (a smooth highway ride, indoor GPS, a carrier whose IP resolves far away). That is why flagged cases go to a person.

---

## 4. Value

### For the platform

| Value | How |
|---|---|
| **Catches fraud a photo-and-GPS check cannot** | A mock-location spoof with a perfect photo passes a photo-and-GPS check (about 0% caught by construction). In the simulator, removing the motion input drops fraud caught to 28% **S** |
| **Review effort goes where it matters** | A human sees the flagged few, with the reason, instead of sampling at random |
| **Fewer wasted payouts and client escalations** | Bad evidence is stopped before payout |
| **Honest workers are paid faster** | Clean submissions can be accepted with no human touch |
| **Gets better with use** | Every review decision becomes a real label for the next model (retraining unlocks at 200 reviewed cases, 50 per class) |
| **Fraud rings become visible** | Duplicate and near-duplicate photo hashes link repeated submissions |

### For the worker
Instant, specific feedback ("too dark, brightness 12%") before they leave the site, and no penalty when their phone simply lacks a sensor.

### Illustrative impact (arithmetic, not a measurement)

Per **1,00,000 submissions**, assuming **A**: 3% bad-evidence rate, ₹200 per bad task, ₹10 per human review.

| | Shifted-world accuracy (S) | Pessimistic what-if | In-distribution (S) |
|---|---|---|---|
| Recall on bad submissions | 80% | 40% | 94% |
| Honest workers sent to review | 5% | 8% | 3% |
| Total sent to review | 7,250 | 8,960 | 5,730 |
| Bad payouts avoided | ₹4,80,000 | ₹2,40,000 | ₹5,64,000 |
| Review cost | ₹72,500 | ₹89,600 | ₹57,300 |
| **Net per 1,00,000 submissions** | **≈ ₹4.07 lakh** | **≈ ₹1.50 lakh** | **≈ ₹5.07 lakh** |

Formula: `net = recall × bad × task_value − (true flags + false flags) × review_cost`. **Break-even precision is 5%** (₹10 ÷ ₹200). Every column is well above it. Even the pessimistic case, with recall cut to 40%, stays clearly positive. The result scales linearly with the fraud rate: about ₹1.0 lakh per lakh at 1%, about ₹7.1 lakh at 5%. Replace 3%, ₹200 and ₹10 with the platform's own figures. Not counted: the cost of a fraudulent audit reaching a client, and faster payouts for honest workers.

---

## 5. Path to production

| Step | Why | Needs |
|---|---|---|
| Record real traces and recalibrate | Replace simulator assumptions with measurements | Labelled phone traces from workers |
| Real worker-camera photos, live and spoof selfies | Real recall, spoof error rates and fairness slices | Sample sets in `edge-validator/samples/` |
| Native Android plugin (WiFi/cell fingerprint, mock-provider flag) | The strongest location and network evidence a web page cannot read | Owner's go-ahead |
| Pilot with a review queue on, auto-reject off | Build real labels at no risk to honest workers | Reviewers, consent wording, retention decision |
| Retrain on reviewer labels | Move the classifier from SYNTHETIC to REAL | At least 200 reviewed cases, 50 per class |

---

## 6. Summary

| | |
|---|---|
| **Problem** | Proof of work is a photo and a GPS point. Both are forgeable, manual audit cannot scale, and hard rules hurt honest workers. |
| **Solution** | Verify the claim against three physical channels: light (computer vision), motion (Physical AI: kinematics against GPS) and network geography. One monotone, SHAP-explained verdict, then a human review queue. |
| **Feasible** | Built end to end, runs on the phone's own sensors, 525 backend tests and 361 end-to-end checks pass, and a real phone caught a GPS spoof and a foreign VPN. |
| **Valuable** | Catches what photo-and-GPS cannot, focuses review effort, and is net positive on stated assumptions (flag precision 13-49% against a 5% break-even). |
| **Honest** | The classifier is trained on a simulator, only one real phone was tested, and the next step is real labelled data. |
