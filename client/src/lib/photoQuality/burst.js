// Burst capture: take a handful of frames around the shutter press and keep the
// best one. A single frame can land in a motion-blurred instant; the sharpest of
// six rarely does.
import { THRESHOLDS } from './config.js'
import { blurMetrics } from './checks/blur.js'
import { resizeGray, rgbaToGray } from './frame.js'
import { sensorShake } from './checks/shakeSensor.js'

// How steady the phone was in a window of motion samples: 1 = still, ->0 = shaking.
export function steadiness(samples) {
  const s = sensorShake(samples)
  if (!s || s.rotRms == null) return 1
  return 1 / (1 + s.rotRms / 20)
}

// Sharpness of a frame given as gray pixels; flat frames (nothing to judge) get a
// low-but-nonzero score so a textured frame always beats them.
export function frameSharpness(gray, width, height, size = THRESHOLDS.live.burst.scoreSize) {
  const r = resizeGray(gray, width, height, size)
  const m = blurMetrics(r.gray, r.width, r.height, THRESHOLDS.blur)
  return m.score ?? 0.01
}

// candidates: [{ sharpness, motion? , ...anything }]. Combines image sharpness with
// how steady the phone was at that instant. Returns the winner (a copy carrying its
// `score` and its `index` in `candidates`), or null.
export function pickBest(candidates) {
  if (!candidates.length) return null
  const scored = candidates.map((c, index) => ({ ...c, index, score: c.sharpness * steadiness(c.motion) }))
  return scored.reduce((a, b) => (b.score > a.score ? b : a))
}

// Gray frame from RGBA pixels (a canvas readout).
export const grayOf = (rgba, w, h) => rgbaToGray(rgba, w * h)
