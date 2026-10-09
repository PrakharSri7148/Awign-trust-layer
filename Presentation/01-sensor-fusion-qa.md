# Sensor Fusion: 20 judge questions with technical answers

Component: GPS trail vs the phone's own accelerometer/gyroscope (`backend/fusion/`, `client/src/lib/sensorFusion/`). Output: `motion_consistency` in [0,1] + `motion_known` + per-window evidence, fed to the classifier.

Label rule used everywhere: **REAL** = measured on real data or a real device. **SYNTHETIC** = measured on our simulator. Never quote a SYNTHETIC number as real-world accuracy. Where an answer ends with "Caveat", say the caveat out loud: it is what makes the rest credible.

---

**Q1. In one sentence, what does sensor fusion do, and what does it output?**
It checks whether the phone's physical motion (accelerometer + gyroscope, sampled 36-47 Hz on our test phone) is kinematically consistent with the GPS trajectory it claims, and outputs `motion_consistency` (1 = consistent, low = sensors contradict GPS), a `motion_known` flag (false when nothing could be compared) and a per-5-second evidence timeline. It never decides alone: those two numbers are inputs 2 and 4 of a 5-feature monotone gradient-boosting classifier, which produces P(fraud) and a SHAP explanation.

**Q2. What attack are you actually defending against?**
Location spoofing with an Android mock-location provider: ~90 seconds of setup, free apps with tens of millions of downloads. The OS reports a fake coordinate as if it were a real fix, so GPS-only geofencing and "photo + GPS" proof both pass. The defence works on a **physical invariant the spoofing app does not control**: if your position changes by 14 km in 6 seconds, your body must have accelerated; the IMU sits below the location API and keeps telling the truth. We compare the two layers.

