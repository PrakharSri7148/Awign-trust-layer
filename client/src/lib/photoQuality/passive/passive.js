// Combines the passive screen / print signals into one 0..1 "looks like a picture of a picture" score.
// Each signal is evidence with its own false-positive causes (see the individual files), so they are combined
// with a noisy-OR of weighted signals: one strong signal can raise a flag, no single heuristic decides.
// KEEP the photo part (moire + bezel) in sync with backend/photo_quality/passive.py (parity test).
import { THRESHOLDS } from '../config.js'
import { ramp } from '../schema.js'
import { bezelMetrics } from './bezel.js'
import { moireMetrics } from './moire.js'

const P = () => THRESHOLDS.passive

export const moireSignal = (m, cfg = P().moire) => (m?.score == null ? null : ramp(m.score, cfg.warn, cfg.fail))

// signals: { moire: {score}, bezel: {score}, banding: {score}, planar: {planar}, glareFace: {overlap} } (any may be missing)
export function passiveScore(signals, cfg = P()) {
  const w = cfg.weights
  const parts = {
    moire: moireSignal(signals.moire, cfg.moire),
    bezel: signals.bezel?.score ?? null,
    banding: signals.banding?.score ?? null,
    planar: signals.planar?.planar == null ? null : signals.planar.planar ? 1 : 0,
    glareFace: signals.glareFace?.overlap == null ? null : ramp(signals.glareFace.overlap, cfg.glareFace.warnOverlap, cfg.glareFace.fullOverlap),
  }
  let keep = 1
  const used = []
  for (const [k, v] of Object.entries(parts)) {
    if (v == null) continue
    used.push(k)
    keep *= 1 - w[k] * v
  }
  const score = used.length ? 1 - keep : null
  const status = score == null ? 'unknown' : score >= cfg.failAt ? 'fail' : score >= cfg.warnAt ? 'warn' : 'pass'
  return { score, status, parts, used }
}

// The part computable from ONE photo (also what the server recomputes): moire on a native patch + the frame detector.
export function passiveFromFrame(frame, faceBox = null) {
  const p = frame.native?.patches?.[0]
  const moire = p ? moireMetrics(p.gray, p.width, p.height) : { score: null }
  const bezel = bezelMetrics(frame.gray, frame.width, frame.height, faceBox)
  return { moire, bezel }
}
