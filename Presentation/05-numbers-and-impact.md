# Numbers cheat sheet and impact model

Everything here is traceable to a file in the repo or a cited source. **R** = REAL, **S** = SYNTHETIC (simulator or generated degradation), **A** = an assumption you must replace with the platform's real figure.

## 1. Industry context (public sources)

| Fact | Source |
|---|---|
| Awign describes a community of 1.5 million+ gig partners across 12,000+ pin codes (older material says 1 million+ across 500+ cities); work includes auditing, due diligence, invigilation, last-mile delivery, telecalling | [Awign on Built In](https://builtin.com/company/awign), [Entrepreneur India](https://india.entrepreneur.com/technology/this-gig-startup-strives-to-crack-indias-employment-puzzle/438266) |
| NITI Aayog projects India's gig workforce growing from 7.7 million to 23.5 million by 2029-30 (about 4.1% of the workforce) | [NITI Aayog report coverage, IndBiz](https://indbiz.gov.in/indias-gig-economy-to-have-23-5-million-workers-by-2029-30-niti-aayog/) |
| GPS spoofing for attendance fraud takes about 90 seconds and a free app on Android; the top 10 spoofing apps on Google Play exceed 50 million downloads (vendor blog claims) | [TrackoField](https://trackobit.com/blog/gps-spoofing-and-buddy-punching), [Incognia](https://www.incognia.com/blog/who-is-faking-location-the-bad-actors-using-location-spoofing-to-swindle-geolocation-based-apps) |

Caveat for the stage: the spoofing statistics come from vendor blogs and the Awign figures from marketing/press; cite them as "reported", not as audited facts. No Awign-internal fraud rate is available in this repo.

## 2. The industry problem in three lines

1. **Proof of work is a photo plus a GPS point.** Both are forgeable: a stock/old/duplicate/screen photo, a mock-location app.
2. **Manual audit does not scale.** 7.7M → 23.5M gig workers by 2030 (NITI Aayog); re-checking every submission by hand is impossible, so sampling lets fraud through.
3. **Hard blocks hurt honest workers.** Rejecting on one weak signal (indoor GPS, a VPN, a dark room) strands people who did the job. So the answer must be *evidence + explanation + review*, not a hard rule.

## 3. How we prove the solution works (and with what)

| Claim | Evidence | R/S |
|---|---|---|
| Blurry photos are caught on-device | Blur AUC 0.990 (CI 0.975-1.000); 96/98 flagged; 77/98 hard-blocked; 1/106 good photos blocked | R (stock `good/`, 98 real blurry) |
| Too-dark photos | 31/31 caught, AUC 0.997, 4/106 false flags | R |
| Low resolution | 22/23, 0 false flags | R |
| Shake is harder | 79/120 = 66% recall, AUC 0.972 | R |
| Glare / noise / over-exposed / obstruction | 100% / 100% / 92% / 72% recall | S |
| Same verdict on phone and server | 100% (37/37); metric difference median ≤ 1.3% | R |
| Server re-check is fast | p50 323 ms, p95 422 ms (30 photos, median 2.8 MP) | R |
| Live HUD is smooth | UI tick p50 9.4 ms / p95 13.7 ms; UI stall 300 ms → 17 ms with the Web Worker | R (laptop headless) |
| Burst beats a single shot | 92% vs 20% on an adversarial stream | S |
| Teleport spoof caught on a real phone | Flagged at 100%: "GPS jumped 22.2 km in 7 s while the phone stayed still" | R (1 phone) |
| Foreign VPN caught on a real phone | UK exit, 8,044 km, env 0.21, flagged: "The network is in GB, the site is in IN" | R (1 phone) |
| Home network accepted | Hathway AS17488, Bengaluru, 10 km, env 1.0 | R |
| Fusion classifier (in-distribution) | recall 94% (CI 91-97%), honest flagged 3%, AUC 0.984, ECE 0.020 | S |
| Fusion classifier (new seed) | 94% / 4% / AUC 0.979 | S |
| Fusion classifier (shifted world) | 80% / 5% / AUC 0.919 | S |
| Which signal matters | Permutation AUC loss (base 0.919): motion 0.272, environment 0.158, motion_known 0.083, photo 0.013 | S |
| Classifier is monotone | Fine-grid check: guard needed in 0 of 21 rows; SHAP fallback 0 of 600 random inputs | S |
| Quality of engineering | Client 281 tests, backend 525 passed, e2e 361 PASS / 0 FAIL / 32 scenarios, fusion parity 13/13 (104 values), e2e fusion 60 / layout 38 / fullstack 13 / review 7 / fusion_demo 5 | R |

## 4. Impact model (illustrative arithmetic, replace the assumptions)

Per **1,00,000 submissions**. Assumptions **A**: bad-evidence rate **3%**, value of one bad task paid or delivered **₹200**, cost of one human review **₹10** (about 2 minutes). Accuracy rows reuse the table above; case B is a pessimistic what-if.

| | A: shifted-world accuracy (S) | B: pessimistic what-if | C: in-distribution (S) |
|---|---|---|---|
| Recall on bad submissions | 80% | 40% | 94% |
| Honest workers sent to review | 5% | 8% | 3% |
| Bad submissions | 3,000 | 3,000 | 3,000 |
| Caught (true flags) | 2,400 | 1,200 | 2,820 |
| Honest flagged (false flags) | 4,850 | 7,760 | 2,910 |
| Total sent to review | 7,250 (7.25% of volume) | 8,960 | 5,730 |
| Precision of a flag | 33% | 13% | 49% |
| Bad payouts avoided (₹200 each) | ₹4,80,000 | ₹2,40,000 | ₹5,64,000 |
| Review cost (₹10 each) | ₹72,500 | ₹89,600 | ₹57,300 |
| **Net per 1,00,000 submissions** | **≈ ₹4.07 lakh** | **≈ ₹1.50 lakh** | **≈ ₹5.07 lakh** |
| Per 10 lakh submissions | ≈ ₹40.7 lakh | ≈ ₹15.0 lakh | ≈ ₹50.7 lakh |

**Formulas:** `net = recall × bad × task_value − (recall × bad + FPR × honest) × review_cost`. Break-even precision = `review_cost ÷ task_value` = ₹10 ÷ ₹200 = **5%**; every row above is well above it.

**Reading it honestly:**
- The 3%, ₹200 and ₹10 are assumptions. The result scales linearly: at 1% fraud case A nets ≈ ₹1.0 lakh per lakh; at 5% ≈ ₹7.1 lakh.
- Low prevalence makes flag precision modest (33% in case A). That is why the product is a **review queue with explanations**, not an auto-reject.
- Baseline "photo + GPS only" catches ~0% of pure mock-location spoofs by construction. In the simulator, removing the motion input drops fraud caught to 28% (S, iteration-1 ablation).
- Not counted: client trust/SLA cost of a fraudulent audit, faster payouts for honest workers (auto-accept without human touch), and the cost of a fraud ring detected via duplicate/near-duplicate photo hashes.
- Review load is controllable: raising the P(fraud) threshold above 0.5 trades recall for fewer reviews. The threshold sweeps are in the accuracy report.

## 5. Honest limits to repeat if asked "what's not proven?"

1. Fusion classifier accuracy is simulated; the 94% → 80% drop between worlds shows fragility.
2. One real phone (Oppo F19 Pro), one place, one day; mobile-data carrier behaviour was not measured (no data plan).
3. Liveness APCER/BPCER on real spoofs: not evaluated. Face false-reject on clear selfies: unknown. Fairness slices: none.
4. `good/` photos are stock photography; real worker captures are the missing evidence.
5. A modified client or emulator can inject sensor streams; an accomplice at the site passes the network check; a spoofer behind a same-country VPN is missed ~13% in simulation.
6. Privacy decisions (consent text, 30-day retention, who sees coordinates) are the owner's; mechanisms exist and default to safe.
