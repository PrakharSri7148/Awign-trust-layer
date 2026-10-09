# Edge Validator: 20 judge questions with technical answers

Component: the on-device photo-quality, face and liveness engine (`client/src/lib/photoQuality/`), re-run on the server (`backend/photo_quality/`). It is the computer-vision layer of the project.

Label rule: **REAL** = real photos (note: the `good/` set is stock photography and **no photo is a real worker camera capture yet**). **SYNTHETIC** = generated degradations of real photos, or our simulator. Never quote SYNTHETIC as real-world accuracy.

---

**Q1. What is the edge validator and why run it on the phone?**
A computer-vision gate that decides, before upload, whether a photo is acceptable proof: 7 pixel checks (blur, exposure, resolution, lens obstruction, glare, shake, noise/compression) plus a face check and a liveness check for selfie tasks. On-device means instant feedback while framing (~5 Hz live metrics), no wasted upload on a bad photo in a poor-network area, and no round-trip for the worker. But the device's word is never trusted: the server re-runs the same checks on the stored bytes.

**Q2. Architecture: how is the same logic on both sides?**
Pure-function engine in JS (runs in a **Web Worker**), a line-for-line **Python port** on the server (NumPy + Pillow), and **one shared `thresholds.json`** read by both. A parity tool runs 37 degraded variants of a real photo through both engines: verdict agreement **100% (37/37)**, per-check status agreement 100%; metric differences median 0.0-1.3% (blur 1.3% median / 9.6% max; glare is the loosest: 35% at p90). The server's verdict, not the device's, feeds the classifier.

**Q3. How do you measure blur? Why not the usual Laplacian variance?**
Edge steepness divided by local contrast, minus a noise floor, computed per tile on a 3×3 grid at a 1280 px analysis size, taking the 66th-percentile tile (textureless tiles with range < 20 are "no texture", not "blurry"). We replaced Laplacian variance after testing: it was 16× lower for a *dim copy of the same sharp photo*, and *higher* for blur+noise than for the sharp original. Analysing at 640 px also hid moderate blur, so we moved to 1280.

**Q4. What do the thresholds mean physically and how were they chosen?**
Blur: fail < 0.16, warn < 0.25. A Gaussian-softness sweep on 106 real good photos maps 0.16 ≈ σ 3.7 px and 0.25 ≈ σ 1.9 px at 1280 px; real blurry photos sit at σ 3-4+ px. Chosen on REAL sets: 106 good, 98 blurry, 120 shaky. Result (REAL): blur AUC **0.990** (CI 0.975-1.000); flagged recall 96/98 = 98%; at *block* level recall 77/98 = 78.6% with **1/106 = 0.9%** false blocks. We tested loosening to 0.14: removes the one false block but costs 12 points of recall, so the line stayed.

**Q5. How is camera shake different from blur?**
Shake is *directional* blur. We measure edge steepness per orientation; anisotropy = sharpest ÷ softest orientation (sharp photos 1.0-1.2, defocus ≤ 1.25; warn 1.25, fail 1.6). Live, we add the phone's gyro/accelerometer around the shutter (warn 25 °/s, fail 60 °/s; 1.2/3 m/s²) and the image's own frame-to-frame shift (works where browsers hide the sensors). REAL result, honestly: shake alone recalls **79/120 = 66%** (CI 57-74%), AUC 0.972, 2/106 false flags; it's the check we list as under-detecting.

**Q6. How do exposure, glare, obstruction and noise work?**
Exposure: mean luma (dark fail < 40 / warn < 65; over fail > 235 / warn > 210) plus % crushed (< 25) and clipped (> 245) pixels and p95-p5 range for haze. Glare: a blown-out region with a *soft, surrounding, monotone halo* (≥ 10 grey levels), 1%/4% of frame; we re-derived it after finding our first version "worked" only because a synthetic edge was grid-aligned. Obstruction: flat, dark-or-finger-coloured area touching the frame edge (warn 10%, fail 35%, full cover 85%); finger-hue window narrowed to 32° from real data. Noise: robust σ on **native-resolution** patches (warn 5 / fail 10 grey levels) plus JPEG 8×8 blockiness (gradient ratio 1.15/1.45). Resolution: native pixels, not the downscaled analysis size.

