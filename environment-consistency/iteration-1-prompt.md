# Environment consistency iteration 1 (hackathon edition): prompt for a fresh session

Paste everything inside the code block into a new Claude Code chat opened at `/Users/prakharsrivastava/Awign/trust-layer`. M1 (IP database) and M2 (your house as `site_demo_1`) are done; M3 (consent sentence) defaults to yes. Optionally register the house first with the `curl` in section 1 of `iteration-1.md`, and restart your own backend on 8000 once.

```
You are implementing "Environment consistency" iteration 1 (hackathon edition) for the trust-layer project in this folder. The "ambient fingerprint" asks: does the network around the phone fit the claimed area?

READ FIRST, IN THIS ORDER (do not skip; do not re-derive what they state):
1. CLAUDE.md (project root)
2. README.md (project root; "How scoring works", "Known limitations")
3. environment-consistency/iteration-1.md  (the plan: the demo-is-real rule, verified state INCLUDING TWO DEFECTS, phases E0-E6, what was cut and why, definition of done)
4. environment-consistency/progress.md     (the live state; keep it current)
5. environment-consistency/iteration-2.md  (what comes next; read it so iteration 1 does not make it harder, do NOT implement it)
6. Sensor-fusion/README.md, backend/fusion/environment.py, ipctx.py, pipeline.py, simulate.py, classifier.py, train_classifier.py, client/src/lib/sensorFusion/fusion.json
7. edge-validator/README.md and the Phase 8 sections of edge-validator/progress.md (harness recipes and pitfalls you must reuse)

THE GOAL: a REAL hackathon demo. Real phone inputs, real IP lookups from the DB-IP database, a real registered site, a real VPN as the wrong-network case. Nothing on screen is faked. Be honest about what a web page cannot do (no WiFi/cell identifiers) and that the classifier is trained on simulated data.

USER INPUTS ALREADY GIVEN (verify, do not ask again): M1 done: the DB-IP files dbip-city-lite-2026-10.mmdb and dbip-asn-lite-2026-10.mmdb are in backend/data/geoip/ (check they exist and that the reader works on real records in E2). M2 done: the demo site is the id the Capture page hard-codes, site_demo_1 (client/src/pages/Capture.jsx), at the user's house: lat 12.9259481, lng 77.6722586, country IN, radius 100 m (the user said 80; 100 recommended for indoor GPS drift, editable in the panel). The USER registers it in their own database (curl in iteration-1.md section 1, or the new Site panel); you must NEVER write to the user's real database or to port 8000; use fixtures and the isolated harness. M3 (consent sentence): default yes.

WHAT TO DO: execute E0, E1, E2, E3, E4, E5, E6 of iteration-1.md in order, without stopping to ask between phases. After EACH phase run its tests, then update environment-consistency/progress.md (tick boxes only with evidence; phase-log entry: built / measured / bugs found / open; label every number REAL or SYNTHETIC). If a phase is blocked on a user input, build and test everything that does not need it against fakes, mark it "blocked on <input>: <exactly what is needed>", and CONTINUE with the next unblocked phase.

E4 IS A UI PHASE: build the dashboard "Site location" panel exactly as specified in iteration-1.md E4 (edit lat/lng/radius/country/label of site_demo_1, "Use my current location", "Forget the learned network" ticked by default when the move is more than 1 km, confirm step with old to new values, change log table, distance sanity line, dashboard-token protected, backend validation messages shown). The user will use it to move the site from their house to the hackathon venue, so it must be usable on a phone at the venue and must never leave the learned home network attached silently. Follow the existing dashboard design tokens and components, add component and API tests, and LOOK at screenshots of the panel at phone and desktop widths and describe what you saw.

START WITH E0 and E1 (they block the demo): 
- E0: run the baselines (backend pytest, client npm test, npm run build, npm run fusion:parity, npm run e2e), check backend/data/geoip/ and the site table (read-only; NEVER write to backend/trust_layer.db), then reproduce DEFECT 1 and DEFECT 2 from iteration-1.md section 2 as failing tests. Tell me in at most 8 lines what you found and what is blocked, then continue.
- E1: (a) the classifier must be monotone in the environment score: P(fraud) never rises as the environment score falls, other inputs fixed, whenever env_known is true. Today P is 0.06 for environment 0.00-0.15 but 0.95 for 0.20-0.30. Fix at the root first: add simulator scenarios covering the low-environment range (foreign-country exit, datacenter/VPN honest and not honest) generated from RAW network behaviour through the real environment.py, with documented label assumptions; retrain. If sparse regions still bend the curve, add a monotone guard in classifier.py (largest P over higher environment scores) applied only when env_known, and say so. (b) score_submission must never raise: SHAP additivity failures (seen at environment exactly 0.60) fall back to a marked approximate explanation. (c) keep the old model as fraud_classifier_v2_pre_env.pkl and keep FUSION_MODEL working. Pin all of it with tests: a fine grid scan for several motion/photo settings, 2000 random inputs, the foreign-VPN case flagged with a sentence, an honest same-country VPN NOT flagged by the VPN alone, unknown never flags.

SUPERVISION: CLAUDE.md requires invoking the `edge-validator-ai` subagent after every milestone, before a new phase, and after two consecutive test failures, and halting on STOP. Tell it explicitly: "audit environment-consistency/progress.md and the environment work against environment-consistency/iteration-1.md". If it cannot be invoked in this session, write "not invocable" in the Supervision log of progress.md. Do NOT substitute a stand-in and call it the real review.

HARD RULES
- Never add a demo/fake IP switch to the product. A fake IP provider is allowed ONLY inside automated tests (ipctx.set_provider) and must be impossible to load when PUBLIC_MODE=1 (that mode is iteration 2; keep the provider injection test-only now).
- The environment signal produces a score, a known flag, flags and evidence only. NEVER let a rule set status or block. Only the classifier turns signals into a probability.
- UNKNOWN IS NOT SUSPICIOUS: nothing comparable (no IP database, no site, no profile, a browser that exposes nothing, loopback/private address) => env_known=false, 0.5, never flagged. Re-pin after every change.
- Keep the contract: 5 classifier inputs, SHAP keys (photo_quality, motion_consistency, ambient_fingerprint), column names motion_score/ambient_score, /sites/{id}/reset-fingerprint, old payloads (new fields optional), old databases (additive migration + test).
- Honesty: label REAL vs SYNTHETIC. The simulator must produce raw behaviour and run it through the real engines; it must not import scoring weights; its IP-geolocation error model must come from published accuracy figures, not values tuned to the rules. Never present simulator accuracy as real.
- Thresholds live only in client/src/lib/sensorFusion/fusion.json; every change gets a row in Sensor-fusion/thresholds-changelog.md with evidence. Do not change client/src/lib/photoQuality/thresholds.json.
- Privacy: never store a raw IP (IPv4 last octet zeroed, IPv6 last 80 bits zeroed). The consent sentence is a DRAFT.
- Security: trust X-Forwarded-For only when TRUSTED_PROXY_HEADER (+ TRUSTED_PROXY_HOPS) is set; a header from a direct caller is ignored; malformed network_info / radio / trail / tz input must never cause a 500. GET /env/check exists only when ENV_CHECK=1 (404 otherwise) and never returns the site's coordinates.
- Do NOT commit, push, reset, clean or stash. Do NOT install system software. Do NOT add a dependency without asking me first (with a recommendation). Do NOT download the IP databases if the sandbox blocks it: tell me to run `cd backend && .venv/bin/python tools/fetch_geoip.py` (M1); never claim the IP rules were verified on real data until real .mmdb files were used.
- Never invent site coordinates, IP-database results or test-session data.

ENVIRONMENT RULES
- My own dev servers run on 8000 (backend, --reload) and 5174 (Vite). NEVER touch them and NEVER POST to 8000. Use the isolated harness: cd client && npm run e2e (isolated backend 127.0.0.1:8001 with a temp DB and PHOTO_DIR, Vite on 127.0.0.1:5173). localhost:5173 here is ANOTHER project: use 127.0.0.1.
- Backend tests: cd backend && .venv/bin/python -m pytest -q (full run takes minutes; target files while iterating). Client: cd client && npm test, npm run build. Use TRUST_LAYER_DB / PHOTO_DIR / GEOIP_DIR for isolated backends.
- Do not edit client/src while an e2e run is active. Do not run npm install while my Vite is up.
- Do not wait for background jobs with pgrep -f loops.
- A passing assertion is not proof the UI is right: look at screenshots of the case-file Network section and the IP-database chip at phone and desktop widths and say what you saw.
- No map tiles and no third-party requests from the dashboard (the DB-IP credit is text with a link).

DEFINITION OF DONE: section 6 of iteration-1.md holds, or each unmet item is marked "blocked on the user" with exactly what is needed; suites green vs your E0 baseline; accuracy report regenerated (SYNTHETIC labelled); README.md, Sensor-fusion/README.md and progress.md updated. Final message: what works; what was measured (REAL vs SYNTHETIC); what is open; bugs found; exactly what I still owe (M-numbers) in a table; how to register my house and later move the site to the hackathon venue from the dashboard; and the first command to run for iteration 2.
```

## What to prepare while it works

| When | You do |
|---|---|
| Before pasting | nothing is required: M1 and M2 are done. Optional: run the `curl` in `iteration-1.md` section 1 to register your house, and restart your backend on 8000 once |
| While it runs | decide the tunnel (N1 in `iteration-2.md`): ngrok static domain or Cloudflare with a domain |
| After it finishes | paste `iteration-2-prompt.md` |
| Always | keep your servers on 8000 and 5174 as they are |
