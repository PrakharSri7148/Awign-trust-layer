// Camera steadiness from the PICTURE itself: how far the whole image moved between two live
// frames. Works on any camera (laptops and phones without a gyroscope, browsers that hide the
// motion sensors); the gyro, when present, is combined with this (see liveMetrics.js).
//
// Method: both frames are shrunk to a 160-px-wide thumbnail and the best whole-image translation
// is found by block matching (sum of absolute differences over +-maxShift px) with a parabola
// fit for sub-pixel accuracy. Motion is reported as a % of the frame width per `perMs`
// (200 ms, the live tick), so a skipped tick doesn't read as double motion.
import { THRESHOLDS } from '../config.js'
import { resizeGray } from '../frame.js'
import { STATUS, ramp } from '../schema.js'

export function makeThumb(gray, width, height, w = THRESHOLDS.shake.optical.thumbWidth) {
  return resizeGray(gray, width, height, w)
}

// Mean absolute difference between cur(x,y) and prev(x+dx, y+dy) over the area both cover.
function sad(prev, cur, w, h, dx, dy, m) {
  let s = 0
  let n = 0
  for (let y = m; y < h - m; y += 1) {
    const yp = (y + dy) * w
    const yc = y * w
    for (let x = m; x < w - m; x += 1) {
      s += Math.abs(cur[yc + x] - prev[yp + x + dx])
      n++
    }
  }
  return s / n
}

// Returns { dx, dy, pct, reliable } or null if the thumbnails are not comparable.
// `pct` = shift length as % of the thumbnail width (before time normalisation).
export function estimateShift(prev, cur, cfg = THRESHOLDS.shake.optical) {
  if (!prev || !cur || prev.width !== cur.width || prev.height !== cur.height) return null
  const { width: w, height: h } = cur
  const R = cfg.maxShift
  const m = R + 1
  if (w <= 2 * m + 4 || h <= 2 * m + 4) return null
  const size = 2 * R + 1
  const surf = new Float32Array(size * size)
  let best = Infinity
  let worst = -Infinity
  let bx = 0
  let by = 0
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const v = sad(prev.gray, cur.gray, w, h, dx, dy, m)
      surf[(dy + R) * size + (dx + R)] = v
      if (v < best) { best = v; bx = dx; by = dy }
      if (v > worst) worst = v
    }
  }
  // A texture-less scene matches everywhere: there is nothing to measure.
  const reliable = worst - best >= cfg.minContrast
  // Sub-pixel refinement: fit a parabola through the minimum and its two neighbours on each axis.
  const refine = (c, lo, hi) => {
    const d = lo - 2 * c + hi
    return d > 1e-6 ? (lo - hi) / (2 * d) : 0
  }
  const at = (dx, dy) => surf[(dy + R) * size + (dx + R)]
  const sx = bx > -R && bx < R ? refine(at(bx, by), at(bx - 1, by), at(bx + 1, by)) : 0
  const sy = by > -R && by < R ? refine(at(bx, by), at(bx, by - 1), at(bx, by + 1)) : 0
  const dx = bx + sx
  const dy = by + sy
  // A best match on the edge of the search window means the motion is AT LEAST that big.
  const saturated = Math.abs(bx) === R || Math.abs(by) === R
  return { dx, dy, pct: (Math.hypot(dx, dy) / w) * 100, reliable, saturated }
}

// prev/cur: thumbnails; elapsedMs between them (null = assume one tick).
export function opticalMotion(prev, cur, elapsedMs = null, cfg = THRESHOLDS.shake.optical) {
  const e = estimateShift(prev, cur, cfg)
  if (!e || !e.reliable) return null
  const k = elapsedMs ? cfg.perMs / Math.max(50, elapsedMs) : 1
  const pct = e.pct * k
  const status = pct >= cfg.failPct ? STATUS.FAIL : pct >= cfg.warnPct ? STATUS.WARN : STATUS.PASS
  return { pct, dx: e.dx, dy: e.dy, status, score: ramp(pct, cfg.failPct * 1.5, 0) }
}

// Where the status changes, in score (bar) coordinates.
export const opticalTicks = (cfg = THRESHOLDS.shake.optical) => ({
  warn: ramp(cfg.warnPct, cfg.failPct * 1.5, 0) * 100,
  fail: ramp(cfg.failPct, cfg.failPct * 1.5, 0) * 100,
})
