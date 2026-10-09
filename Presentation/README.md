# Presentation pack: Trust Layer (hackathon)

Everything you need to present and defend the project. Every number was taken from the project's own records (`README.md`, `*/progress.md`, `edge-validator/reports/accuracy-report.md`, `environment-consistency/demo-runbook.md`) or a cited public source. Nothing was invented. Where something is unmeasured, the files say so.

| File | What it is | When to use it |
|---|---|---|
| [04-script-10-min.md](04-script-10-min.md) | The 10-minute end-to-end talk: problem, idea, Edge Validator, Sensor Fusion, Environment Consistency, decision + review loop, tests and challenges, impact, limits. Includes slide/demo cues and a 12-number cue card | Rehearse this first |
| [01-sensor-fusion-qa.md](01-sensor-fusion-qa.md) | 20 judge questions on GPS vs IMU fusion | Q&A prep |
| [02-environment-consistency-qa.md](02-environment-consistency-qa.md) | 20 judge questions on the network/IP channel and deployment | Q&A prep |
| [03-edge-validator-qa.md](03-edge-validator-qa.md) | 20 judge questions on on-device computer vision, face and liveness | Q&A prep |
| [05-numbers-and-impact.md](05-numbers-and-impact.md) | Every number with its source and REAL/SYNTHETIC label, the industry problem, and the impact model with formulas | When asked "how much does it help?" |
| [06-ai-stack-map.md](06-ai-stack-map.md) | Where the AI, computer vision and Physical AI are (and are not) | When asked "what AI is in here?" |

## Three rules that make you credible

1. **Say "simulated" every time you quote a classifier accuracy.** The fusion classifier (94% / 3% / AUC 0.98 in-distribution, 80% / 5% / AUC 0.92 in a shifted world) is trained and tested on our physics-based simulator. The real-world evidence is: photo checks on real photos (blur AUC 0.990), and one real phone (Oppo F19 Pro) running a genuine walk, a mock-location spoof (flagged 100%) and a UK VPN (flagged).
2. **Say the limit before the judge finds it.** One phone, no real liveness spoof samples, no fairness slices, a modified client can inject sensor streams.
3. **The impact table is arithmetic, not a measurement.** Say "assuming 3% bad submissions, ₹200 a task, ₹10 a review". The break-even precision is 5%.

## The one-paragraph pitch (memorize)

A field task claims a digital fact: *I was here, and this is what I saw.* We verify it against three physical channels the claimant doesn't fully control: **light** (computer vision on the photo, on the phone and re-checked on the server), **motion** (accelerometer and gyroscope against the GPS trajectory) and **network geography** (where the connection really enters the internet). A monotone gradient-boosted classifier with SHAP turns them into one explainable verdict, and flagged cases go to a human review queue that produces the first real labels.

## Not covered by this pack (do before the event)

- Idle-laptop `npm run demo:laptop` twice, and the backup video (N5 in `environment-consistency/progress.md`).
- Venue day: move the site to the venue, three genuine visits there so the learned network reads "3 of 3" (stage script: `environment-consistency/demo-runbook.md`).
- Replace the impact assumptions (3%, ₹200, ₹10) with the platform's real fraud rate, task value and review cost if you have them.
