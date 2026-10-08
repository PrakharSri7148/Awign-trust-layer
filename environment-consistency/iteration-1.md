# Environment consistency (the "ambient fingerprint"): iteration 1, hackathon edition

Date: 2026-10-08
Status: **implemented and verified 2026-10-08** (evidence and open items: `progress.md`). Live state: [`progress.md`](progress.md). Prompt that implements this: [`iteration-1-prompt.md`](iteration-1-prompt.md). The packaging, deployment and rehearsal work is [`iteration-2.md`](iteration-2.md); after iteration 2 the **only** thing left is testing on the phone.
Audience: you (section 1 is your to-do list), then the engineer / agent who implements it.

This replaces the earlier long plan. It keeps only what a **real** hackathon demo needs, and section 4 lists everything that was cut, with the reason, so nothing is silently missing. The cut items are parked at the end for after the hackathon.

---

## 0. The rule for this plan: the demo is real

"Real" means the judges watch real inputs go through the real code. Nothing on screen is faked.

| Part | In the demo |
|---|---|
| The phone's GPS, motion sensors, camera and network | **real**, from your Android phone |
| The IP lookup (country / region / provider / VPN) | **real**, from the DB-IP database, on the phone's real public IP, seen by a backend that is reachable from the internet |
| The site | **real**: you register the actual place you will stand |
| The site's learned network profile | **real**: built from real accepted visits, never seeded |
| A "foreign network" case | **real**: a real VPN app on the phone with an exit in another country |
| A "GPS spoof" case | **real**: a real mock-location app (or a DevTools override) on the phone |
| The dashboard | **live data only**; the DEMO chip (mock data) is **off** |
| The fraud classifier | **real code, trained on simulated data.** The judges are told this. Its training data is the authors' simulator, not real fraud cases |
| What a web page cannot do | WiFi names and cell towers are not readable by a browser. Said out loud, not hidden |

Anything fake that exists is **test-only** (fake IP provider in automated tests) and the server refuses to run with it in public mode.

## 1. What I need from you (the minimum)

| # | What | Needed for | If missing |
|---|---|---|---|
| **M1** | **DONE 2026-10-08.** The DB-IP files are in `backend/data/geoip/` (`dbip-city-lite-2026-10.mmdb`, `dbip-asn-lite-2026-10.mmdb`). Restart your own backend on 8000 once so it loads them (the provider is detected at start-up) | E2, E3 on real data | |
| **M2** | **DONE (values received).** Site `site_demo_1` (the id the Capture page hard-codes, `Capture.jsx:28`) = your house: lat **12.9259481**, lng **77.6722586**, country **IN**, radius **100 m** (you gave 80; 100 is recommended because indoor GPS drifts 20-50 m, and it is editable in the new Site panel). Registered by **you**, not by the agent (the agent never writes to your real database): after E4 use the Site panel, or right now run the `curl` just below this table | E4 | |
| **M3** | OK to add one sentence about the network / IP to the consent text (draft in E6)? Default: yes | E6 | consent stays silent about the IP |

To register your house **today** (works with the existing backend; add `-H "Authorization: Bearer <token>"` if `DASHBOARD_TOKEN` is set; run it against your own backend, then restart it if you have not since M1):

```bash
curl -X PUT http://localhost:8000/sites/site_demo_1 -H 'Content-Type: application/json' \
  -d '{"lat": 12.9259481, "lng": 77.6722586, "radius_m": 100, "country": "IN", "label": "Home (test)"}'
```

Nothing blocks iteration 1 any more except M3, which defaults to yes. Iteration 2 needs a few more (section 1 of `iteration-2.md`).

## 2. Verified state today (2026-10-08, from the code, the database and two probes I ran)

| Fact | Evidence |
|---|---|
| The engine exists and is tested: per-site profile, IP rules, VPN/hosting rule, time zone, native-radio hook, "unknown is not suspicious" | `backend/fusion/environment.py` |
| IP database **installed 2026-10-08 14:33** (city 127 MB, ASN 9.6 MB; not yet verified with the reader on real records: that is E2). At planning time: 0 sites registered; 0 learned profiles; 10 submissions | folder listing, `sqlite3` |
| The Capture page uses one fixed site id, `site_demo_1`; there is no site picker and **no screen to change a site's location** (only `PUT /sites/{id}` with the dashboard token) | `Capture.jsx:28`, `main.py:342` |
| Until a site is registered and the backend restarted, submissions score a neutral 0.5 with `env_known = false` | follows |
| **DEFECT 1 (found today): the classifier is not monotone in the environment score.** With photo 0.9 and motion 0.97, P(fraud) is 0.06 for environment 0.00-0.15, jumps to **0.95** at 0.20-0.30, 0.70 at 0.35-0.40, 0.19 at 0.45-0.55 and 0.02 at 1.0. So a *worse* network can be judged *safer*. A foreign VPN exit (environment 0.17) gets P = 0.06 "No issues detected", while a foreign ISP (0.24) gets 0.95. The wrong-network demo would **not flag** the VPN case | probe, 21-point scan |
| **DEFECT 2 (found today): `score_submission` can crash.** The SHAP additivity check fails for some inputs (environment exactly 0.60 and one other value in a 101-point scan), which would make `POST /submissions` return a 500 | same scan |
| The client sends only `effectiveType`, `downlink`, `rtt` (Android Chrome only) and the UTC offset; consent text does not mention the network / IP | `lib/sensors.js`, `consent.js` |
| The dashboard already shows the IP line (city, region, country, provider, masked IP) and each environment component | `FusionSection.jsx:131` |
| `X-Forwarded-For` handling exists but trusts a header only when `TRUSTED_PROXY_HEADER` is set (correct); hops are not handled | `ipctx.client_ip` |

