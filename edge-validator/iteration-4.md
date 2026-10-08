# Edge Validator — Iteration 4: fix the focus/submit bug, then finish the validator end to end

Date: 2026-10-07
Status (2026-10-07): **Phase 8 mostly done; what is left is listed at the end of the "Phase 8" section of [`progress.md`](progress.md)** (8a/8b focus: diagnosed + safe fix, root cause of the user's own refusals still needs their photos or the red-box text; 8c, 8d (except the alternative challenge set), 8e done; 8f mechanisms done, decisions are the user's; 8g blocked on samples). Phases 0–7 are done (Phase 7 except the real-sample liveness evaluation, 7f).
Audience: the engineer / agent who implements it. Read first, in this order: `CLAUDE.md` (project root), `edge-validator/README.md`, `edge-validator/progress.md` (especially "Phase 7 — final results" and the 7a–7f sections), then this file. Reference: `iteration-2.md` §4–§5 (test-harness recipe and pitfalls), `iteration-3.md` (what Phase 7 set out to do).

## 0. What the user asked for

1. A new iteration-4 plan that **completes the whole edge validator end to end**.
2. **A bug to investigate first:** the **focus part has a bug: good pictures are not being allowed to submit.** Check the focus/blur logic and everything between the camera and the Submit button, and fix it.
3. A ready-to-paste prompt for implementing it (`iteration-4-prompt.md`).

## 1. The focus / "can't submit a good photo" bug

### 1.1 What is already known (verified facts from earlier phases, so you don't re-derive them)

