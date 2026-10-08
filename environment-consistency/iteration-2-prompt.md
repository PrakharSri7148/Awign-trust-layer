# Environment consistency iteration 2: prompt for a fresh session

Run this only after iteration 1 is finished (E0-E6 ticked in `progress.md`). Paste everything inside the code block into a new Claude Code chat opened at `/Users/prakharsrivastava/Awign/trust-layer`. Give the agent N1 (tunnel choice and domain) if you have it.

```
You are implementing "Environment consistency" iteration 2 (deploy, package, rehearse) for the trust-layer project in this folder. When you are done, the ONLY thing left must be the final test on my real Android phone. Everything before that is yours to finish and verify.

READ FIRST, IN THIS ORDER:
1. CLAUDE.md (project root)
2. environment-consistency/iteration-2.md  (the plan: goal, decisions D1-D6, phases P0-P8, the phone-test steps in section 5, definition of done)
3. environment-consistency/iteration-1.md  (the demo-is-real rule in section 0, the cut list in section 4)
4. environment-consistency/progress.md     (live state; keep it current; confirm E0-E6 are really done before starting; if not, stop and tell me)
5. README.md, backend/main.py, backend/hardening.py, backend/fusion/ipctx.py, client/vite.config.js, client/index.html, client/src/lib/api.js
6. edge-validator/README.md and the Phase 8 sections of edge-validator/progress.md (harness recipes and pitfalls)

THE GOAL: a REAL demo for judges. The app is served from my laptop through a tunnel on one public HTTPS address (backend serves the built client and the API, D1), packaged as an Android Trusted Web Activity with Bubblewrap, running in public mode with the dashboard protected, the real IP database, and a one-command preflight. Nothing fake ships.

WHAT TO DO: execute P0, P1, P2, P3, P4, P5, P6, P7, P8 in order without stopping to ask between phases. After EACH phase run its tests and update environment-consistency/progress.md (tick only with evidence; phase-log entry: built / measured / bugs found / open; REAL vs SYNTHETIC). If a phase needs something only I can give (N1 domain and tunnel login, N3 APK fingerprint, N4 phone apps), build and test everything that does not need it, mark it "blocked on Nx: <exactly what is needed>", and CONTINUE with the next unblocked phase. List the blocked items in a table at the end.

FIRST ACTIONS: read the files, confirm iteration 1 is done (suites, the monotone scan, the IP database present), run the baselines (pytest, npm test, npm run build, fusion:parity, npm run e2e), then tell me in at most 8 lines: what you found, what is blocked on me (N-numbers), and your plan for P0-P2.

SUPERVISION: CLAUDE.md requires invoking the `edge-validator-ai` subagent after every milestone, before a new phase, and after two consecutive test failures, and halting on STOP. Tell it explicitly: "audit environment-consistency/progress.md and the iteration 2 work against environment-consistency/iteration-2.md". If it cannot be invoked, write "not invocable" in the Supervision log. Do NOT substitute a stand-in.

HARD RULES
- Nothing fake in the product or in public mode. The test IP provider is loadable ONLY under test and PUBLIC_MODE=1 must refuse it (with a test). No demo IP switch, no seeded visits, no mock dashboard data. The preflight fails if any of these is present.
- PUBLIC_MODE=1 refuses to start unless DASHBOARD_TOKEN, TRUSTED_PROXY_HEADER, the database path, the model file and the IP database are set/present. The dashboard, photo, sites and review endpoints need the token; the worker capture endpoints stay open with the existing rate limit. /docs and /openapi.json are off in public mode. Never log raw IPs or tokens.
- Never print, store or ask for my tunnel token, keystore password or dashboard token in files you create. Give commands the user runs themselves. Put variable NAMES in docs, never values.
- Do NOT run Bubblewrap, ngrok, cloudflared, adb or any command that logs in, signs, or opens a tunnel: write the exact commands for me to run (docs/apk-build.md and the runbook). You may call my tunnel's public URL only if I give it to you, and only for GET /health, the manifest and assetlinks.json.
- Do NOT commit, push, reset, clean or stash. Do NOT install system software. Do NOT add a dependency without asking me first (with a recommendation).
- Keep the iteration 1 contract (5 classifier inputs, SHAP keys, column names, reset-fingerprint, old payloads, old databases). The monotone and no-crash tests from iteration 1 must stay green.
- Thresholds only in fusion.json, each change logged in Sensor-fusion/thresholds-changelog.md with evidence.
- Every number in the demo runbook comes from a run in P7, never from the plan. Label REAL vs SYNTHETIC. Do not claim the phone test, the VPN case, the carrier distance or the APK were verified: they are not until I do them.

ENVIRONMENT RULES
- My own servers on 8000 (backend) and 5174 (Vite) are mine: NEVER touch them, NEVER POST to 8000 (my real DB). Use the isolated harness (npm run e2e: backend 127.0.0.1:8001 with a temp DB, Vite 127.0.0.1:5173). For the single-origin build use another isolated port. localhost:5173 here is ANOTHER project: use 127.0.0.1.
- Backend tests: cd backend && .venv/bin/python -m pytest -q (targeted files while iterating). Client: cd client && npm test, npm run build.
- Do not edit client/src while an e2e run is active. Do not run npm install while my Vite is up.
- Look at screenshots (capture flow and case file, phone and desktop widths) and describe what you saw; assertions alone are not proof.
- No third-party requests from the page or the dashboard.

DEFINITION OF DONE: section 4 of iteration-2.md holds. The preflight is green (paste its output into progress.md) except checks that need my tunnel or my phone, which are listed as "needs N1" or "needs phone test". The phone-test pack (phone-test.md, results log, triage table) is complete. Final message: (1) what works, (2) what was measured and rehearsed (REAL vs SYNTHETIC), (3) bugs found, (4) a table of exactly what I must still do, in order, ending with the phone test, and the first command to run.
```

## Order for you

| Step | Who |
|---|---|
| Finish iteration 1 | agent |
| Choose the tunnel, create the account, log in on the laptop (N1) | you |
| Run iteration 2 up to P3 | agent |
| Run the Bubblewrap commands from `docs/apk-build.md`, send the SHA-256 fingerprint (N3) | you |
| Agent finishes P3-P8 and states "everything done except the phone test" | agent |
| Phone test, then the backup video (section 5 of `iteration-2.md`) | you |
