# thresholds.json change log

Every accuracy report prints the first 12 characters of the SHA-256 of `client/src/lib/photoQuality/thresholds.json`
(`meta.thresholds_sha256`), so a number can always be tied to the thresholds that produced it. Add a line here whenever the file
changes (a threshold, a policy, a task). Logic changes that do not touch the file are listed too, because they move verdicts.

| Date | Change | Evidence | Where recorded |
|---|---|---|---|
| 2026-10 (calibration 2) | blur `failBelow` 0.14 → 0.16, `warnBelow` 0.21 → 0.25; shake `warnAniso` 1.4 → 1.25, `failAniso` 1.8 → 1.6; obstruction finger hue limit 50° → 32° (code) | 106 real good vs 218 blurred / 120 motion-blurred photos | progress.md, "Calibration run 2" |
| 2026-10 (Phase 7) | added `liveness`, `passive`, `live.hud.segments`, `policy.liveness`, task `live` (new keys only; no existing value changed) | none needed (new checks, starting values) | progress.md, Phase 7 |
| 2026-10-07 (Phase 8b) | **no value in thresholds.json changed.** Logic change: a face whose ONLY failure is the face-crop sharpness no longer blocks when the whole-photo focus does not fail (`softenCropBlur` / `soften_crop_blur`) | 168 real faces: blurry/shaky 0 of 88 lost; 1 of 7 dark-folder photos now warns; good unchanged. Whole-frame block line deliberately kept at 0.16 (0.14 would cost 12 points of blur recall) | progress.md, Phase 8b |