**Q7. What did the live camera add beyond checking after capture?**
A burst: 8 frames kept, the sharpest chosen. On an adversarial stream (sharp frames hidden among soft ones) the burst picked the sharp frame **92% of the time vs 20% for a single shot** (SYNTHETIC stream). Live HUD: overall quality + Brightness, Focus, Lens, Glare, Steadiness, Noise, Resolution, Face as 10-segment meters at ~5 Hz, with EMA smoothing (0.4) and 2-tick hysteresis so labels don't flicker.

**Q8. Is it fast enough on a phone? What did you measure?**
Moving per-tick pixel work into a **Web Worker** cut UI-thread stalls from ~300 ms to ~17 ms (Phase 4). In the full HUD run (headless Chrome, this laptop): UI-thread tick p50 **9.4 ms**, p95 **13.7 ms** (15.3 ms with the face mesh). Server side, single process, 30 REAL photos at median 2.8 MP: end-to-end 7 checks p50 **323 ms**, p95 422 ms (decode 123 ms is the biggest stage). Caveat: no benchmark on low-end physical phones yet.

**Q9. How does the face check work, and what are the AI models?**
MediaPipe **BlazeFace** (on-device WASM; Python port on the server, browser = server on 15/15 cases) returns face boxes and landmarks. The check evaluates: found, confidence (warn 0.7/fail 0.5), face height as % of frame (0.15/0.08), visible fraction (0.95/0.75), yaw (0.35/0.7), roll 25°, crop sharpness and lighting, eyes, extra faces. Face-required tasks block on fail, optional tasks never block. Cropping sharpness alone no longer blocks (it warns) after our focus investigation. Caveat: no `good_selfies/` set, so the false-reject rate on clear faces is unknown.

**Q10. Explain the liveness (anti-spoofing) design.**
Active challenge: the server issues two random actions of different kinds (blink, smile, open mouth, turn head left/right) and a single-use nonce (TTL 180 s). The phone runs MediaPipe **FaceLandmarker** (52 blendshapes + head pose from the transformation matrix) and a state machine that only counts **neutral → active** (→ neutral for a blink), so a face already smiling, held-open eyes, a still photo, or a face leaving and re-entering cannot pass. The **shutter stays disabled** until the live check passes (valid 30 s). After 3 failures the worker may "Send for review" (warning, not block).

**Q11. And the passive screen/print detection?**
Evidence, not verdicts: **moiré** (narrow isolated spectral peaks of a screen's pixel grid, FFT), a large rectangular **bezel/paper-margin frame** containing the face, flicker **banding** drifting between frames, and landmark **planarity** (a flat picture's landmarks move as a single homography, a 3-D face's don't). Combined with a noisy-OR; ≥ 0.45 on a passed challenge becomes a review warning. Moiré thresholds (warn 8 / fail 15) were calibrated on **346 REAL photos** (max 7.1 → 0 false flags). `failAt` is 1.01, i.e. they **only flag, never block**, until real spoof samples exist.

**Q12. How does the server prove the liveness evidence wasn't forged?**
The nonce must be ours, for this worker and task, unexpired and **unused** (atomic claim in the DB). The challenges must equal the issued ones. The device's signal timeline is **replayed through a Python port of the state machine** and must pass the same challenges. Moiré and the frame detector are recomputed on the stored photo. Flags: `liveness_unverified/forged/expired/replayed/mismatch/failed`, `spoof_suspected`. A "Send for review" must be earned (server issued ≥ 3 challenges to that worker/task recently). Idempotent retry: same photo bytes, same worker/task/site re-sending a spent nonce (lost response) is accepted; a different photo or another worker is `liveness_replayed`.

**Q13. What if the attacker modifies the client and skips all this?**
The client report is advisory and the server recomputes everything: `client_missed_<check>` and `client_verdict_mismatch` flags fire when the device's claim and the server's measurement disagree; a missing photo is `photo_missing` and the device's pass boolean is **not trusted**. Integrity flags: SHA-256 `duplicate_photo`, perceptual-hash `near_duplicate_photo`, `old_photo` and `not_live_capture` (EXIF/capture source, weak signals), `capture_burst`. What this does not stop: an **injected virtual camera**, a person performing the liveness actions for the attacker, or a replayed video that happens to match the random challenges. Documented in the README.

