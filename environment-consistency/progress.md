# Environment consistency: progress

Plans: [`iteration-1.md`](iteration-1.md) (build, hackathon edition) · [`iteration-2.md`](iteration-2.md) (deploy, package, rehearse) · prompts: [`iteration-1-prompt.md`](iteration-1-prompt.md), [`iteration-2-prompt.md`](iteration-2-prompt.md)

**Status (2026-10-08): iteration 1 implemented and verified (E0-E6 ticked below). Two things are the user's, not code: restart the own backend on 8000 once, and record 3 real visits on the phone (the learned network is still 0 rows in the real database). Iteration 2 not started.** Tick a box only with evidence (test name, number, screenshot description). Label every number REAL or SYNTHETIC.

## Waiting on the user

| # | Item | For | Status |
|---|---|---|---|
| M1 | DB-IP files in `backend/data/geoip/` (city 127 MB + ASN 9.6 MB, 2026-10) | E2, E3 | **done and verified on real records (E2)**. User restarts own backend on 8000 once (new model, new IP code, new `sitechange` table) |
| M2 | Demo site `site_demo_1` = user's house: lat 12.9259481, lng 77.6722586, country IN, radius 100 m | E4 | **done**: read-only check of the real database shows it registered by the user (label "Home (test)"). The agent never wrote to the real database. **The learned network (fingerprint) is NOT there yet**: 0 rows; the 3 accepted submissions in the dashboard (ids 11-13) came from a device with `motion: absent` and no GPS fixes, so under E5 they teach nothing. Owed: 3 recorded phone visits |
| M3 | OK with the consent sentence about network / IP | E6 | default yes applied (DRAFT sentence in `consent.js`; the wording and the 30-day retention are the owner's decisions) |
| N1 | Tunnel choice (ngrok static domain / Cloudflare), domain, logged in on the laptop | P2 | waiting |
| N2 | Laptop kept awake, plugged in, hotspot as backup | demo day | waiting |
| N3 | Run Bubblewrap `init` / `build` / `fingerprint`, send the SHA-256 | P3 | waiting |
| N4 | VPN app with country choice + mock-location app on the phone | phone test | waiting |
| N5 | Backup video | after phone test | waiting |
| N6 | Phone model, Android and Chrome versions | phone test | waiting |

## Known defects found while planning (2026-10-08, SYNTHETIC model, reproduced by a probe)

| # | Defect | Fix in |
|---|---|---|
| 1 | Classifier not monotone in the environment score: P(fraud) 0.06 at env 0.00-0.15, 0.95 at 0.20-0.30; a foreign VPN exit (env 0.17) is not flagged | E1: **fixed**, pinned by 6 monotone scans + 2000 random pairs |
| 2 | `score_submission` can raise (SHAP additivity failure, e.g. env exactly 0.60) which would be a 500 on `POST /submissions` | E1: **fixed**, pinned (0 of 600 random inputs fall back at run time) |

## Iteration 1 phases

| Phase | Scope | Status | Evidence |
|---|---|---|---|
| E0 | Baseline + failing tests for the two defects | [x] | baseline numbers in Measured; the two defects reproduced and pinned (6 failing tests, now `backend/tests/test_classifier_env.py`, all passing) |
| E1 | Fix the classifier (monotone, no crash, rollback model) | [x] | `backend/tests/test_classifier_env.py` 31 passed (fine-grid scan x6 motion/photo settings, 2000 random monotone pairs, 2000 random no-raise, garbage inputs, SHAP fallback x2, foreign VPN flagged with sentence "The network is in NL, the site is in IN", country mismatch on a new site (env exactly 0.30) flagged, honest same-country VPN x3 exits not flagged, far carrier gateway not flagged, unknown never flags, v2 and v1 models still load via FUSION_MODEL). Full-suite regression pending (see Measured) |
| E2 | IP data go-live (real files) | [x] | `tests/test_ipctx.py` + `tests/test_ipctx_real.py`: 50 passed, 0 skipped (real files used). `tools/fetch_geoip.py --check` exit 0 ("data is 7 days old"). Screenshot of the credit: with E6 |
| E3 | Truthful IP + `/env/check` | [x] | `backend/tests/test_ip_truth.py` (client_ip: 23 table-driven header cases + no-client + exploding request, masking x9, shared-address warning, API trust of the header, `/env/check` 404/200/unknown/no-DB/odd-query, malformed network/radio/trail never 500). Last full run of the E3 files: see Measured |
| E4 | Dashboard "Site location" panel (edit, use my location, forget learned network, change log) + no-site behaviour | [x] | `npm run e2e sitepanel`: ALL CHECKS PASSED (create path on a fresh isolated DB, about 50 checks incl. real saves, real change log, real learned rows, forget, move, phone width). Backend `test_site_api.py` 30 passed, `test_learning_safety.py` 13 passed; client `npm test` 279 pass. Screenshots looked at (below) |
| E5 | Learning safety (trusted visits only) | [x] | `tests/test_learning_safety.py`: decision table x7, ten accepted-but-spoofed visits (classifier forced to accept) teach nothing, honest visits afterwards define normal, spoofers' network still "unseen"; reviewer approval and reset endpoint still work |
| E6 | Dashboard, consent, regression, docs | [x] | Network section (provider, IP data date, "learned from N visits" / "fewer than 3"), top-bar chip "IP database not installed" (`npm run e2e ipchip`: ALL CHECKS PASSED, screenshots viewed), DB-IP credit, consent sentence, retention tool removes the shortened IP + city (`test_purge_trails_also_removes...`), accuracy report regenerated (see E6 log), READMEs updated, suites in Measured |

## Iteration 2 phases

| Phase | Scope | Status | Evidence |
|---|---|---|---|
| P0 | Single-origin build | [x] | `backend/tests/test_serving.py` 17 passed (SPA fallback, `/api` prefix, no shadowing of API routes, cache headers, path traversal, missing file = 404, unknown `/api/x` = JSON 404). Real browser against the production build: `npm run e2e:public pub_basics` ALL CHECKS PASSED (15) |
| P1 | Public-mode hardening | [x] | `backend/tests/test_public_mode.py` 40 passed (start-up refusal per missing variable, no secret in any message, security headers, body caps per endpoint, forwarded-proto, log redaction, the fake IP provider refused, every protected endpoint 401 without the token, worker endpoints open, CORS exact origin). Subprocess tests import the real app in public mode |
| P2 | Tunnel runbook | [~] | `environment-consistency/tunnel-runbook.md` + `demo/demo-up.sh` written (bash syntax checked). **Not run: blocked on N1** (your tunnel choice, fixed domain, logged in on the laptop). The assistant never opens a tunnel |
| P3 | TWA packaging files | [~] | manifest, icons (looked at), `android/twa-manifest.template.json`, `docs/apk-build.md`, `backend/data/assetlinks.json` (placeholder), validator: done and tested (`test_preflight.py`). **Blocked on N1** (the domain goes into the Bubblewrap file) and **N3** (the signing fingerprint) |
| P4 | Preflight | [x] | `backend/tests/test_preflight.py` 26 passed (each check against a broken and a good setup; the CLI is red with a broken setup and never prints the token). A real pre-tunnel run is pasted below |
| P5 | Demo hygiene (reset, seed check) | [x] | `backend/tests/test_demo_tools.py` (reset keeps sites, backup is restorable, all sites, the in-use guard in public mode, `seed_check` read-only). `seed_check` also run read-only on the real database (see Bugs) |
| P6 | Demo runbook | [x] | `environment-consistency/demo-runbook.md`, every number from the P7 rehearsal |
| P7 | Rehearsal and verification | [x] | `npm run e2e:public pub`: **43 checks, ALL PASSED**, 8 real-address cases below, screenshots looked at. The full `npm run e2e` is in Measured. VPN and carrier cases need the phone |
| P8 | Phone-test pack | [x] | `environment-consistency/phone-test.md` + `templates/phone-test-results.csv`. **The phone test is NOT done** |

## Final step (yours): the phone test, section 5 of `iteration-2.md`

| Step | Result |
|---|---|
| 0 (move the site to the venue with the panel) to 10 | not started |

## Measured

| Suite | E0 baseline (original code, 2026-10-08) | After iteration 1 | After iteration 2 |
|---|---|---|---|
| `pytest -q` | **235 passed, 2 skipped** (24:38, loaded machine) | **433 passed** (19:17); the report files were rerun after the report code changed: 36 passed | |
| `npm test` | **261 pass, 0 fail** | **279 pass, 0 fail** | |
| `npm run build` | OK | OK | |
| `npm run fusion:parity` | 13/13 cases agree (104 values) | 13/13 cases agree (104 values) | |
| `npm run e2e` | **not measured at E0** (the machine was busy with other runs); last recorded: 229 PASS / 0 FAIL at the end of Phase 8, before the fusion work | see below | |

**e2e after iteration 1 (REAL browser + REAL isolated backend; honest account):** the last COMPLETE run of every scenario was 320 PASS / 5 FAIL: 3 were a stale expectation from the sensor-fusion iteration (the post-photo button is now "I've reached the site", not "Submit"), 2 were my new panel scenario assuming an empty database. Two earlier failures in that same suite were also fixed: a check that required an empty database (`no submission exists before the tap` now compares with the count at the start) and a **real bug** (`client/src/lib/api.js` read `localStorage` without a guard, so a browser that blocks storage threw at start-up). After those fixes I did NOT capture one more complete run of the whole suite: the one after crashed inside the face-timing `liveness` scenario (a selector timeout while the machine load average was about 11; the same scenario passed in the run before and in the run after). Instead the affected scenarios were run together on one database (`npm run e2e liveness,toggle,sharpcapture,netsection,sitepanel`): **119 PASS, ALL CHECKS PASSED**, and `ipchip` (9 PASS). **Re-run the whole `npm run e2e` once on a quiet machine to close this.**

## Supervision log

CLAUDE.md asks for the `edge-validator-ai` subagent after each milestone. Record: invoked and its verdict, or "not invocable" (no stand-ins).

- 2026-10-08, before E0, and again at the milestones E1, E2, E3, E4, E5 and E6: **not invocable** (`Agent type 'edge-validator-ai' not found. Available agents: claude, claude-code-guide, Explore, general-purpose, Plan, statusline-setup`; the definition exists at `.claude/agents/edge-validator-ai.md` but is not registered in this session; restart Claude Code / `/agents`). No stand-in was used; **no milestone of iteration 1 has been reviewed by it.** Restart Claude Code / run `/agents`, then ask it: "audit environment-consistency/progress.md and the environment work against environment-consistency/iteration-1.md".

## Phase log

### E0 (2026-10-08) baseline + defects
**Built:** `backend/tests/test_classifier_env.py` (started as the 6 failing defect tests). **Measured (REAL code, SYNTHETIC model):** DEFECT 1 reproduced: photo 0.9, motion 0.97: P = 0.06 for environment 0.00-0.15, 0.95 at 0.20-0.30, 0.70 at 0.35-0.40, 0.19-0.21 at 0.45-0.55. DEFECT 2 reproduced: `ExplainerError: Additivity check failed` at environment 0.60 (sum of SHAP -1.47 vs model output -0.03). Client baseline: `npm test` 261 pass / 0 fail; `fusion:parity` 13/13 cases agree (104 values); `npm run build` ok. Real DB (read-only): 1 site (`site_demo_1`, 12.9259481, 77.6722586, r 100, IN, "Home (test)", registered by the user), 0 learned profiles, 10 submissions. DB-IP: both .mmdb present, reader (maxminddb 3.2.0) returns real records (8.8.8.8 -> US / California / Mountain View, AS15169 Google LLC). **Bugs:** none in the product beyond the two defects. **Open:** backend/e2e baselines (see Measured).

### E1 (2026-10-08) classifier
**Built:** (a) `fusion/simulate.py`: an IP-geolocation ERROR MODEL (`Params.ip_country_err` 0.02, `ip_city_miss` 0.37, `ip_miss_median_km` 120; SHIFTED world 0.04 / 0.5 / 200). Sources: MaxMind publishes ~99.8% country-level accuracy and ~63% of US IPs within 50 km (so ~37% farther); DB-IP lite is a reduced-accuracy subset (its country "accuracy index" 81 vs 93 commercial). **ASSUMPTIONS, not published:** the country error 2% (10x MaxMind's, for a lite database), the lognormal shape/median of the position error. India-specific figures could not be retrieved (MaxMind's tool is interactive) and were not invented. New scenarios from RAW network behaviour through the real `environment.py`: `n_vpn_foreign_genuine_walk` (label 1), `n_isp_foreign_genuine_walk` (1), `n_vpn_same_country_honest` (0), `n_vpn_same_country_spoof` (1); the old `h_vpn` (NL exit labelled GENUINE: the root of DEFECT 1) is removed; `f_wrong_area_network` now uses only truly foreign networks (an in-country carrier gateway is what honest users have, so it was contradictory fraud evidence). Foreign scenarios use an empty site profile 35% of the time (country mismatch alone = environment exactly 0.30). **Label assumption (documented in the code):** a worker whose network is in another country than the claimed area cannot be told from a spoofer behind that country's network; the chosen policy is review (label 1). Network-only scenarios are only generated where the network CAN be compared (a site and an IP database), otherwise the row would carry no evidence yet be labelled fraud. (b) `classifier.py`: monotone guard (largest P over this and every higher environment score, only when `env_known` and the model has that input; result carries `monotone_guard_applied`), SHAP fallback (no check, then equal shares; result carries `explanation: exact|approximate`), non-finite/garbage inputs sanitised. (c) `fraud_classifier_v2_pre_env.pkl` + `synthetic_fusion_data_v2_pre_env.csv` kept; `FUSION_MODEL` verified for v2 and v1.
**Measured (SYNTHETIC):** held-back accuracy of the simulator 0.961 (was 0.93 before; a property of the simulator, not of real fraud). Scan photo 0.9 / motion 0.97: P = 0.986 for environment 0-0.21, 0.94 at 0.24, 0.81 at 0.28-0.32 (guard applied at 0.28), 0.18 at 0.35-0.40, 0.02 at 0.56, 0.01 at 0.65-1.0. Demo cases through the real engine: foreign VPN 0.99, foreign ISP > 0.5, country mismatch only (0.30) 0.81, same-country VPN 0.02, far carrier gateway low.
**Bugs found:** the first retrain still had a bump at 0.65-0.70 (P 0.59): rows of the network-only fraud scenario with no site/IP carried no evidence; fixed in the simulator (above). A foreign ISP alone (0.30) sat on the cliff until empty-profile rows were added. **Open:** the guard still changes some sparse bands (fine: it only raises P where the model bends upward); the cliff between 0.32 and 0.35 is a learned step, not a calibrated value.

### E2 (2026-10-08) IP data go-live
**Built:** `fusion/ipctx.py`: IPv4-mapped / bracketed IPv6 normalised; any non-globally-routable address (private, loopback, link-local, reserved, **carrier-grade NAT 100.64/10, documentation ranges**) is `private=True` so it is "unavailable", never "far"; each database opened separately (one corrupt file no longer disables the other; two corrupt files = NullProvider, no raise); a failing record in one reader keeps the other's data; `status()` (provider, file names, sizes, data date from the .mmdb build time, age, stale > 45 days, credit); `warn_if_unavailable()` logs at start-up (no database / stale). `GET /health` now returns `{"status":"ok","ip_database":{...}}`. `tools/fetch_geoip.py --check` (exit 1 when missing/unreadable/older than 45 days). UI: `lib/ipDatabase.js` (+5 node tests), the DB-IP credit as text + link in the footer (when a database is installed) and next to the case file's Network line; no image, no third-party request. **Measured (REAL: DB-IP lite 2026-10, files dated 2026-10-01):**

| IP | Country | Provider (ASN) | City |
|---|---|---|---|
| 8.8.8.8 | US | Google LLC (15169) | Mountain View |
| 9.9.9.9 | US | Quad9 (19281) | Berkeley |
| 208.67.222.222 | US | Cisco OpenDNS (36692) | San Jose |
| 192.5.5.241 | US | Internet Systems Consortium (3557) | Newmarket |
| 193.0.14.129 | NL | RIPE NCC (25152) | Amsterdam |
| 202.12.27.33 | JP | WIDE Project (7500) | Fujisawa |
| 106.51.0.1 | IN | Atria Convergence Technologies (24309) | Bengaluru |
| 117.206.0.1 | IN | Bharat Sanchar Nigam (9829) | Surat |
| 14.139.60.1 | IN | National Knowledge Network (55824) | Thanesar |
| 2606:4700:4700::1111 (IPv6) | CA | Cloudflare (13335) | Montreal |

Honest observations on REAL data: anycast addresses geolocate to where the database thinks the operator is, not where the packet entered (1.1.1.1 -> Sydney, 103.21.244.1 Cloudflare -> Toronto, Google IPv6 -> Montreal): IP location is coarse, which is why the distance rule is lenient. 49.44.0.1 has a city record and **no ASN record** (present in one database only): handled, keeps its location. **Bugs found by running it:** `100.64.0.1` (carrier NAT space) was NOT classed private by Python's `is_private` and would have become a context with nothing in it; `::ffff:` forms were not normalised. Both fixed and pinned. **Open:** the demo phone's carrier resolution is still unmeasured (needs the phone).

### E3 (2026-10-08) truthful IP + self-check
**Built:** `ipctx.client_ip`: `TRUSTED_PROXY_HEADER` + `TRUSTED_PROXY_HOPS` (x-forwarded-for: the entry `hops` from the RIGHT, i.e. what the trusted proxy wrote; anything the client put on the left is ignored; single-value headers like `cf-connecting-ip` used as is; ports, `[v6]:port`, `::ffff:` handled; a header from a direct caller with nothing configured is ignored; malformed header falls back to the socket address; never raises); `ipctx.note_client_ip` (one warning if the last 30 requests all came from one non-routable address, i.e. an untrusted proxy); `ipctx.mask_ip` (IPv4 last octet zeroed, IPv6 keeps only /48; the old mask mangled compressed IPv6 like `::1`); `GET /env/check?site_id=` (only with `ENV_CHECK=1`, 404 otherwise; masked IP, country, region, provider, VPN or not, km to the site, environment score, sentence; never the site's coordinates; rate-limited). `environment.py` hardened against non-finite link numbers, non-list radio fields, unhashable/oversized BSSIDs.
**Bugs found by running it:** (1) the API test showed a foreign VPN with NO motion data scored P = 0.11: the training data had no foreign-network rows without sensors. Fixed by blind variants in the simulator (20% no motion sensor data, 10% one legacy GPS point, 10% nothing at all). (2) After that retrain the GradientBoosting model became unstable in sparse corners (photo = 0.0 flagged almost everything). Root fix: the classifier is now a `HistGradientBoostingClassifier` with monotone constraints (non-increasing in photo, motion and environment scores), plus explicit "no photo" rows for honest workers; the classifier-side guard stays as defence in depth. (3) `train_classifier.py` itself hit the SHAP additivity error (DEFECT 2 at training time): its summary now uses `check_additivity=False`. The SHAP fallback rate at run time on the new model: 0 of 600 random inputs approximate.
**Open:** none for E3; the real carrier's resolution is a phone-test item.

### E4 (2026-10-08) Site location panel + no-site behaviour
**Built (backend):** table `sitechange` (additive; created by `create_all`, tested on an old database); `PUT /sites/{id}` writes a change-log line for every create/move/edit (none for a no-op), accepts `reset_network` (only when true is the learned profile forgotten; other sites untouched), returns `moved_m`, `network_reset`, `profile_rows_cleared`; validation messages unchanged plus NaN/inf refused, country must be letters, label <= 80 chars; `GET /sites/{id}/changes`; every site endpoint needs the dashboard token when it is set. No site registered: the case file note says so and the network is compared with the phone's own GPS at weight `ipFarGps` 0.15 (flag `ip_far_from_gps`; threshold logged in `thresholds-changelog.md`). **Measured / seen (REAL browser, REAL isolated backend; the venue point 13.0827, 80.2707 is a TEST value for the isolated database only):** the create path registers the house values exactly as typed (API agrees), a radius of 4 m is refused in words before sending, the confirm step lists old -> new, a backend 422 is shown verbatim and nothing is saved, "Use my current location" with a +-80 m fix warns ("worse than 50 m") and with +-12 m confirms, a 282 km move ticks "Forget the learned network" by itself and the person can untick/tick it, the move writes a log line (old -> new, 282 km, network forgotten, rows cleared > 0), the earlier submission still says it was scored at the house while the next one says the venue, three verified visits (a visit session + a recorded walk) teach the network while sensor-less visits teach nothing. **Screenshots I looked at:** desktop saved state (current-values card, 4-up inputs, full-width label, locate button, distance line, forget box, one-line log), desktop learned view (green headline, one table row, red Forget button), desktop and phone confirm steps (changed rows highlighted, "(same)" on unchanged fields, full-width Confirm on the phone, no sideways scroll at 390 px, inputs 44 px / 16 px text). **Bugs found by running it:** (1) the panel disabled Review whenever the POINT was unchanged, so a change of radius or label alone could not be saved (fixed, pinned by an e2e check); (2) my first e2e helper typed into inputs without selecting the old text (harness bug, not product). **Built (client):** `SiteLocationPanel.jsx` (+ `lib/sensorFusion/siteForm.js`): current values + last changed, editable fields, "Use my current location" with the accuracy (amber warning above 50 m), distance sanity line, "Forget the learned network" ticked by default only for a move over 1 km (stays as the person sets it), confirm step old -> new, backend message shown on a refusal, change log. Replaces the old multi-site `SitesPanel` on the dashboard (the file is left unused). **Added at the user's request:** `GET /sites/{id}/profile` (the stored fingerprint exactly as stored: link classes, provider numbers, shortened radio hashes, counts, last seen; no IP) and a "Learned network" section + standalone "Forget" button in the panel Built and verified end to end: a **Learned network (the site's fingerprint)** card (headline "Learned from N accepted visits" / "Fewer than 3 ... off" / "Nothing learned yet", a table of exactly what is stored with a plain-words reading of each speed class, counts, last seen, the rule, "never an IP address") and a **Forget the learned network** button that asks first and says how many rows go.

### E5 (2026-10-08) learning safety
**Built:** `pipeline.learning_decision`: a visit teaches the site's network only if accepted AND the phone's movement was compared with the GPS trail (sensors used, motion known) AND motion consistency >= `environment.learnMinMotion` 0.8 (threshold in `fusion.json`, changelog row added). Reviewer approval (a human decision) and the reset endpoint are unchanged. **Behaviour change to be aware of:** a visit without usable sensors (desktop, declined recording) is accepted but no longer teaches the profile, so the "unseen network" check needs real phone visits with the recording on (3 of them) before it can say anything. Two older tests that taught the profile from sensor-less visits were updated to use verified visits.

### E6 (2026-10-08) dashboard, consent, regression, docs
**Built:** the case file's Network section now shows the provider data's date ("DB-IP lite, data from 2026-10-01, 7 days old at the time"), "Site network: learned from N accepted visits" or "fewer than 3 (N so far): new-network checks are off", "no site registered for this task", and the DB-IP credit link next to the IP line; top-bar chip when the database is missing or old; footer credit; consent sentence (draft, M3); `purge_trails.py` removes the shortened IP and city after the retention period and counts them separately; the accuracy report has a "Network ('environment') rows" block.
**Seen (screenshots, REAL browser, real DB-IP lookups through the real engine and the SYNTHETIC model):** the case file is a side drawer about 410 px wide at both page widths. At the 1280 px page the US case (8.8.8.8): network score 30 "inconsistent", the sentence "The network is in US, the site is in IN.", the check table (IP location: other country, US vs site IN), "Network in another country" explained in plain words, and the rows "Mountain View, California, US · Google LLC · 8.8.8.0 · IP Geolocation by DB-IP", IP data date, Site network and site radius. At the 390 px page the honest Amazon-Mumbai exit: score 46 "inconsistent" in red, rows "Mumbai, Maharashtra, IN · Amazon.com, Inc. · 13.126.0.0 · IP Geolocation by DB-IP", "IP data: DB-IP lite · data from 2026-10-01 (7 days old at the time)", "Site network: fewer than 3 accepted visits (0 so far)", no sideways scroll; and the chip: an amber triangle chip "IP database not installed" between DEMO OFF and SYSTEM ONLINE on desktop, wrapping onto its own row on the phone. **One honest wart:** an honest same-country VPN with a far exit shows a red "46 inconsistent" score although it is accepted (P 0.08); the word comes from the display thresholds in `display.js`, not from the classifier.
**Measured with the REAL database files (`npm run e2e netsection`, 29 PASS; the address is real, the classifier is SYNTHETIC):**

| Case (real public address) | Environment | P(fraud) | Status | Sentence / flags |
|---|---|---|---|---|
| Bengaluru broadband 106.51.0.1 (near the house) | 1.00 | 0.00 | accepted | none |
| US, Google 8.8.8.8 | 0.30 | 0.83 | flagged | "The network is in US, the site is in IN" |
| Singapore, DigitalOcean (VPN/hosting) 159.65.0.1 | 0.21 | 1.00 | flagged | "The network is in SG, the site is in IN" + hosting |
| Mumbai, Amazon (honest same-country VPN) 13.126.0.1 | 0.455 | 0.08 | accepted | hosting + far, no country flag |
| Navi Mumbai carrier gateway 49.44.0.1 (city record, no ASN) | 0.65 | 0.05 | accepted | far (weak) |

Every status equals the classifier's `P > 0.5`: no rule set any of them. No raw IP appears in any response. **Accuracy report (SYNTHETIC; 23 min):** held-back split 94% of fraud caught / 2% honest flagged; fresh draw 96% / 4%; hard-genuine false-flag 1-3%; network rows: fine-grid monotone **yes** (guard needed in 0 of 21 rows), foreign VPN 1% wrong, foreign ISP 1%, honest same-country VPN 3% wrong, **spoofer behind a same-country VPN 13% missed**, honest worker on an unusual link 2%. fusion.json sha256 `89a87f236c9d`. The foreign-network labels are policy assumptions, not measurements.
**Bugs found:** `api.js` unguarded `localStorage` (fixed); the panel could not save a change of radius or label alone (fixed); stale e2e expectations (above). **Open:** the report's real-trace section is still "not evaluated" (no recorded traces).

## Iteration 2 phase log

### P0-P1 (2026-10-08) one address, public mode
**Built:** `backend/serving.py` (the built client and the API from one origin; `/api/...` is the API again with the prefix stripped; the client's own routes get `index.html`, hashed assets are cached for a year, `index.html` never; missing files and unknown `/api/..` are a 404, never HTML; `/docs` etc. a 404; `/.well-known/assetlinks.json`), `backend/public_mode.py` (`PUBLIC_MODE=1` refuses to start without a 12+ character `DASHBOARD_TOKEN`, `TRUSTED_PROXY_HEADER`, an explicit `TRUST_LAYER_DB` in an existing folder, the model file and the IP database; docs off; exact-origin CORS; body caps by endpoint (submissions: photo cap + 2 MB, everything else 256 KB, 411 without a length); `X-Forwarded-Proto` honoured only behind a trusted header; security headers in every mode; log redaction of tokens and IPs), `ipctx.set_provider` refuses any provider under `PUBLIC_MODE=1` (nothing in the product calls it: pinned by a test that greps the code), `/health` reports `public_mode` and `env_check`. Client: the **third-party Google Fonts request was removed** (it was the only third-party request in the whole client; the design tokens fall back to the system fonts, so the look differs slightly), manifest link, `npm run build:prod` (same-origin `/api`, no developer tools, writes `dist/build-info.json`).
**Bugs found by running it:** unknown `/api/x` paths were answered with the app (the prefix was stripped before the fallback saw it); `/docs` fell through to the app when docs were off; my first `build:prod` applied its variables to the first command only (`api_url` came out null: the build-info file caught it); the probe subprocess segfaulted at interpreter exit (the face-model warm-up thread; the test now exits cleanly after printing).
**Open:** no Content-Security-Policy (would need a pass over the app's inline styles); `X-Frame-Options` not set (the Android app is not an iframe, a browser could still frame the page).

### P2-P3 (2026-10-08) tunnel and Android files: written, not run
`tunnel-runbook.md`, `demo/demo-up.sh` (refuses 8000/5174, builds the client if stale, starts the public-mode backend on 127.0.0.1:8002 with `--no-access-log`, `caffeinate`, the preflight, then the tunnel in the foreground), `docs/apk-build.md`, `android/twa-manifest.template.json`, `client/public/manifest.webmanifest`, icons drawn from the logo by `backend/tools/make_icons.py` (192, 512, maskable 512, apple-touch; I looked at them: the gradient shield with its pulse line, the maskable one inset for the launcher crop; a notch at the shield's apex was fixed). **Not verified:** the tunnel, the ngrok warning page, the APK, `assetlinks.json` with a real fingerprint, full-screen mode. All need you (N1, N3) and the phone.

### P4-P5 (2026-10-08) preflight, reset, seed check
`backend/tools/preflight.py` (IP database fresh and a lookup works; a site with plausible coordinates AND a country; the model loads and the 101-point scan is monotone; public-mode variables; the demo database is not the development database; the fake provider is refused; the client build is the production build; the manifest; assetlinks; disk; and with `--url` the public address answers `/health` with `public_mode: true`, serves the manifest and assetlinks and keeps `/submissions` and `/docs` closed), `demo_reset.py` (+ `--all-sites`, a timestamped sqlite backup of the database and photos first, refuses in public mode within 2 minutes of use unless `--force`), `seed_check.py` (read-only). **Bugs found:** the preflight crashed on a `/health` answer that was not a JSON object (fixed); my test helper `trusted_visit` ignored its `site` argument (fixed).

**Preflight, real run, pre-tunnel, against a throwaway FIXTURE database (a test point, not your site; the token is a placeholder, not yours):**

```
GREEN  Public mode                PASS     PUBLIC_MODE=1, a long DASHBOARD_TOKEN, TRUSTED_PROXY_HEADER and TRUST_LAYER_DB are set (values not shown)
GREEN  Demo database              PASS     demo.db
GREEN  IP database                PASS     data from 2026-10-01 (7 days old); 8.8.8.8 -> US, AS15169
GREEN  A site is registered       PASS     1 site(s): site_demo_1 (r 100 m, IN)
GREEN  Model                      PASS     fraud_classifier.pkl loads; the 101-point environment scan is monotone; foreign VPN 0.99, clean 0.01, unknown 0.00
GREEN  No fake IP in public mode  PASS     ipctx.set_provider refuses anything with PUBLIC_MODE=1
GREEN  Client build               PASS     same-origin /api, no demo tools, no third-party requests in index.html
GREEN  Web app manifest           PASS     Trust Layer (Trust Layer), standalone, 3 icons incl. maskable 512
WAIT   assetlinks.json            NEEDS N3 still the placeholder ...
GREEN  Disk space                 PASS     16.8 GB free
WAIT   Public URL answers         NEEDS N1 no --url given: needs the tunnel (N1)
READY (pre-tunnel): nothing is red.
```

### P6-P8 (2026-10-08) runbook, rehearsal, phone-test pack
**P7 rehearsal** (`cd client && npm run e2e:public pub`; REAL Chrome, REAL page and recorder, the REAL production build served by the backend in PUBLIC_MODE=1 on 127.0.0.1:8003, REAL DB-IP lookups, SYNTHETIC classifier; scripted: GPS, motion events, and the forwarded address, which is a real public address in `X-Forwarded-For` as a tunnel would add, **not a real VPN**): 43 checks, ALL PASSED, including: the dashboard needs the token (401 without, 200 with, a hard refresh on `/dashboard` works with and without it), no third-party request from the page or the dashboard, `/docs` closed, security headers present, no raw IP in any response.

| Case | Address (REAL, forwarded) | Status | P(fraud) | Environment | Flags / sentence |
|---|---|---|---|---|---|
| no site registered, genuine | Bengaluru broadband | accepted | 0.00 | 1.00 | the case file says "No site is registered for this task"; the network was compared with the phone's own GPS |
| unknown network (private address), genuine walk | none | accepted | 0.00 | 0.50 (unknown) | none: unknown is never flagged |
| near the site, genuine walk | Bengaluru broadband | accepted | 0.01 | 1.00 | none |
| foreign country, genuine walk | US ISP | **flagged** | **0.60** | 0.30 | "The network is in US, the site is in IN" |
| foreign VPN/hosting exit, genuine walk | Singapore, DigitalOcean | **flagged** | 0.99 | 0.21 | hosting + country; "The network is in SG, the site is in IN" |
| honest VPN, same country | Mumbai, Amazon | accepted | 0.02 | 0.455 | hosting + far, no country flag |
| carrier gateway far, same country | Navi Mumbai (no ASN) | accepted | 0.01 | 0.65 | far (weak) |
| headline spoof: GPS jumps onto the site, phone still | private | **flagged** | 1.00 | 0.50 | "GPS jumped 14.0 km in 5 s while the phone stayed still" (motion 0.16) |

**Honest wart:** the foreign ISP case is only just over the line (0.60 vs 0.5): it is a SYNTHETIC-model value, not a safe margin. The demo runbook tells you to show the VPN case, which was flagged at 0.99.
**Screenshots looked at (phone 390 px and desktop 1280 px, from the public build):** the Capture page with the Visit recording box ("Recording · 0 location fixes · no motion sensor" plus the two "denied" notes, because that screenshot session had no location permission and headless Chrome has no motion sensor), no sideways scroll at either width; the case files: the US case (Motion 98 consistent in green, Network 30 inconsistent in red, the sentence, the trail ending inside the site circle, the network check table "IP location: other country, US vs site IN") and the teleport case (Motion 16 inconsistent in red, "GPS jumped 14.0 km in 5 s while the phone stayed still", a dashed red jump line, mismatch cells). **Capture artefact, not investigated:** the lower part of both case-file captures shows page content from behind the drawer.
**NOT verified (needs the phone):** the real carrier's resolution and distance, a real VPN exit, the browser's real network information on your phone, the real motion sensor, the APK and full-screen, the tunnel, the ngrok warning page.

## Bugs and surprises found by running it

- Harness: starting a pytest run with `&` inside a background Bash call detaches it; it survived and two runs wrote into one file. Use one `run_in_background` command per run, never `&`.
- Backend full run is much slower than the 5 min recorded in Phase 8 (the accuracy-report tests alone took > 10 min on a loaded machine).

## Open

| Item | Detail |
|---|---|
| Fingerprint for the real site | 0 learned rows. Needs 3 accepted phone visits with the recording on and motion allowed (see M2). The user's own backend must be restarted once first |
| One complete `npm run e2e` | not captured after the last fixes (see Measured); re-run on a quiet machine |
| `edge-validator-ai` review | not invocable in this session: nothing in iteration 1 has been reviewed by it |
| Real carrier / VPN behaviour | needs the phone and the public URL (iteration 2): the IP rules were verified on REAL database records, not on a real phone network |
| Consent sentence, 30-day retention, the shortened IP being stored even for a worker who declined the recording | the owner's decisions (draft wording) |
| Spoofer behind a same-country VPN is missed 13% of the time (SYNTHETIC) | by construction only the motion signal sees them |
| `SitesPanel.jsx` | unused, can be deleted |
