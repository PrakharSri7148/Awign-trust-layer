// Display flicker / banding: a screen filmed by a rolling-shutter camera shows horizontal luminance bands that
// DRIFT from frame to frame (the refresh and the sensor readout beat). Evidence needs several frames.
//   rowProfile(gray, w, h)         mean luminance per row with the slow trend (scene gradient) removed, in % of the mean
//   bandingEvidence(profiles)      energy, periodicity and how far the pattern moves per frame
import { THRESHOLDS } from '../config.js'

export function rowProfile(gray, w, h) {
  const p = new Float64Array(h)
  let mean = 0
  for (let y = 0; y < h; y++) {
    let s = 0
    for (let x = 0; x < w; x++) s += gray[y * w + x]
    p[y] = s / w
    mean += p[y]
  }
  mean /= h
  const k = Math.max(3, Math.round(h / 8)) | 1 // moving-average window removes the scene's own slow gradient
  const half = (k - 1) / 2
  const out = new Float64Array(h)
  for (let y = 0; y < h; y++) {
    let s = 0, n = 0
    for (let j = Math.max(0, y - half); j <= Math.min(h - 1, y + half); j++) { s += p[j]; n++ }
    out[y] = mean > 0 ? ((p[y] - s / n) / mean) * 100 : 0
  }
  return out
}

const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)

// normalised autocorrelation peak of a profile at lags 3..h/2 (periodic bands -> high; scene content -> low)
function periodicity(p) {
  const n = p.length
  let c0 = 0
  for (let i = 0; i < n; i++) c0 += p[i] * p[i]
  if (c0 <= 1e-9) return { r: 0, lag: null }
  let best = 0, lag = null
  for (let L = 3; L <= Math.floor(n / 2); L++) {
    let c = 0
    for (let i = 0; i + L < n; i++) c += p[i] * p[i + L]
    const r = c / c0
    if (r > best) { best = r; lag = L }
  }
  return { r: best, lag }
}

// the circular shift (rows) that best aligns profile b onto a
function bestShift(a, b, maxShift) {
  const n = a.length
  let best = -Infinity, s0 = 0
  for (let s = -maxShift; s <= maxShift; s++) {
    let c = 0
    for (let i = 0; i < n; i++) c += a[i] * b[(((i + s) % n) + n) % n]
    if (c > best) { best = c; s0 = s }
  }
  return s0
}

// Works on the DIFFERENCE of consecutive row profiles: the static scene (a face, a shirt, a shelf) cancels out and what
// remains is whatever changed between frames. Drifting display bands leave a periodic residual; a moving person leaves a
// non-periodic one; a static striped shirt leaves nothing. (An autocorrelation of the raw profile is dominated by the
// scene and missed a clearly visible band in the first end-to-end run.) Aliasing: a band that advances exactly one
// period per frame cancels too; real flicker beats at a rate unrelated to the frame rate, so it does not stay locked.
export function bandingEvidence(profiles, cfg = THRESHOLDS.passive.banding) {
  if (!profiles || profiles.length < cfg.minFrames) return { score: null, frames: profiles?.length ?? 0, reason: 'need more frames' }
  const diffs = []
  for (let i = 1; i < profiles.length; i++) diffs.push(profiles[i].map((v, y) => v - profiles[i - 1][y]))
  const energies = diffs.map(rms)
  const per = diffs.map(periodicity)
  const shifts = []
  for (let i = 1; i < diffs.length; i++) shifts.push(bestShift(diffs[i - 1], diffs[i], Math.floor(diffs[i].length / 4)))
  const energy = energies.reduce((a, b) => a + b, 0) / energies.length
  const periodic = per.reduce((a, b) => a + b.r, 0) / per.length
  const driftRows = shifts.length ? [...shifts.map(Math.abs)].sort((a, b) => a - b)[Math.floor(shifts.length / 2)] : 0
  const banded = energy >= cfg.energyPct && periodic >= cfg.periodicity
  const score = banded ? Math.min(1, energy / cfg.full) * Math.min(1, periodic / 0.7) : 0
  return { score, frames: profiles.length, energyPct: energy, periodicity: periodic, driftRows, banded, drifting: energy >= cfg.energyPct }
}
