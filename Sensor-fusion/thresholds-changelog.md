# fusion.json: change log

Every threshold in `client/src/lib/sensorFusion/fusion.json` is a **starting value, uncalibrated** (chosen from physical reasoning, tested on a simulator). Record every change here with the evidence for it, as `edge-validator/thresholds-changelog.md` does for the photo checks. The accuracy report prints the sha256 of the file in section 5b.

| Date | Change | Evidence | Effect |
|---|---|---|---|
| 2026-10-08 | Initial values (iteration 1) | none yet: physical reasoning + simulator | uncalibrated |
| 2026-10-08 | `geo.accMaxUsableM` 100 -> 50, `geo.errorAllowanceFactor` 2.0 added, `consistency.walkSpeedMinMs` 0.8 -> 0.6 | the simulator's indoor-drift scenario (stationary phone, 25-55 m GPS error) raised "GPS moving, phone still" in 16 of 18 rows with the first values; at the new values 0 of 18 (SYNTHETIC) | fewer false accusations indoors; slow walkers at poor accuracy become "ambiguous" (no evidence) instead of "moving" |
| 2026-10-08 | `consistency.jumpMotionShare` 0.25 added | one handling bump near a jump (the faker picking the phone up) flipped the verdict from "flat" to "moving" in the simulator | a jump counts as "phone still" when at most 25% of the surrounding windows show movement |
