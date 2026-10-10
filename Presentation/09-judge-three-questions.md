# The three judge questions: answers to speak from

Written for: hackathon judges (and the teammate who will present). Each answer has a 30-second spoken version, then the proof behind it, then the follow-up the judge is most likely to ask.

Labels: **R** = measured by us on real photos or the real phone. **S** = our simulator. **A** = an assumption to replace with the platform's figure. **EXT** = public source, linked at the bottom (vendor claims are marked as such). Nothing below is invented; where we have no evidence it says so.

---

## Q1. Problem statement quality: is it a good and difficult problem?

### Say this (30 seconds)

> "Every gig platform pays for one thing: proof. Proof of work today is a photo and a GPS point. A free mock-location app moves a phone anywhere in about 90 seconds, so a perfect photo plus a fake GPS point passes a photo-and-GPS check. By construction, that check catches roughly none of it. The obvious fix, blocking on suspicion, takes money from honest workers, because a dark room, indoor GPS or a VPN looks like fraud too. So the problem is: verify at scale, from the worker's own phone, without a black-box score and without punishing the honest. And it is hard for a reason we proved while building it: four of our own early assumptions broke the first time they met real data."

### Part A. It is a real problem (market and scale)

| Proof | Number | Source |
|---|---|---|
| India's gig workforce is about to triple | 7.7 million to 23.5 million by 2029-30, 4.1% of the workforce | EXT NITI Aayog |
| The buyers are many and large | Large Indian field-work platforms report workforces in the millions; one reports 1.5 million+ gig partners across 12,000+ pin codes | EXT press (reported, not audited) |
| Location spoofing is cheap and common | About 90 seconds and a free Android app; the top 10 spoofing apps exceed 50 million downloads | EXT vendor blogs (TrackoField, Incognia): say "reported" |
| It is measured on real platforms | On food-delivery driver apps one vendor saw 11.9 million spoofed-location events from 80,000 devices in H1 2022, and spoofing is 6.5 times higher there than on other apps. | EXT Incognia report (vendor data) |
| Fraud is a standing tax on every organization | Organizations lose about 5% of revenue to fraud; schemes run about 12 months before discovery | EXT ACFE Report to the Nations |
| Photo evidence itself is now forgeable at no skill | Generative AI can create, enhance or erase visual evidence "with just a few prompts"; about 1 in 10 property-casualty losses includes fraud | EXT SAS, May 2026 |
| The money is on the line at the platform | Under India's Code on Social Security (in force 21 Nov 2025), aggregators in notified categories contribute 1-2% of annual turnover, capped at 5% of what they pay workers. Every rupee of wasted payout is now a larger share of a platform's margin | EXT |

Be straight about one thing: we have **no platform-specific fraud rate**. Say "give us your number and we plug it into our model in a minute" and show the impact table in `05-numbers-and-impact.md`.

### Part B. It is difficult (why this is not a weekend hack)

**1. The attacker's cost is near zero and the defender's cost is per submission.** A free app defeats the point-check. Defence has to be paid on every task.

**2. Every single signal is weak, so no rule works alone.**

| Signal | Why it fails alone |
|---|---|
| GPS | One free app fakes it |
| Photo | A real photo of the wrong place, or of a screen, passes quality checks |
| Network / IP | Coarse. We measured it: Cloudflare's 103.21.244.1 resolves to Toronto in the IP database, and mobile carriers resolve far from the phone **R** |
| Device attestation | Helps, but is not complete. Public tooling exists to bypass the weaker tiers, so the guidance is to combine it with other signals (EXT Fingerprint, on Play Integrity) |

The answer has to be **agreement across channels**, which is a fusion problem, not a rule.

**3. A false alarm costs a livelihood.** For gig workers, refusing to be processed can mean losing income (EXT: the DPDP legal commentary says exactly this). So the system must treat *unknown as neutral*, flag instead of block, and give a reason a human can check. That is a harder design target than "maximise recall".

**4. There are no labels.** Platforms do not know which submissions were fake, so you cannot just train a model. We built a physics-based simulator, and the gap shows: **94% recall in the simulator, 80% in a shifted one (S)**. That fall is the honest measure of how hard the real problem is.