**Q3. How do you turn raw IMU data into "still / walking / moving"? Is that ML?**
Rule-based, deliberately (explainable, no labelled gait data needed). Per 5 s window we compute: `acc_rms` (RMS of acceleration **around the window's own mean**), `gyro_rms`, and a **cadence** from the autocorrelation of the gravity-free acceleration, resampled to 25 Hz, **summed per axis** over lags corresponding to 1.2-2.8 Hz. Rules: *still* = acc_rms < 0.15 m/s² and gyro < 8 °/s; *walking* = cadence strength ≥ 0.35 inside 1.2-2.8 Hz and acc_rms ≥ 0.6; otherwise *moving* (energy without a gait rhythm: vehicle, running, handling). Cadence is only judged if the sensor rate is ≥ 20 Hz, otherwise the window is "unknown", never "still".

**Q4. Why autocorrelation summed per axis and not on the acceleration magnitude?**
Real bug we hit in design: the magnitude of a gravity-free vector is rectified, so a 2 Hz step appears at 4 Hz, outside the walking band, and the detector would call a walker "moving". Summing per-axis autocorrelations is orientation-invariant (pocket, hand, bag) and keeps the fundamental. There is a unit test that rotates the axes and asserts the same cadence.

**Q5. Your phone test found a bug. What was it?**
REAL: on the Oppo F19 Pro (ColorOS, Chrome 148) a phone lying on a table read `moving`. Its "gravity-free" acceleration has a constant ~0.22 m/s² offset at rest (gyro 0.0), and `acc_rms` was the RMS of the magnitude, so the offset exceeded the 0.15 "still" limit. In the spoof test that would have meant "phone moved" and the teleport would not have been called "phone still". Fix: measure variation around the window mean (offset removed), in both ports (JS and Python), with tests (offset only → still; real shake on top of an offset still counts). Re-measured on the phone: table = `still`. Thresholds unchanged; parity 13/13.

**Q6. How do you detect a GPS "teleport" without false-flagging fast drives?**
`geo.py`: speed is computed with the GPS error subtracted (`errorAllowanceFactor` 2 × reported accuracy; fixes worse than 50 m are kept but marked unreliable and ignored by the rules). A **jump** = implied speed > 55 m/s or > 1,000 m within 60 s. The 55 m/s ceiling was chosen from a sweep: at a 10 m/s ceiling the rule would call 80% of simulated tunnel drives and 100% of highway drives "jumps"; from 25 m/s up none, while teleports are caught 100% at every ceiling. A jump is then judged **with context**: IMU activity within ±10 s; if ≤ 25% of that block shows movement it is `gps_jump_flat_motion` (weight 0.7), unverified `0.35`, with motion `0.1`.

**Q7. What other rules feed the score, and how are they combined?**
Ten weighted signals (all in `fusion.json`, shared by browser and server): jump + flat motion 0.7; GPS says walking but IMU flat 0.6; arrival with no approach 0.4; ended outside site radius 0.3; "too-perfect GPS" (zero jitter / constant accuracy / ruler-straight path) 0.2; speed-reported vs speed-implied mismatch 0.15; client windows vs raw snippet mismatch 0.3; energy while still 0.1; plus a rhythm bonus when walking cadence matches walking speed. Penalties combine as a **noisy-OR** (1 − Π(1 − pᵢ)), so several weak signals add up and can never exceed 1. Base score 0.9 (+0.1 rhythm bonus).

**Q8. How do you detect a fake GPS provider itself?**
By its statistics, since the mock flag is not readable from a web page: ≥ 6 fixes over ≥ 30 s with position std ≤ 0.5 m, ≥ 90% of fixes sharing the same reported accuracy, GPS-grade accuracy (≤ 15 m, i.e. claiming to be real GPS), and a path with ≥ 200 m of straight-line travel and residual ≤ 1 m (ruler-straight). Real GPS has AR(1)-correlated jitter; scripted paths do not. It is a weak signal (weight 0.2), by design.

**Q9. Can a spoofer fake the IMU too?**
A modified client or emulator that injects realistic sensor streams can. We raise the cost, not make it impossible: (a) the server owns the clock: a visit is opened by `POST /visits`, times are checked against the **server** clock and the visit, a trail from before the visit existed, from the future, or reused is rejected (`trail_replayed`/`trail_invalid`), one trail per visit, exact-replay hash; (b) the client also sends a raw 3 s snippet and the server recomputes features, flagging a mismatch if client and raw RMS differ by > 3× and > 0.5 m/s²; (c) replayed real motion on a frozen fake location is caught only through the "too-perfect GPS" sign (SYNTHETIC: 70-72%). Caveat: stated in the README.

**Q10. How did you train the classifier without real fraud data?**
We built a physics-based simulator (`simulate.py`): AR(1) GPS noise, raw 25-50 Hz accelerometer/gyro streams with gait models, 24+ scenarios (genuine walks/drives/stationary/pocket, "hard genuine" traps, spoofs). It pushes raw streams through the **real** detectors and holds no thresholds or weights (a test asserts this; another asserts changing a weight moves the output). ~2.4k rows, labelled by scenario. Everything it yields is **SYNTHETIC** and labelled that way in the accuracy report.

**Q11. What are the accuracy numbers, honestly?**
SYNTHETIC (report §5b, threshold 0.5): in-distribution split recall 94% (CI 91-97%), 3% honest flagged, AUC 0.984; fresh random draw 94% / 4% / AUC 0.979; **shifted world** (different GPS noise, cadence, sample rate, IP error) 80% / 5% / AUC 0.919. The drop from 94% to 80% is the honest measure of how fragile simulator-trained models are. REAL accuracy: **not evaluated**, because no labelled real traces exist yet.

**Q12. Which input matters most?**
Permutation importance on the deployed model (shifted world, base AUC 0.919): motion_score −0.272, ambient_score −0.158, motion_known −0.083, photo −0.013. Earlier ablation (iteration 1): removing motion drops AUC to 0.612 and fraud caught to 28%, vs 0.931 with all inputs. So motion consistency carries most of the discriminative load; the photo score is mostly for photo fraud, not location fraud.

**Q13. What is the weakest spot?**
SYNTHETIC findings from the report: a good spoofing app (realistic noisy path, phone on a table) is missed ~25% in the normal world and ~72% in the noisy-GPS world (noisy GPS leaves too little evidence that GPS says "walking"); replayed motion on a frozen location is caught 70-72%; honest quiet tunnel/highway rides are the main false-positive risk (one simulated scenario fell from 44% to 19% false flags after fixing a double-counting bug). We list these in the README and the report's "weakest areas".

**Q14. Why not flag workers whose sensors are missing?**
**Unknown is not suspicious.** No sensor (desktop), declined recording, short trail, or new site → score is the neutral 0.5, `motion_known = false`, note `fusion_insufficient_evidence`. The model is trained with such rows so it does not penalise absence. Otherwise a privacy-conscious or old-phone worker would be punished for missing data, a fairness failure.

**Q15. Why a monotone gradient-boosted tree and not a neural net?**
Five tabular features, ~2.4k simulated rows: trees win on small tabular data. `HistGradientBoostingClassifier` (depth 3, 150 iterations, lr 0.1) with `monotonic_cst = [−1, −1, −1, 0, 0]`: a worse photo, motion or environment score can **never** lower P(fraud). A post-hoc guard in `classifier.py` re-enforces it. This matters in an audit: "why did the score go down when the evidence got worse?" cannot happen. SHAP then attributes each decision to the three signal families.

**Q16. How is the decision explained to a human reviewer?**
`top_reason` is a sentence written by the fusion engine from what it measured ("GPS jumped 14.0 km in 6 s while the phone stayed still"), never invented. The case file draws the trail locally (no map service) with the site radius, dashed red jump segments, and a timeline of GPS speed vs phone activity with mismatched windows outlined. SHAP |value| bars are normalised to sum to 1. If SHAP's additivity check fails the score still returns and is marked `explanation: approximate`.

**Q17. What did you verify on a real phone, and what is only simulated?**
REAL (Oppo F19 Pro, Android 13, Chrome 148, home WiFi): GPS ±14-20 m indoors, ±8-10 m outdoors; IMU delivered with no prompt at 36-47 Hz; wake lock held; clock offset +1.3 s corrected; walking read `walking` at 2.3 Hz, strength ~0.45 (cut-off 0.35, a small margin); standing `still`; a hard rhythmic shake read `walking` (a known limit: sensors alone cannot tell shaking from steps). The genuine walk, mock-location spoof and not-at-site tests behaved as expected per the tester's report. One phone, one place, one day: a functional test, not an accuracy measurement.

**Q18. What are the privacy implications of recording motion and location?**
We send **summaries**, never the raw stream: one 5 s window of RMS/cadence features and a fix every ~5 s, max 10 minutes, ≤ 256 KB. Recording only starts after explicit consent (draft wording, owner to approve); only a shortened IP is stored; `purge_trails.py` removes coordinates after the retention period (default 30 days, dry-run by default); dashboard access needs a token. Location history is personal data and those decisions belong to the platform owner.

**Q19. Does the same code run in the browser and on the server? How do you keep them equal?**
Yes: one `fusion.json` (thresholds) read by both; `windows.js` ↔ `windows.py` are line-for-line ports; `npm run fusion:parity` runs 13 cases (104 values) through both and asserts agreement: 13/13. The server is the authority; the client numbers are only for the live UI.

**Q20. Where is the AI, and is this really "Physical AI"?**
Be precise. **Physical AI** here means AI that perceives and reasons about the physical world through sensors: the system models the phone as a physical body, using kinematics (displacement vs integrated acceleration), gait dynamics (cadence in 1.2-2.8 Hz) and sensor physics (gravity-free offsets, sampling rate limits), then verifies a digital claim ("I am at the site") against physical evidence. It is perception-and-verification, not robotics or actuation. **AI/ML** components: the monotone gradient-boosted classifier + SHAP (trained on physics-simulated trails), and the autocorrelation-based gait detector (signal processing, not deep learning). We do not claim a deep-learning model for gait; rule-based was chosen for explainability and because no labelled traces exist yet. Roadmap: learn the thresholds from recorded real traces (`?record=1` exporter exists) and reviewer labels.