Expected results of the current engine for typical inputs (photo 0.9, motion 0.97, 4G, site profile known). These are **what the code does today**, before the fix:

| Case | Environment | P(fraud) today | Flags |
|---|---|---|---|
| At home, IP near the site, known provider | 1.00 | 0.02 | none |
| Mobile carrier whose IP resolves 350 km away | 0.65 | 0.07 | `ip_region_mismatch` (not flagged, correct) |
| VPN exit in India, 845 km away | 0.36 | 0.70 | `anonymizing_network`, `ip_region_mismatch` |
| **VPN exit in the Netherlands** | **0.17** | **0.06 (wrong)** | `ip_country_mismatch`, `anonymizing_network` |
| ISP in the US | 0.24 | 0.95 | `ip_country_mismatch` |
| No IP database, new site | 0.50 unknown | 0.04 | none |
| No IP database, known site, unseen link class | 0.80 | 0.09 | `network_unseen_at_site` |

## 3. Scope: what iteration 1 builds

| Phase | Scope | Exit criteria | Needs |
|---|---|---|---|
| **E0** Baseline | run `pytest`, `npm test`, `npm run build`, `fusion:parity`, `npm run e2e`; record numbers; reproduce DEFECT 1 and 2 as failing tests | numbers in `progress.md`; two failing tests that pin the defects | nothing |
| **E1** Fix the classifier (blocks the demo) | (a) make P(fraud) **non-increasing in the environment score** (other inputs fixed): add simulator scenarios that cover the low-environment range (foreign-country exit with a genuine-looking walk, datacenter/VPN honest and not honest) using labels that are documented as the authors' assumptions, retrain, and if sparse regions still bend the curve add a monotone guard (the largest P over higher scores) applied only when `env_known`; (b) make `score_submission` crash-proof: SHAP additivity failure falls back to a clearly marked approximate explanation, never a 500; (c) keep the previous model file for rollback (`fraud_classifier_v2_pre_env.pkl`) and `FUSION_MODEL` | a scan of the whole 0-1 range for each of several motion/photo settings shows P never rises as the environment score falls; 2000 random inputs never raise; the VPN-in-another-country case is flagged with its sentence; an honest VPN user in the **same** country is not flagged by the VPN alone; unknown (`env_known = false`) still never flags; v2 file still loads | nothing |
| **E2** IP data go-live | run the reader on the **real** DB-IP files: record shapes, IPv6, IP present in one database only, corrupt file never raises; `ipctx.status()` (provider, file date, age); `/health` returns it; startup warning when no database; DB-IP credit line shown in the dashboard footer and the case file; `fetch_geoip.py --check` warns when the files are older than 45 days; test with real files when present (skip with a clear message otherwise) | lookups of 10 well-known public IPs give the right country and provider (table in `progress.md`); status visible | **M1** |
| **E3** Truthful IP + self-check (needs M1: done) | `client_ip`: `TRUSTED_PROXY_HEADER` + `TRUSTED_PROXY_HOPS`, pick the correct entry of `X-Forwarded-For`, ignore the header from a direct caller, IPv6 and `::ffff:` forms; loopback/private address => IP rules "unavailable" (never "far"); a one-line warning if every request shares one address (a misconfigured proxy); **`GET /env/check?site_id=`**, enabled only by `ENV_CHECK=1`: returns the caller's own IP context (country, region, provider, VPN or not), km to the site, the environment score and the sentence. It is how you check, from the phone, what the server sees before you demo | table-driven tests for every header case; the endpoint returns 404 unless enabled and never returns the site's coordinates | nothing |
| **E4** Site location panel + no-site behaviour | **A "Site location" panel on the dashboard** (dashboard-token protected, like the other admin actions) so you can move the claimed area from the UI, e.g. from your house to the hackathon venue: (a) shows the current site (`site_demo_1`) with lat, lng, radius, country, label, last changed; if none is registered it says so and offers to create it; (b) editable fields with the backend's own validation messages (lat/lng range, radius 5-5000 m, 2-letter country); (c) **"Use my current location"** button (browser geolocation; on a phone it needs the HTTPS address) that fills lat/lng and shows the GPS accuracy, with a warning if the accuracy is worse than 50 m; (d) **"Forget the learned network for this site"** checkbox (uses the existing reset endpoint), **ticked by default when the new point is more than 1 km from the old one**, with a plain sentence explaining why (the home network would otherwise make the venue's network look "unseen"); (e) a confirm step that shows old values to new values before saving; (f) a **change log** (time, old to new, whether the network was reset) stored in a small table and listed under the form, so the site cannot be moved silently; (g) a distance sanity line ("this moves the site 9.4 km"). Also: the case file says "no site registered for this task" instead of silently saying nothing; when no site exists, compare the IP location with the submitted GPS position at a low weight, labelled as such. (h) **added 2026-10-08 at the user's request: the stored fingerprint is visible in the UI**: a "Learned network" section in the same panel (`GET /sites/{id}/profile`, token protected) that lists exactly what is stored for the site (link-speed classes, provider numbers, hashed WiFi/cell ids shortened; counts and last seen; "learned from N accepted visits" or "fewer than 3 visits"; the rule for what teaches it; no IP address is in it) and a standalone "Forget the learned network" button with a confirm step. No CSV import tool (the panel replaces it) | API tests (bad coordinates, token required, change log written, reset only when asked, old submissions keep the site coordinates they were scored with); component tests; **screenshots of the panel at phone and desktop widths, looked at and described**; a real run in the isolated e2e: register your house values, submit, move the site, reset, submit again | **M2 (done)** |
| **E5** Learning safety | a visit teaches the site profile only if it was accepted **and** the motion evidence was known with score >= 0.8; test that ten accepted-but-spoofed visits (flat motion) do not make their network "known" | poisoning test; existing reset endpoint still clears everything | nothing |
| **E6** Dashboard, consent, regression | Network section shows provider data age and "learned from N visits" / "site has fewer than 3 visits"; top-bar chip "IP database not installed" when missing; consent sentence (draft below); retention tool counts the new fields; full regression; accuracy report regenerated with the environment rows (SYNTHETIC) and the honest-worker false-flag line; docs | suites green vs E0 baseline; screenshots viewed at phone and desktop width and described; README "How scoring works" / "Known limitations" updated (R5 partial on web) | **M3** |