**5. The platform is the phone, and the phone is a constrained, hostile, private place.**
- A web page cannot read WiFi or cell towers, and cannot track in the background.
- Low-end phones, weak networks: the photo must be judged on-device in a few milliseconds (live HUD p50 9.4 ms **R**).
- Location history is personal data. India's DPDP Rules were notified 14 Nov 2025, with most obligations applying after 18 months (EXT). Privacy has to be in the design, not added later.

**6. The proof of difficulty from our own build** (strongest line, because no one can argue with it):

| What we hit | What happened | Fixed? |
|---|---|---|
| Standard blur metric | A plain white wall and a clean whiteboard scored 0.0 and were refused as "too blurry". The textbook Laplacian-variance idea fails on honest photos of clean scenes **R** | Yes: edge-steepness ÷ contrast per tile |
| Our classifier | Worse network evidence gave a *lower* fraud score in one band (env 0.17 gave P(fraud) 0.06; env 0.24 gave 0.95), and one input crashed SHAP's additivity check into a 500 | Yes: monotone constraints plus a runtime guard |
| The simulator | A real Oppo phone on a table read as "moving": a constant 0.22 m/s² accelerometer offset. The simulator never produced it **R** | Yes, in browser and server code |
| IP geolocation | A hard distance rule would flag honest carrier users | Yes: lenient distance, never flags alone |

> "A problem where your first three instincts fail on real data is a hard problem."

### Likely follow-ups

- **"Isn't this just GPS spoof detection?"** No. Detecting a mock provider is one input. Our unit of proof is *consistency between the body (motion), the place (network) and the evidence (photo)*. A spoofer has to fake all three consistently.
- **"Can't Android's own attestation do this?"** It is one signal and has known bypasses at the lower tiers. We treat it as a native-app add-on, not a foundation.
- **"Where's your fraud rate?"** We do not have one and say so. That is why the pilot ships in shadow mode first (see Q3).

---

## Q2. Solution depth: did you research before you chose this?

### Say this (30 seconds)

> "We did not start with a model. We started by asking what a faker cannot easily fake, and tested each alternative before choosing. We looked at what competitors sell, at the public data on spoofing, at the legal regime, and at the physics of each sensor. Then we measured: 106 good and 98 blurry real photos to set photo thresholds, an IP database whose own error we measured, and a real Android phone that ran a genuine walk, a mock-location spoof and a UK VPN. The design came out of the rejections: we rejected hard blocking, a single big model, trusting the client, face recognition and an LLM, each for a reason we can state."

### Part A. What we researched, and what each finding changed

| We looked at | What we found | Design decision it caused |
|---|---|---|
| **Competitors.** Incognia (location identity), Truepic (secure camera / provenance), IDfy (India verification) | Each owns one channel: location/device, photo provenance or identity documents. None, as far as we found, combines photo, motion and network in one explainable case file for field-task proof | Our wedge is the *fusion*, plus a reviewer-ready reason |
| **How spoofing works.** Mock-location apps, VPNs, emulators, instrumentation, app tampering (EXT Incognia lists these five) | Most attacks change one input only | Check the *physics linking inputs*: if GPS jumps 22 km in 7 s, did the body accelerate? |
| **Provenance cameras (Truepic-style)** | Strong, but needs a secure-capture SDK; says nothing about where the phone was | We keep the photo on-device first, then re-check it on the server, and add motion and network |
| **Device attestation** | Not complete; bypass tooling exists for the weaker tiers | Treat as optional native add-on, not the foundation |
| **Physics of each sensor** | Walking is a 1.2-2.8 Hz rhythm; GPS error is bounded by what a body can do; a faked path has no jitter, constant accuracy or ruler-straight lines | Gait detection and "too perfect GPS" rules |
| **IP geolocation data (DB-IP)** | Coarse. We checked on the real files: Cloudflare's address resolves to Toronto | Lenient distance, learned per-site profile, never flags alone |
| **Photo metrics** | Laplacian variance fails on clean scenes (measured) | Own blur metric, calibrated on real photos |
| **Law and ethics** | DPDP Rules 2025; location is personal data; refusal can cost livelihood | Consent screen, 30-day coordinate retention, unknown = neutral, flag don't block |

### Part B. The alternatives we rejected (shows judgement)

