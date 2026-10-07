import { THRESHOLDS } from '../config.js'
import { resizeGray } from '../frame.js'
import { STATUS, checkResult, ramp } from '../schema.js'
import { box3, percentile } from '../stats.js'

// Local max - min over a (2r+1) square window, separable.
function localRange(g, w, h, r = 3) {
  const hi1 = new Float32Array(w * h)
  const lo1 = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hi = -1
      let lo = 1e9
      for (let k = -r; k <= r; k++) {
        const v = g[y * w + Math.min(w - 1, Math.max(0, x + k))]
        if (v > hi) hi = v
        if (v < lo) lo = v
      }
      hi1[y * w + x] = hi
      lo1[y * w + x] = lo
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hi = -1
      let lo = 1e9
      for (let k = -r; k <= r; k++) {
        const i = Math.min(h - 1, Math.max(0, y + k)) * w + x
        if (hi1[i] > hi) hi = hi1[i]
        if (lo1[i] < lo) lo = lo1[i]
      }
      out[y * w + x] = hi - lo
    }
  }
  return out
}

const AXIS = { 0: 'horizontal', 2: 'vertical' }

// Camera shake smears detail along ONE direction: edges whose normal points
// along the motion go soft while edges across it stay sharp. Defocus softens
// every orientation equally, and a sharp photo has the same edge steepness at
// every orientation whatever the scene contains. So: measure edge steepness
// (gradient / local contrast) per orientation and look at the spread.
export function shakeMetrics(gray, width, height, cfg = THRESHOLDS.shake) {
  const r = resizeGray(gray, width, height, cfg.maxSide)
  const g = r.gray
  const W = r.width
  const H = r.height
  const sm = box3(g, W, H)
  const gxA = new Float32Array(W * H)
  const gyA = new Float32Array(W * H)
  const mag = new Float32Array(W * H)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const gx = (sm[i - W + 1] + 2 * sm[i + 1] + sm[i + W + 1] - (sm[i - W - 1] + 2 * sm[i - 1] + sm[i + W - 1])) / 4
      const gy = (sm[i + W - 1] + 2 * sm[i + W] + sm[i + W + 1] - (sm[i - W - 1] + 2 * sm[i - W] + sm[i - W + 1])) / 4
      gxA[i] = gx
      gyA[i] = gy
      mag[i] = Math.hypot(gx, gy)
    }
  }
  const range = localRange(sm, W, H, 3)
  const thr = Math.max(percentile(mag, 0.93), 1)
  const bins = [[], [], [], []]
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] < thr || range[i] < cfg.minLocalRange) continue
    let th = Math.atan2(gyA[i], gxA[i])
    if (th < 0) th += Math.PI
    bins[Math.round(th / (Math.PI / 4)) % 4].push(mag[i] / range[i])
  }
  const minCount = cfg.minBinFrac * W * H
  const usable = bins
    .map((a, dir) => ({ dir, n: a.length, s: a.length >= minCount ? percentile(a, 0.75) : null }))
    .filter((b) => b.s != null)
  if (usable.length < 2) return { aniso: null, usable: usable.length, bins: bins.map((a) => a.length) }
  const sharpest = usable.reduce((a, b) => (b.s > a.s ? b : a))
  const softest = usable.reduce((a, b) => (b.s < a.s ? b : a))
  // Edges whose normal points along the motion are the softest, so the motion is
  // along the softest orientation and across the sharpest. Only name a direction
  // when those are perpendicular axes; diagonal bins are populated by thin arcs
  // and curved edges and are too noisy to read a direction from.
  const clear = AXIS[softest.dir] && sharpest.dir === (softest.dir + 2) % 4
  return {
    aniso: sharpest.s / softest.s,
    direction: clear ? AXIS[softest.dir] : null,
    usable: usable.length,
    bins: bins.map((a) => a.length),
  }
}

export function checkShake(frame) {
  const t = THRESHOLDS.shake
  const m = shakeMetrics(frame.gray, frame.width, frame.height)
  if (m.aniso == null) {
    return checkResult('shake', { status: STATUS.SKIP, details: { reason: 'not_enough_edges', ...m } })
  }
  const status = m.aniso >= t.failAniso ? STATUS.FAIL : m.aniso >= t.warnAniso ? STATUS.WARN : STATUS.PASS
  return checkResult('shake', {
    status,
    score: ramp(m.aniso, t.failAniso + 0.3, 1.1),
    value: m.aniso,
    hint:
      status === STATUS.PASS
        ? null
        : `Camera moved while shooting${m.direction ? ` (${m.direction} blur)` : ''}. Hold the phone with both hands, brace your elbows and tap.`,
    details: m,
  })
}