**Q14. You mention a "focus bug". What happened and how did you handle it?**
A refusal of good photos was reported. We built `focus_diagnose.py` and a red "Why this photo can't be submitted" box showing values vs limits (e.g. "Focus 19%, needs at least 31%"). Findings (REAL photos): the reproducible "soft astronaut" was a **fixture artefact**: a 250×250 crop stretched 4.3× in the test stream (same pixels score 0.420 native, 0.204 at 4.3×); 24 real good photos through the real in-app capture: **0/24 blocked**, captured/source blur ratio median 1.05; browser vs server same JPEG median 1.8% difference. Root cause on the user's own device was **not established**, and we say so. Safe fix: face-crop sharpness no longer blocks alone; whole-frame thresholds deliberately unchanged. Net: 0 of 88 real blurry/shaky faces lost, 0 good changed.

**Q15. Show me the accuracy table and what it does not show.**
REAL: blur recall 98% (96/98), 0.9% false-block; dark exposure 31/31 caught (AUC 0.997, 4/106 false flags); low resolution 22/23; shake 66%. SYNTHETIC: over-exposed 37/40, lens obstruction 29/40 (72%), glare 40/40, noise 40/40, each with 95% Wilson CIs in `reports/accuracy-report.md`. Not shown: any real worker-camera capture; real overexposed/glare/lens-covered photos (our "overexposed" and "glare" folders turned out not to be real positives; the report reclassifies them as observation-only); liveness APCER/BPCER (SYNTHETIC passive smoke test: worst 35% at weak grid amplitude; no REAL samples); fairness slices. The report ranks its own weakest areas on its first page.

**Q16. Fairness: does face detection work across skin tones and lighting?**
Unknown, and the report says so ("no fairness slice evidence in any section"). All face detectors are not equally accurate across skin tones/lighting, can't see faces below ~15% of frame height, and don't reliably handle masks. Mitigations built: face-required blocks are a policy switch in `thresholds.json` (`policy.face.blockOnFail`), "Send for review" as the escape, and a recommendation to validate on the workers' own population before relying on `required`. Challenges can exclude some people (eye/mobility conditions): an alternative challenge set (smile + mouth only) is designed but needs the owner's decision.

**Q17. How do reviewers close the loop? Where do real labels come from?**
Review queue in the dashboard (fraud-flagged, server-blocked, integrity flags). A reviewer records Approve / Reject / Needs retake with a reason (required unless approving) in a `review` table with history. The accuracy report's §5 then shows, per flag, how often a human upheld it (Wilson CIs). `reviewed_dataset.py` exports a labelled CSV only at ≥ 200 reviewed cases with ≥ 50 per class; below that it refuses, so nobody trains on noise. Reviewer names are self-declared (`REVIEWERS` allowlist): **not authentication**.

**Q18. Privacy and consent for photos and faces?**
Image content is never logged. `PHOTO_RETENTION_DAYS` + `purge_photos.py` (dry-run by default) deletes photos and liveness timelines older than N days but keeps verdicts, flags, scores, hashes and review decisions. `DASHBOARD_TOKEN` gates dashboard/photo endpoints. A one-line consent notice appears on the selfie task (draft wording). Face presence does not identify *who* the person is: no face recognition/identity matching is performed.

**Q19. Test coverage and how it was verified end to end?**
Client unit tests: 281; backend: 525 passed; JS↔Python parity 100%; end-to-end in **real headless Chrome with a fake camera** against an isolated backend (`npm run e2e`): 229 PASS at the end of the photo phase and 361 PASS across 32 scenarios after the environment work (layouts at 3 viewports, liveness, replay attacks, review, fullstack). Honest note: the "camera" is Chrome's fake device and the "live person" in liveness tests is a labelled mock for the blink it cannot perform.

**Q20. Where exactly is the AI and computer vision, and why not one big CNN quality model?**
Computer vision, classical: FFT moiré detection, edge-gradient steepness and anisotropy, halo detection, JPEG blockiness, optical shift between frames. Deep models: MediaPipe **BlazeFace** (detection) and **FaceLandmarker** (3.7 MB task file, loaded only for face tasks; blendshapes + pose). ML on top: the fraud classifier consumes the server-measured `photo_quality_score` (0.5×worst check + 0.5×mean). Why not an end-to-end CNN: (1) we have no labelled worker captures to train one, (2) every refusal must be explainable in numbers to a worker ("Focus 19%, needs 31%"), (3) it must run at ~5 fps on a mid-range phone in a worker thread, (4) a CNN would be an unauditable block on someone's pay. The plan is to learn from reviewer-labelled real captures and keep these interpretable features as the explanation layer.
