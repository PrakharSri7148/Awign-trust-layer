# Prompt for starting Iteration 4 (Phase 8) in a new Claude Code chat

Paste everything inside the block below as your first message in a fresh session opened in `/Users/prakharsrivastava/Awign`.

```
You are continuing an existing project: /Users/prakharsrivastava/Awign/trust-layer (a FastAPI backend + Vite/React client that verifies field-task photo submissions). The photo-quality engine ("edge validator") was built over phases 0–7. I want you to implement ITERATION 4 (Phase 8).

READ FIRST, in this order, completely:
1. /Users/prakharsrivastava/Awign/trust-layer/CLAUDE.md
2. edge-validator/README.md
3. edge-validator/progress.md  (especially "Phase 7 — final results" and the 7a–7f sections: what exists, measured numbers, honest limits)
4. edge-validator/iteration-4.md  (THE SPEC: the focus/submit bug first, then finishing the validator end to end; task order 8a→8h, acceptance criteria, what I must provide)
5. edge-validator/iteration-2.md §4–§5 (test-harness recipe and pitfalls) as reference, and edge-validator/iteration-3.md for context.

WHAT TO DO, IN THIS ORDER:
A. THE BUG (do this first, before anything else): "the focus part has a bug: it is not allowing good pictures to submit." Diagnose before changing code. iteration-4.md §1 lists what is known and 8 hypotheses (H1–H8): the face-crop blur check (blocks selfies), whole-frame blur on face-filling frames, video-frame softness, autofocus not settled after the liveness challenge, the burst picking a frame with a different sharpness metric than the check, client/server disagreement, a different check or the 30 s liveness window actually causing the refusal, a warn being treated as a block. Build a diagnostic tool (backend/tools/focus_diagnose.py, plus a plain-words "which check blocked, value vs threshold" message in the Capture UI), reproduce with real captures, rank the hypotheses WITH NUMBERS, then fix only what the evidence supports, with regression tests. Any threshold/logic change must be justified in progress.md with real before/after numbers (good photos blocked vs blurry photos still caught, with confidence intervals), ported to Python, and keep `node tools/parity.mjs` at 100%.
B. THEN FINISH THE VALIDATOR END TO END (iteration-4.md §2): e2e automation (`npm run e2e` on isolated servers), challenge UX/accessibility + alternative challenge set, challenge-request robustness (one nonce per attempt, offline behaviour, idempotent retries), a reviewer workflow in the dashboard that produces the first real labels and feeds the accuracy report, privacy/retention/auth hardening, and the real-sample liveness evaluation/tuning (7f) as far as my samples allow.

HOW TO WORK (hard rules):
- Follow the task order 8a→8h in iteration-4.md §3. Keep ALL suites green at every step. Baseline first and record it: client `cd client && npm test` (expect 178 passing), backend `cd backend && .venv/bin/python -m pytest -q` (expect 103 passed, ~5 min), parity `cd client && node tools/parity.mjs ../edge-validator/samples/good/0001.png` (100%), HUD e2e `client/tools/e2e/hud-e2e.mjs` (expect 202 checks passing; recipe below).
- Update edge-validator/progress.md after EVERY milestone (a "Phase 8" section: checklist, what was built, measured numbers, bugs found, honest limits). Never write results you have not measured.
- CLAUDE.md requires invoking the `edge-validator-ai` subagent after every completed milestone, before starting a new phase, and whenever tests fail twice in a row; if it returns STOP, halt and follow its prompts. It was NOT registered in the last two sessions: try it; if it truly cannot be invoked, say so in progress.md instead of skipping silently.
- Verify by RUNNING things in a real headless Chrome with the fake camera (puppeteer-core, /Applications/Google Chrome.app/Contents/MacOS/Google Chrome). Report failures honestly, including harness artefacts. Look at screenshots, don't only trust DOM assertions (last time a CSS class collision passed every DOM check while the meters were invisible).
- Be honest about limits: the fake camera cannot reproduce real autofocus, real front-camera softness or a real blink; say exactly what was and was not reproduced, and what is real vs synthetic data.

ENVIRONMENT / SAFETY:
- My own dev servers run on ports 8000 (backend, --reload) and 5174 (Vite). Do NOT kill them, POST anything to them, or run `npm install` in client/ while they are up. NOTE: the client's default API base is http://<hostname>:8000, so a Vite you start for testing MUST be started with VITE_API_URL=http://127.0.0.1:8001 pointing at an isolated backend, otherwise your test traffic would hit my real database.
- Isolated backend: `cd backend && TRUST_LAYER_DB=<scratch>/e2e.db PHOTO_DIR=<scratch>/uploads .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001`. Separate Vite on 127.0.0.1:5173 with its own cacheDir outside the repo (a config that merges client/vite.config.js and sets root, cacheDir, server.host/port/strictPort; recipe in iteration-2.md §4). `localhost:5173` on this machine is another project: always use 127.0.0.1. Use puppeteer-core already in client/node_modules; build fake-camera streams with `node tools/e2e/mkstreams.mjs <dir>`.
- Do not wait for background jobs with `pgrep -f <script>` loops (they match themselves); wait on a pid or an output file.
- Do not change existing thresholds in client/src/lib/photoQuality/thresholds.json except where real-sample evidence justifies it (record before/after in progress.md). Keep the JS and Python engines in parity for any logic you touch.
- Real samples are in edge-validator/samples/. I will add: camera_rejected_good/ (photos that looked good but were refused, each with a note of what the screen said, the task and the phone), good_selfies/, live_selfies/, spoof_screen/, spoof_print/, spoof_video/, and real glare/overexposed/lens_covered/noisy photos. Until they exist, build and unit-test with what we have, label the evidence honestly, and mark the work that needs them as pending my samples. Faces are personal data: do not copy sample photos outside the repo or into reports beyond file names.
- ffmpeg is not installed; do not install system software without asking me.
- Do NOT commit or push unless I ask.
- Decisions that are mine (ask me, with a recommendation, instead of silently choosing): dashboard authentication approach, photo retention period, whether a worker may use the alternative challenge set, who the reviewers are.

DEFINITION OF DONE: the focus bug is root-caused with numbers and fixed (or documented as blocked on my refused photos with the diagnostic tool ready), every item in iteration-4.md §2 is done and tested or listed as blocked on me with exactly what is needed, all suites green with the numbers recorded, `npm run e2e` works end to end on isolated servers, the accuracy report regenerated, progress.md and edge-validator/README.md updated, and a short final message listing: what works, what was measured (real vs synthetic), what is still open, and what I need to provide.

Start by reading the five files, run the baseline, then tell me in 5 lines your plan for the focus-bug diagnosis (8a) before coding.
```

## What to prepare while it works (so it is not blocked)

1. **The refused photos (most important).** Create `edge-validator/samples/camera_rejected_good/` and drop in every photo that looked fine but was refused or warned. Add a `notes.txt` with one line per photo: `filename: what the screen said, task (selfie / shelf), phone, front or rear camera`. If you can't find the originals, send screenshots of the Retake screen.
2. **Clear selfies** in `samples/good_selfies/` (40+, different phones and light, with consent).
3. **Spoof/live samples** in `live_selfies/`, `spoof_screen/`, `spoof_print/`, `spoof_video/` (protocol in `samples/README.md`).
4. **Answer the four decisions** when the agent asks: dashboard authentication, photo retention period, alternative challenge set for workers who can't blink/turn, and who the reviewers are.
5. **Keep your own servers (8000, 5174) running as they are.** The agent is told never to touch them.