- **Where a photo can be stopped for focus.** (a) The whole-frame `blur` check (`checks/blur.js`: edge steepness per 3×3 tile, 66th-percentile tile, `failBelow 0.16` **blocks**, `warnBelow 0.25` warns). (b) On `face` tasks the **face-crop blur** inside `face/facecheck.js` (`cropBlurFail 0.10` **blocks** when the face is required, `cropBlurWarn 0.16`), measured on the face crop only. (c) The server runs the same checks on the uploaded JPEG and its verdict is the one that counts (`photo_quality/checks/blur.py`, `photo_quality/face.py`). (d) The live HUD "Focus %" and the "Looks good. Tap to capture." state use **coarser live thresholds** (`live.blurBad 0.2`, `blurSoft 0.28`, `focusFull 0.40` at 480 px); they only hint, they do not gate the shutter. A block needs `verdict === 'block'` in `Capture.jsx` (`canSubmit = !!quality && !blocked`).
- **Evidence that something is off.** In the Phase 7 headless-Chrome runs the in-app capture of a **sharp** test portrait (the NASA astronaut image, played through Chrome's fake camera) came back with **"Focus 42% – Photo is slightly soft" (warn)** every time; the server stored the flag `blur`. That image is genuinely sharp, so the check reads a sharp **camera-pipeline** frame as soft. On the 106 real stock "good" photos the blur check blocks 0.9% and warns 4.7%, so the check is fine on large, textured, still photographs. **The problem is specific to camera captures, to faces, or to both**; no real worker/selfie capture has ever been measured (`good_selfies/` does not exist).
- **Known limits written down earlier and never fixed:** the blur score depends on image size and scene (progress.md, Calibration run 1: "blur scores are not comparable between 0.5 MP and 2–4 MP images"); the live check is coarse by design; the burst picks the sharpest frame with a **different** sharpness function (`burst.js`, 480 px) than the check that later judges it; in-app captures are canvas-encoded JPEG q0.95 of a video frame (already H.264/MJPEG-compressed and often 1080p, not a still-sensor photo).

### 1.2 Hypotheses to test (diagnose BEFORE changing anything; rank them by measured evidence)

| # | Hypothesis | How to test |
|---|---|---|
| H1 | **Face-crop blur is too strict for selfies** (smooth skin has little edge energy, so a sharp face scores below 0.10/0.16 and a required face task blocks) | Run `evaluateFace` / `evaluate_face` on the real faces we have (`samples/face_not_visible/` has 4 detectable faces; the astronaut fixture; the user's rejected selfies) and print the crop blur score and the crop size next to the thresholds |
| H2 | **Whole-frame blur on a face-filling frame** fails because few tiles have texture (`minTileRange 20`, 3×3 grid, p66) or the background is smooth (shop wall, sky) | Print `tileScores` and `texturedTiles` for the same photos; compare a selfie with a textured background vs a plain one |
| H3 | **Video-frame softness:** a 1080p video frame (H.264, auto-exposure, rolling shutter) is softer than a still of the same scene; the thresholds were calibrated on stills | Capture the SAME scene with the in-app camera and with the phone's camera app; compare scores |
| H4 | **Autofocus has not settled** when the button is pressed: after the challenge (turn head, smile) the user taps within seconds; the front camera refocuses on movement | Check the burst's sharpness series (`[burst]` console line) and the time between challenge pass and tap |
| H5 | **Burst picks the wrong frame:** `frameSharpness` (480 px) and `blurMetrics` (1280 px) disagree, so the "sharpest" frame is not the one the check likes | For many bursts, score all 8 frames with BOTH functions and compare the ranking |
| H6 | **Client/server disagreement:** the device passes, the server blocks (or the reverse), e.g. different resize/decode (`createImageBitmap` vs Pillow) shifting the blur score near 0.16; shows up as `client_missed_blur` | Re-run saved captures through `tools/parity.mjs`-style comparison and the server |
| H7 | **Submit is blocked by something other than focus** and the focus warning is a red herring: `liveness` (expired / not completed), `face` (small, yaw, dark crop), `exposure`, `resolution`, or the 30 s liveness validity ending while the user reads the checklist | In the UI, show **which check blocked** and why (see §1.3); reproduce with the real captures |
| H8 | **A warn is being treated like a block** somewhere (e.g. the "Submit anyway" path, `photo_override`, or the server flagging `blur` as a block on a `warn`) | Trace `verdict` from `analyzeFrame` → checklist → payload → `process_photo` → `photo_verdict` for a warn-only photo |

### 1.3 Required work (in this order)

1. **Reproduce with real evidence.** Ask the user for the photos that were refused (`samples/camera_rejected_good/`, each with a one-line note of what the screen said and which task). Until they arrive, build a **camera-capture corpus** from what we have and say so honestly. Never calibrate from the synthetic fake-camera stream alone.
2. **A diagnostic tool** `backend/tools/focus_diagnose.py` (and an optional `?debug=checks` panel in the Capture screen): for each image print every check's status and value, the blur tile scores, the face-crop blur and crop size, the verdict, the blocking issue ids, and the server's verdict, so "why was this refused" is one command or one glance. Add the **blocking reason in plain words** to the UI Retake message (name the check, the number and the threshold).
3. **Measure the false-block/false-warn rate on camera captures** (the number that matters), with Wilson intervals, per task type (shelf, selfie), per camera (front/rear) where the data allows. Put it in the accuracy report as a REAL table.
4. **Fix the cause the evidence points to** (do not guess; one fix per confirmed hypothesis, each with a regression test that encodes the failure):
   - likely candidates: measure face-crop blur **relative to the crop's own contrast and size** (and drop to warn-only when the whole-frame blur passes); compute blur for camera frames at a scale and with a texture-aware tile rule that does not punish smooth backgrounds; make the burst rank frames with the **same** metric the check uses; wait for autofocus (e.g. require N steady, in-focus live frames after the challenge before enabling the shutter, or take the burst slightly later); give a worker a way to retry cheaply instead of a hard block when the score is only just below the line (a "marginal" band that warns, with "Submit anyway" recorded).
   - any change to `blur`, `exposure`, `face` thresholds or logic must (a) be justified in `progress.md` with the real-sample numbers before/after (good blocked, blurry caught), (b) be ported to Python and keep `node tools/parity.mjs` at 100%, (c) keep the real **blur recall** (currently 96/98 flagged, 77/98 blocked on the user's real blurry set) from collapsing: report both sides.
5. **Close the loop in tests:** unit tests with fixtures that reproduce the failure (a sharp smooth-skinned face crop; a sharp frame with a plain background; a marginal score), an e2e scenario "a sharp capture is not refused", and the existing blurry-is-blocked scenarios still passing.

### 1.4 Acceptance criteria (focus bug)
1. A written root cause (which hypothesis or hypotheses, with the numbers) in `progress.md`, or an honest "could not reproduce without the user's refused photos" plus the diagnostic tool and what to send.
2. On the user's real refused-good photos (when provided) **≥ 95% pass or warn (not block)** with the fix; on the existing real blurry/shaky sets the **blur-block recall does not drop by more than 3 points** and the false-block rate on `good/` stays ≤ 3%. Both reported with CIs.
3. The UI tells the worker exactly which check blocked and the number vs threshold; no more "photo needs a retake" without a reason.
4. No regression: client 178+, backend 103+, parity 100%, e2e 202+ (plus the new scenarios).

## 2. Finish the whole edge validator end to end

Phase 7 left these gaps (all listed in its honest limits). Close them, or explicitly mark them blocked on the user.

### 2.1 Real-data work (blocked on the user's samples; build the tooling and wait)
- **7f carried over:** with `live_selfies/`, `spoof_screen/`, `spoof_print/`, `spoof_video/` (protocol in `samples/README.md`): run the liveness evaluation, report APCER/BPCER/ACER with CIs, **tune** moiré / bezel / banding / planarity thresholds and weights from that evidence only, and **decide block-vs-flag** for `passive.failAt` and `policy.liveness` using the fairness rule (do not ship blocking defaults without per-slice evidence). Decide on the optional ML PAD model only if the data says the heuristics + challenge are not enough (verify licence, size, accuracy yourself).
- **`good_selfies/`:** measure the face check's false-reject rate on clear faces (still unknown); tune `face` thresholds only from it.
- **Real glare, over-exposed, lens-covered and noisy photos** to replace the synthetic-only validation of those four checks.
- **Tell the user exactly what to capture** (a short checklist in the README), and make `npm run report` the single command that turns new samples into updated numbers.

### 2.2 Product gaps to build now
1. **Challenge UX and accessibility.** Phase 7 only has "Send for review" as the fallback. Add: an alternative challenge set for people who cannot blink or turn (e.g. smile + open mouth only, chosen by the worker via an "I can't do this" control, still verified and flagged `liveness_alt_set`), clearer countdown and success cue, spoken/visual cue option, text that tells the worker what failed (too fast/too slow/face lost), and an e2e for each path. Measure and tune pass time on real captures when available.
2. **Challenge request robustness.** Fix the dev StrictMode double nonce request (one request per attempt; cancel the superseded one); behaviour when the server is unreachable (explicit message and retry vs the current silent local fallback that the server then flags); nonce reuse after a network retry of the same submission (a worker re-sending the same evidence after a lost response must not be treated as a replay of an attacker: define and test the rule, e.g. idempotency key).
3. **Reviewer workflow (the missing end of the pipeline).** Flags such as `liveness_review_requested`, `spoof_suspected`, `duplicate_photo`, `client_missed_*` currently end at a badge. Add a review queue in the dashboard: open a case, see the photo + live-check evidence, record **approve / reject / needs retake** with a reason, store it (new table, reviewer id, timestamp), show it in the case file and the feed. This produces the **first real labels**.
4. **Use real labels.** Wire reviewed outcomes into the accuracy report (a REAL table: how often flagged cases were upheld, per flag type) and add a documented, reproducible path to retrain/evaluate the fraud classifier on reviewed data once there are enough (state a minimum count; until then the classifier stays labelled synthetic). Do not feed liveness/spoof flags into the classifier as features without evidence; keep them as policy.
5. **Privacy and retention for faces (required before real use).** A retention setting (`PHOTO_RETENTION_DAYS`, default documented) with a purge command/job that deletes stored photos and liveness timelines but keeps the verdicts; access control note for photo/evidence endpoints (today `GET /submissions/{id}/photo` and the dashboard have no authentication: add a simple configurable shared-secret or document that a gateway must provide it, and show this decision to the user rather than silently choosing); consent text on the selfie task; do not log image content. Update `samples/README.md` retention guidance.
6. **Hardening and deployment notes.** The camera needs HTTPS (document the `dev:https` path and a production note); lazy-load the liveness and MediaPipe code only for face tasks (check the production bundle sizes and record them); rate limits on `POST /submissions` as well as challenges; `thresholds.json` change log and a version stamp in each report; make sure a missing `mediapipe` on the server degrades to `face_unchecked`/`liveness_unverified` flags and never a crash (test it).
7. **Test automation.** Turn the e2e recipe into one command: `cd client && npm run e2e` that builds the fake-camera streams, starts the **isolated** backend (temp DB/uploads, port 8001) and a separate Vite (127.0.0.1:5173, own cache dir, `VITE_API_URL` pointing at 8001), runs every scenario, prints a summary and tears everything down. It must refuse to run if the API URL is the user's real backend. Keep the labelled-mock rules.
8. **Supervisor.** Check whether `edge-validator-ai` is invocable (it was not registered in the Phase 7 session); if it is, run it after each milestone and record the verdicts; if not, say so in `progress.md`.

### 2.3 Not in scope (unless the user changes it)
Physical-phone testing stays the user's decision. Provide a **manual device test sheet** (what to do on an iPhone and an Android phone and what to write down) in the README so the user can run it, but do not plan agent work around devices.

## 3. Task order (keep every suite green at each step; update `progress.md` after each milestone)

**Baseline first:** client `cd client && npm test` (178), backend `cd backend && .venv/bin/python -m pytest -q` (103, ~5 min), parity `cd client && node tools/parity.mjs ../edge-validator/samples/good/0001.png` (100%), HUD e2e (202 checks; needs the isolated servers, see the prompt). Record them.

- **8a — Focus diagnosis.** Diagnostic tool + blocking-reason UI text; reproduce; rank H1–H8 with numbers; write the root cause (or the honest "need your photos"). Do not change thresholds yet.
- **8b — Focus fix + regression tests + the REAL false-block table in the report.**
- **8c — e2e automation (`npm run e2e`) and the "sharp capture is not refused" scenario.**
- **8d — Challenge UX/accessibility + nonce robustness (2.2.1–2.2.2).**
- **8e — Reviewer workflow + real-label reporting (2.2.3–2.2.4).**
- **8f — Privacy/retention/auth decision + hardening (2.2.5–2.2.6).**
- **8g — Real-sample evaluation and tuning (2.1)**, as far as the user's samples allow; otherwise leave the pipeline ready and list exactly what is missing.
- **8h — Verify + document:** all suites, e2e, updated `progress.md` (a "Phase 8" section with measured numbers, bugs found, honest limits), `README.md`, a refreshed accuracy report, the memory file.

## 4. Definition of done
- Focus bug: root-caused with numbers and fixed, or documented as blocked on the user's refused photos with the tool ready; acceptance criteria 1.4 met.
- Every item in §2 either done and tested, or listed as blocked on the user with exactly what is needed.
- All suites green with the numbers recorded; `npm run e2e` works end to end on isolated servers; the accuracy report regenerated; README and progress.md updated; honest limits written; no commit or push unless the user asks.

## 5. What the user must provide / decide
| Need | Why |
|---|---|
| The photos that were refused although they looked good, in `samples/camera_rejected_good/` with a note of what the screen said and which task and phone | The only way to find the true cause of the focus bug |
| 40+ clear selfies in `samples/good_selfies/` (varied phones, light, glasses/hijab/beard, with consent) | Face false-reject rate and face-crop blur tuning |
| `live_selfies/`, `spoof_screen/`, `spoof_print/`, `spoof_video/` (protocol in `samples/README.md`) | Real liveness numbers and tuning (7f) |
| Real glare / over-exposed / lens-covered / noisy photos | Replace synthetic-only validation |
| Decisions: dashboard authentication approach; photo retention period; whether a worker may skip the active challenge with the alternative set; who the reviewers are | Phase 8e/8f cannot pick these silently |

## 6. Risks to flag honestly in the results
- Fixing "good photos refused" by loosening focus will let more blurry photos through: always report **both** the false-block rate on good photos and the catch rate on blurry ones, on real samples.
- Camera behaviour differs by phone and browser; headless Chrome's fake camera cannot reproduce autofocus or real front-camera softness. Say what was and was not reproduced.
- Faces are personal data: reports list file names only; do not copy sample photos outside the repo.
- The reviewer workflow creates the first real labels but they are only as good as the reviewers; record who reviewed and when.
