# Environment Consistency: 20 judge questions with technical answers

Component: "does the network around this phone fit the claimed place?" (`backend/fusion/environment.py`, `ipctx.py`, public-mode serving). Output: `environment_consistency` in [0,1] (stored as `ambient_score`) + `env_known` + a plain sentence.

Label rule: **REAL** = real device / real database records. **SYNTHETIC** = our simulator or its labels. The classifier that turns the score into a decision is trained on the simulator.

---

**Q1. What problem does this solve that GPS and motion don't?**
A spoofer can fake location *and* even motion, but not **where their internet connection physically enters the network**. The request's public IP carries a country, region and operator (ASN); a worker "at a Bengaluru site" whose request comes from a Singapore data-centre exit, or a US ISP, is contradicting the claim with evidence they don't control from the app. It is a third, independent physical channel: radio/network geography.

**Q2. Why IP geolocation and not WiFi SSIDs or cell towers?**
A web page physically cannot read them: browsers expose no SSID, BSSID or cell ID (only coarse `effectiveType/downlink/rtt`). So on web we use IP context + a learned per-site link profile + time zone. The server already accepts and scores a hashed `radio` field (WiFi BSSIDs / cell IDs) with weight 0.6 when there is no overlap with the site's known set; only a native Android app can send it. We said this to ourselves and in the docs: it's the planned upgrade, not a hidden gap.

**Q3. Which signals go into the score and with what weights?**
All in `fusion.json`: IP country differs from site `ipCountry` 0.7; IP > 300 km from site `ipFar` 0.35 (lenient, because carriers resolve far); hosting/VPN/datacentre ASN `hosting` 0.3; link class never seen at this site `linkUnseen` 0.2; ASN never seen `asnUnseen` 0.2; time-zone offset > 4 h from the claimed longitude `tz` 0.1; with no site registered, IP vs the phone's own GPS `ipFarGps` 0.15; native radio no overlap 0.6. Combined by noisy-OR like the motion score. Unknown evidence → 0.5, `env_known = false`.

**Q4. How do you know which IP is the caller's? Isn't X-Forwarded-For spoofable?**
Nothing is trusted unless configured. `TRUSTED_PROXY_HEADER` (+ `TRUSTED_PROXY_HOPS`, default 1) names the header; for `x-forwarded-for` we take the entry that many places from the **right**, because each trusted proxy appends what it saw and anything the client wrote on the left is ignored. A header from a direct caller with nothing configured is ignored; malformed headers fall back to the socket address; ports, `[v6]:port` and `::ffff:` forms are normalised. A warning logs if the last 30 requests all came from one non-routable address (an untrusted-proxy misconfiguration).

**Q5. How accurate is IP geolocation? Why should anyone trust it?**
We don't over-trust it, and we measured it on the **real** DB-IP lite files: 8.8.8.8 → Mountain View / Google; 193.0.14.129 → Amsterdam / RIPE NCC; a Bengaluru broadband IP → Bengaluru / Atria. But anycast/CDN addresses resolve to the operator's registration, not where traffic entered: 1.1.1.1 → Sydney, Cloudflare 103.21.244.1 → Toronto, Google's IPv6 test address → Montreal; some IPs have a city record and no ASN record (handled). Hence the lenient distance rule (300 km, weight 0.35): a far-but-same-country address **never flags by itself**; a wrong *country* or a hosting network is the strong evidence.

**Q6. What is the "learned site fingerprint", and how do you stop it being poisoned?**
Per site we learn what the network normally looks like (link-speed class buckets from `effectiveType`, `downlink`, `rtt`; ASNs seen). Poisoning defence: a visit only teaches the profile if it was **accepted AND the phone's movement was compared with the GPS trail AND motion consistency ≥ 0.8** (`learnMinMotion`). A spoofer who slips through with low motion consistency cannot make their own network "normal". Until `profileMin` = 3 trusted visits exist, the "unseen network" checks are off. A reviewer approval (human decision) can also teach it, and a "forget the learned network" endpoint exists with a change log.