Draft consent sentence (added to the existing text; wording is yours to change): *"We also use your network connection details (your internet provider and approximate location from your IP address, and connection speed) to check that you are where you say you are. We store a shortened IP address for 30 days."*

## 4. Cut for the hackathon (each is something the demo does not depend on)

| Cut | Why it is safe to cut | Where it goes |
|---|---|---|
| CSV import of many sites (`import_sites.py`) | the demo has one site (`site_demo_1`) and the new Site panel edits it | parked (P1) |
| A site picker on the Capture page / several sites at once | the page uses one fixed id; you move that site between house and venue | parked (P1) |
| IP continuity across the visit, connection type, time-zone name, coarser link key | extra signals; the demo's wrong-network case is carried by country / region / provider / VPN | parked (P2) |
| Cold-start prior pooled across sites | the strongest rules (country, distance, VPN) need no profile; the "unseen network" demo needs 3 real visits at the demo site, which you do before judging | parked (P2) |
| Reviewer "confirm fraud" unlearns a profile | no reviewers in the demo; poisoning is already blocked by E5 | parked (P2) |
| Profile expiry, key caps, profile inspector | small data, short life | parked (P2) |
| Retrain on reviewed labels, real calibration of every weight | needs reviewers and weeks of data | parked (P3) |
| The 40-run network test protocol | replaced by the short phone test in `iteration-2.md` | parked (P3) |
| Native app / WiFi + cell radio | cannot be built in a web app; stated openly | parked (P4) |
| A demo IP switch that pretends the request came from another country | **removed from the plan**: it would make the demo fake. The real VPN on the phone replaces it | never |

## 5. Risks that remain after this iteration (say them, do not hide them)

1. **Mobile carriers resolve far away** (carrier-grade NAT). The 300 km distance rule is a guess. The short phone test (iteration 2) measures your own carrier; the weight is lenient (0.35) and a gateway-far honest visit stays unflagged in the probe above.
2. **A genuine on-site network proves nothing about the GPS.** Fraud with an accomplice at the site passes this signal.
3. **iPhone Safari exposes no link information**; for those users the signal is IP + time zone only.
4. **The classifier's training data is simulated.** Every accuracy number is SYNTHETIC.
5. **The weights are uncalibrated starting values** (`fusion.json`).
6. **Web pages cannot read WiFi / cell identifiers.**

## 6. Definition of done for iteration 1

- E0-E6 ticked in `progress.md` with evidence; M1-M3 done or the dependent phase marked blocked with exactly what is missing.
- From the dashboard you can register your house as `site_demo_1`, move it to another place, forget the learned network, and see the change log, without a terminal.
- DEFECT 1 and 2 fixed and pinned by tests; the whole 0-1 scan is monotone; no input can make `score_submission` raise.
- With the real database: a near-site visit scores >= 0.9 (`env_known`), a foreign-country IP and a foreign VPN exit are both flagged with a sentence, an honest same-country VPN is not flagged by the VPN alone, and none of these changes the status by a rule (only the classifier).
- Unknown never flags; malformed environment input never gives a 500.
- Suites green against the E0 baseline; everything labelled REAL or SYNTHETIC.