| Option | Why we did not choose it |
|---|---|
| Block on any suspicious signal | Strands honest workers (indoor GPS, dark rooms, VPN, quiet highway rides) |
| One big end-to-end neural net | No real labels to train it; a black box a reviewer cannot use; can lower risk for worse evidence. We use pretrained MediaPipe where deep learning helps and classical signal processing elsewhere |
| Trust what the app says | The client can be forged. The server recomputes every check; a mismatch is itself a flag |
| Face *recognition* | Not needed and a privacy and fairness risk. We only test that a live face is present |
| An LLM in the pipeline | Not needed for evidence, hard to audit. None runs in the product |
| Native app first | Slower to adopt. The web app reaches workers today, and the Android app is a wrapper on the same code. WiFi/cell fingerprinting is the planned native add-on |
| Background tracking | Heavy on privacy. We record only the approach while the app is open, with consent |

### Part C. The evidence we gathered (all in the repo)

| Evidence | Result | Label |
|---|---|---|
| Real photo calibration | 106 good and 98 blurry photos; blur AUC 0.990; 96 of 98 flagged; 1 of 106 good blocked | R |
| Too-dark photos | 31 of 31 caught, AUC 0.997 | R |
| Phone and server agree | 100% (37 of 37) | R |
| Real phone, genuine walk | Accepted (Bengaluru, 10 km from site, env 1.0) | R, 1 phone |
| Real phone, mock-location teleport | Flagged 100%: "GPS jumped 22.2 km in 7 s while the phone stayed still" | R, 1 phone |
| Real phone, UK VPN | Flagged: exit 8,044 km from site | R, 1 phone |
| Ablation | Remove motion and caught fraud falls to 28%; permutation AUC loss: motion 0.272, environment 0.158, photo 0.013 | S |
| Engineering | 281 client tests, 525 backend tests, 361 end-to-end checks passing, JS-to-Python parity 13/13 | R |
| Ran end to end on the public internet | Single HTTPS address through a tunnel, preflight table, rehearsal against a public-mode build | R |

### What not to say

Do not say "accuracy 94%" without the word *simulated*. Do not say "tested on workers". Say "tested on one real phone and 200+ real photos".

### Likely follow-ups

- **"Did you talk to real users?"** Honest answer: we built on public data, vendor reports and our own measurements; we have not yet interviewed platform ops teams or reviewers. Say the pilot's first week does that. Do not claim interviews you have not done.
- **"Why not just buy Incognia?"** It is an SDK for consumer and fintech apps. It does not read the photo, and it is not built around a field-task reviewer's case file. We are complementary at worst, and could integrate it as another input.
- **"Why classical CV instead of deep learning?"** Edge speed, explainability, and no labelled data. We add a small CNN once we have real labelled captures (it is on the roadmap).

---

## Q3. Is it fundable?

### Say this (30 seconds)

> "Investors have already funded each piece of this, separately. Incognia raised $31 million for location identity, Truepic raised $26 million from Microsoft's fund for photo authenticity, and IDfy raised $52 million plus $23 million more this year at roughly a quarter-billion-dollar valuation, in India. We are the first to combine photo, motion and network into one explainable verdict for field work. It needs no hardware and no SDK, so a customer can try it in a day. And the unit economics work: on stated assumptions a platform nets about ₹4 lakh per lakh submissions, so we can charge under a fifth of that value and still return more than five times the spend."

### Lines you can speak (pick any 3 to 4)

- "This is a category investors have already paid for. Location trust, photo trust and identity trust have each raised tens of millions of dollars. Field-work proof sits between them and nobody has combined the three."
- "The buyer's maths is simple: for every rupee they pay us, they save about five. A product that returns five times its price does not need to be convinced twice."
- "It needs no hardware and no SDK. It runs on the phone the worker already has, so a customer can try it in a day. That is why sales cycles are short."
- "The more it is used, the better it gets. Every reviewer decision becomes a real label, so our data advantage grows with every customer and a late entrant starts from zero."
- "Two rules are pushing demand: platforms now contribute to worker social security, so wasted payouts hurt more, and privacy law rewards checking on the device instead of hoarding data."
- "We are not asking you to believe a slide. It runs end to end on a public address, and a real phone caught a GPS spoof and a foreign VPN."

### Part A. Funded comparables (the money has already moved)