**Q7. How do you treat VPNs? A lot of honest users have them.**
Hosting/VPN ASN is detected by provider keywords (amazon, aws, azure, digitalocean, ovh, hetzner, datacamp, nordvpn, mullvad, vpn, proxy, datacenter...) and scored 0.3 only. Rehearsal with REAL addresses forwarded in a header: a Mumbai Amazon exit (honest same-country VPN) → environment 0.455, P(fraud) 0.02-0.08, **accepted**; a Singapore DigitalOcean exit → environment 0.21, P = 0.99-1.00, **flagged** "The network is in SG, the site is in IN". Policy: a VPN is not an accusation; a *foreign-country* exit is flagged **for review, not rejected**.

**Q8. Is "foreign network = review" a measured fact or a choice?**
A **policy assumption**, stated in the code: a worker whose network is in another country cannot be told apart from a spoofer behind that country's network, so the simulator labels it "send to review" (label 1). It's not measured fraud. The ground truth will come from reviewer decisions (the review table and reviewed-dataset exporter exist; they unlock at ≥ 200 reviewed cases with ≥ 50 per class).

**Q9. You found a defect in your own classifier. What was it?**
Found by a probe on 2026-10-08, SYNTHETIC model: the classifier was **non-monotone in the environment score**: a foreign VPN exit with env 0.17 got P(fraud) 0.06 while env 0.24 got 0.95. A *worse* environment lowered the fraud probability, because the old v1/v2 model had learned from a training set where the VPN scenario was labelled genuine. Also `score_submission` could raise a SHAP additivity error at env 0.60, i.e. a 500. Fixes: simulator relabelled and extended, switched to `HistGradientBoostingClassifier` with monotone constraints, a runtime guard (largest P over this and any higher environment score), and a SHAP fallback with `explanation: approximate`. Afterwards: fine-grid monotone = yes, guard needed in 0 of 21 rows, fallback rate 0 of 600 random inputs.

**Q10. How do you model IP-database error in the simulator, with what evidence?**
Published where it exists: MaxMind reports ~99.8% country-level accuracy and ~63% of US IPs within 50 km (so ~37% farther). We use 37% displaced IPs (median 120 km, lognormal shape is an **assumption**) and 2% wrong country (10× MaxMind for a lite database: **assumption**). India-specific figures could not be retrieved and were not invented. A shifted world uses 4% / 50% / 200 km to test robustness.

**Q11. What was tested on a real phone for this component?**
REAL (Oppo F19 Pro, Android 13, through the ngrok tunnel, home WiFi): network check showed Hathway Cable and Datacom (AS17488), Bengaluru, **10 km** from the site, environment 1.0, no flags. **UK VPN (Turbo VPN)**: server saw GB/London, Datacamp Limited (AS212238), `vpn_or_hosting` true, 8,044 km from the site, environment 0.21, flags `anonymizing_network` + `ip_country_mismatch`, and a real submission was **flagged**. **GPS spoof with a mock-location app**: flagged at **100%**, "GPS jumped 22.2 km in 7 s while the phone stayed still". Not done, stated openly: mobile-data reading (no data plan), same-country VPN (no India exit offered), APK.

**Q12. Give me the rehearsal table.**
REAL addresses through the REAL DB-IP files, SYNTHETIC classifier (`npm run e2e netsection`, 29 checks):

| Address | Env | P(fraud) | Result |
|---|---|---|---|
| Bengaluru broadband 106.51.0.1 | 1.00 | 0.00 | accepted |
| US, Google 8.8.8.8 | 0.30 | 0.83 | flagged |
| Singapore, DigitalOcean 159.65.0.1 | 0.21 | 1.00 | flagged |
| Mumbai, Amazon 13.126.0.1 | 0.455 | 0.08 | accepted |
| Navi Mumbai carrier 49.44.0.1 | 0.65 | 0.05 | accepted (far, weak) |

Honest wart: a foreign ISP alone sits at P = 0.60 vs the 0.5 line, a model value, not a safe margin; the VPN case is the dependable demo.

**Q13. How is the demo deployed so judges can really reach it?**
Single origin: the FastAPI backend serves the **built client and the API from one HTTPS address** through an ngrok static-domain tunnel from the laptop (`demo/demo-up.sh`, backend on 127.0.0.1:8002 with its own demo DB). No CORS, no mixed content. `PUBLIC_MODE=1` refuses to start unless `DASHBOARD_TOKEN`, `TRUSTED_PROXY_HEADER`, `TRUST_LAYER_DB`, the model and the IP DB are present. `preflight.py` is a green/red table, exit 0 only if nothing is red. The Android TWA (Bubblewrap) is written but was skipped by choice; the demo runs in Chrome on the phone.

**Q14. What hardening does public mode apply?**
No `/docs`; exact-origin CORS; request-size caps; security headers incl. `Permissions-Policy` (geolocation, camera, motion for this origin only); per-worker rate limit (120/hour default); logs without IPs or tokens; the test IP provider refuses to load; the production client makes no third-party requests (fonts fall back to system). Known gap: no CSP and no `X-Frame-Options` yet (needs a pass over inline styles).

**Q15. What do you store about the IP, legally and ethically?**
Only a **shortened** IP: IPv4 last octet zeroed, IPv6 keeps /48, plus the city; `purge_trails.py` removes both after the retention period. Responses never contain a raw IP; `/env/check` returns a masked IP and never the site's coordinates. Data is DB-IP lite under CC BY 4.0: the credit "IP Geolocation by DB-IP" with a link is displayed wherever the data is shown. Consent sentence and the 30-day retention are drafts for the owner to approve.

**Q16. How can an attacker beat this component?**
(1) A spoofer with an **accomplice at the site** whose network is genuine; (2) a spoofer behind a **same-country VPN** (SYNTHETIC: missed 13%; by construction only the motion signal sees them); (3) tethering to a local hotspot; (4) a modified client sending a forged `radio` field. Mitigation is layering: network is one of three independent channels, and a determined, hardware-capable attacker is out of scope for a web client. We say that, we don't hide it.

**Q17. Why include a second channel at all if motion already catches teleports?**
Because they fail differently. Permutation importance on the deployed model: removing the environment score costs −0.158 AUC (base 0.919) in the shifted world; before the IP database, wrong-area network fraud was missed 62-68% (SYNTHETIC), which is exactly what this channel was built to cover. Motion catches "GPS says I'm there, my body didn't go"; environment catches "my connection is somewhere else", including a spoofer who *does* move realistically.

**Q18. What happens with no site registered, a private IP, or a brand-new site?**
No site: the case file says "No site is registered for this task"; the IP is only compared with the phone's own GPS at weight 0.15; accepted if nothing else is wrong. Private/loopback/link-local/CGNAT (100.64/10, which Python's `is_private` misses: a real bug we found) is "unavailable", never "far". New site (< 3 trusted visits): learned-profile checks are off. All of these produce `env_known = false`, score 0.5, never a flag for lack of data. We never seed a fake site: it would flag every demo submission made elsewhere.

**Q19. How do you make sure a site's location itself can't be tampered with?**
Only the company sets a site (`PUT /sites/{id}`, dashboard token required); the worker can't. Every create/move/edit is written to a `sitechange` log with old → new, distance moved and whether the learned network was forgotten (default tick-box only for moves > 1 km). The "Register this spot" tool keeps an existing site's radius/country/label and refuses a move over 1 km (it once wiped a country field: a bug we found and fixed).

**Q20. Where is the AI, and how does this connect to Physical AI?**
The score is signal processing + geolocation lookups; the **learning** is (a) the per-site fingerprint learned online from trusted visits (a form of continual calibration to the physical environment), and (b) the fusion classifier (monotone gradient-boosted trees + SHAP) that weighs it against motion and photo evidence. In Physical AI terms, we ground a digital claim in three physical channels: kinematics (IMU), optics (camera) and radio/network geography (this component). Not deep learning; interpretable and auditable by design. Roadmap: native WiFi/cell fingerprinting and calibration of weights from reviewer-labelled real visits.