| Company | What they sell | Funding (EXT) | Proof of demand |
|---|---|---|---|
| **Incognia** | Location identity and spoofing detection | $31M Series B, Jan 2024 (Bessemer; Point72, Prosus, FJ Labs) | Tripled revenue, 200% net revenue retention, 100% trial conversion; 200% growth reported Jan 2025 |
| **Truepic** | Secure camera, photo provenance for insurers, banks | $26M Series B, Sept 2021 (Microsoft's M12; Adobe, Sony); about $36M total | Revenue 4x in 2020; 100+ enterprise customers |
| **IDfy** (India) | Identity verification, fraud detection | $52M Series F, Feb 2026 (Neo Asset Management); $23M more June 2026 at about $250M valuation | Proves Indian investors fund India trust infrastructure |

Message: *location, photo and identity trust are each funded categories; field-task proof sits between them and nobody has taken it in India.*

### Part B. Market tailwinds

| Tailwind | Figure | Source |
|---|---|---|
| India frontline-worker technology | $0.49B (2025) to $2.13B (2031), 28.9% CAGR | EXT Research and Markets |
| India field service management | $339.6M (2025) to $726.4M (2030), 16.4% CAGR | EXT MarketsandMarkets |
| Gig workforce | 7.7M to 23.5M by 2029-30 | EXT NITI Aayog |
| Regulation raises the cost of waste and of careless data | Social Security Code in force; DPDP Rules notified | EXT |
| Generative AI makes photo evidence cheaper to fake | Insurers now treat it as a new threat class | EXT SAS, May 2026 |

Market-size reports differ widely by method; quote the range, not one number.

### Part C. Unit economics (all assumptions labelled)

From `05-numbers-and-impact.md` (per 1,00,000 submissions, assuming a 3% bad rate, ₹200 per bad task, ₹10 per review **A**):

| | Pessimistic (40% recall) | Shifted world (S) | In-distribution (S) |
|---|---|---|---|
| Net value to the platform per lakh submissions | ₹1.50 lakh | ₹4.07 lakh | ₹5.07 lakh |
| = value per submission | ₹1.50 | ₹4.07 | ₹5.07 |

**Illustrative price: ₹0.75 per verified submission (A, ours to choose).**

| | Pessimistic | Shifted world | In-distribution |
|---|---|---|---|
| Return to customer on spend (value ÷ price) | 2.0x | 5.4x | 6.8x |
| Our price as a share of value created | 50% | 18% | 15% |

**Revenue, illustrative (A):**

| Submissions per year | At ₹0.75 | At ₹1.00 |
|---|---|---|
| 1 crore | ₹75 lakh | ₹1.0 crore |
| 5 crore | ₹3.75 crore | ₹5.0 crore |
| 13.3 crore | ₹10 crore | ₹13.3 crore |

We do not know any platform's real volume. Ask for it; do not guess on stage.

**Cost to serve:** no GPU, no special hardware; the server photo re-check takes p50 323 ms and p95 422 ms **R** on a laptop CPU. We have not costed it in the cloud, so say "very low, to be measured in the pilot". Per-submission cost is the number to verify before quoting a margin.

**Why customers would adopt fast:** the web app plus a wrapper app on the same code means no SDK integration, and the shadow-mode pilot (flag only, auto-reject off) carries no risk to honest workers.

### Part D. Why this can become a company, not a feature

| Moat | Why it compounds |
|---|---|
| **Labelled data flywheel** | Every reviewer decision becomes a real label. Retraining unlocks at 200 reviewed cases, 50 per class. A competitor starts with a simulator, we start with their platform's labels |
| **Per-site learned network profile** | Learned only from trusted visits, so it improves with use and a spoofer cannot teach it |
| **Explainable, auditable decisions** | Monotone model plus SHAP plus a plain sentence. Enterprise buyers and regulators ask for that |
| **Edge-first, privacy-by-design** | Matches DPDP direction; the photo can be rejected without leaving the phone |
| **Fraud-ring graph** | Duplicate and near-duplicate photo hashes link repeat submissions across workers |

### Part E. Milestones that turn this into a fundable plan

| Phase | What happens | Evidence it produces |
|---|---|---|
| 0 to 3 months | Shadow-mode pilot with one pilot platform; real labels start | First real recall and false-flag rate, replacing the simulator |
| 3 to 6 months | Retrain on 200+ reviewed cases; fairness slices on faces and lighting; native Android plugin for WiFi, cell and mock-provider flag | Moves the classifier from SYNTHETIC to REAL; closes the biggest evasion gap |
| 6 to 12 months | Two or three paying platforms; synthetic-image detector for AI-made photos | Revenue, retention, price validated |


### The honest risks (say them first, it raises trust)

| Risk | Our answer |
|---|---|
| No revenue and no customer yet | Right: that is why the first step is a shadow-mode pilot (flag only, no risk to workers) |
| Accuracy is from a simulator | True, labelled everywhere. The pilot replaces it with real labels in 3 months |
| Well-funded rivals could enter this space | Their SDKs target consumer and fintech; our wedge is field-task proof, with photo, motion and network in one case file |
| Determined attackers with modified clients can inject sensor streams | We raise the cost of cheating; native attestation and the label flywheel raise it further |
| Privacy and regulation | Consent, retention limit, edge-first; wording and period need a lawyer's review |
| Single phone tested | Said openly; the pilot expands device coverage |

### Likely follow-ups

- **"What's the business model?"** Per verified submission, with a platform fee tier and a premium for the review dashboard. Pilot is free or at cost.
- **"Who is your first customer?"** Any platform that pays for field proof: gig and workforce platforms, audit and inspection firms, delivery and merchant-verification companies, insurers' field surveys.
- **"Why you?"** The system already runs end to end on a public HTTPS address with tests, and a real phone caught the spoof and the VPN. We did the part that is usually a slide.

---

## One slide per question (copy-ready)

| | Headline | Three bullets |
|---|---|---|
| **Q1** | "Proof of work is a photo and a point. Both can be faked for free." | 90-second spoof with a free app (reported); 7.7M to 23.5M gig workers by 2030; our own build broke 4 early assumptions on real data |
| **Q2** | "We studied the attacks, the competitors, the law and the physics, then measured." | Rejected 7 shortcuts with reasons; 200+ real photos and a real phone; honest labels: R, S, A |
| **Q3** | "The categories are funded. The gap in the middle is ours." | $31M, $26M, $52M+$23M in adjacent categories; about 5x return for the customer at ₹0.75 a task; shadow pilot to real labels in 3 months |

---

## Sources (EXT)

- NITI Aayog gig workforce: https://indbiz.gov.in/indias-gig-economy-to-have-23-5-million-workers-by-2029-30-niti-aayog/
- Incognia delivery-app spoofing report (vendor): https://www.incognia.com/newsroom/incognia-mobile-app-fraud-insights-report-reveals-food-delivery-apps-are-major-target-for-location-based-fraud
- Incognia $31M Series B: https://www.helpnetsecurity.com/2024/01/31/incognia-funding-31-million/
- Incognia revenue growth: https://www.incognia.com/newsroom/incognia-triples-revenue-with-demand-for-location-identity-solutions
- Truepic $26M Series B: https://www.dig-in.com/articles/microsoft-backs-image-verification-startup
- IDfy $52M Series F: https://www.fintechfutures.com/venture-capital-funding/indian-regtech-idfy-bags-52m-in-series-f-round
- IDfy $23M at $256M valuation (June 2026): https://www.biometricupdate.com/202606/indian-identity-verification-firm-idfy-raises-23m-at-256m-valuation
- India field service management / workforce market sizes: https://www.marketsandmarkets.com/Market-Reports/geography/field-service-management-market/India
- India frontline worker technology: https://www.researchandmarkets.com/reports/6261151/india-frontline-worker-technology-market-share
- ACFE Report to the Nations: https://www.accountingtoday.com/news/organizations-lose-5-to-fraud-each-year
- AI-generated image fraud in insurance (SAS): https://www.sas.com/en_us/news/press-releases/2026/may/synthetic-images-ai-insurance-fraud.html
- Code on Social Security, aggregator contribution: https://www.taxmann.com/post/blog/analysis-aggregator-obligations-code-on-social-security/
- DPDP Rules 2025 and gig workers: https://ksandk.com/data-protection-and-data-privacy/data-privacy-risks-hr-tech-gig-platforms/
- Play Integrity limitations: https://fingerprint.com/blog/google-play-integrity-apis/
- GPS-spoofing attendance fraud, 90 seconds: https://trackobit.com/blog/gps-spoofing-and-buddy-punching
