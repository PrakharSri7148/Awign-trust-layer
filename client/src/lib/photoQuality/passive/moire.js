// Moire / pixel-grid detector. A camera filming a display sees the screen's pixel grid beating against its own
// sensor grid: a few NARROW, ISOLATED peaks in the 2-D spectrum at high frequencies. Natural texture is broadband.
//
// Algorithm (the Python port photo_quality/passive.py is the same, step for step; a parity test pins it):
//   1. centre-crop the gray patch to n x n (n = the largest power of two <= min(w, h), at most `size`), subtract the mean,
//      apply a separable Hann window, take the 2-D FFT magnitude M.
//   2. consider the half plane (fy > 0, or fy = 0 and fx > 0) inside the band  n*bandLo <= r <= n*bandHi  (r = |(fx, fy)|
//      in cycles per patch), skipping the axis cross (|fx| or |fy| < axis: image edges and borders live there) and the
//      bins at JPEG / video block-grid harmonics (both |fx| and |fy| within 1 bin of a multiple of n/8 or n/16).
//   3. isolation ratio of a bin = M / max(M at the 8 neighbours 4 bins away, median M of the band): a narrow peak scores
//      high, a ridge from a straight edge (whose neighbours along the ridge are high) or broadband texture does not.
//   4. score = the largest isolation ratio; also the number of bins >= peakAt.
import { THRESHOLDS } from '../config.js'
import { fftMagnitude2d, floorPow2 } from './fft.js'

const NEIGH = [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [3, -3], [-3, 3], [-3, -3]]

export function moireMetrics(gray, width, height, cfg = THRESHOLDS.passive.moire) {
  const n = Math.min(cfg.size, floorPow2(Math.min(width, height)))
  if (n < 64) return { score: null, peaks: 0, n: 0, reason: 'patch too small' }
  const x0 = Math.floor((width - n) / 2)
  const y0 = Math.floor((height - n) / 2)
  const img = new Float64Array(n * n)
  let mean = 0
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) mean += gray[(y0 + y) * width + x0 + x]
  mean /= n * n
  const hann = new Float64Array(n)
  for (let i = 0; i < n; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) img[y * n + x] = (gray[(y0 + y) * width + x0 + x] - mean) * hann[y] * hann[x]
  const M = fftMagnitude2d(img, n)

  const signed = (k) => (k <= n / 2 ? k : k - n)
  const at = (fx, fy) => M[(((fy % n) + n) % n) * n + (((fx % n) + n) % n)]
  const rLo = n * cfg.bandLo
  const rHi = n * cfg.bandHi
  const g8 = n / 8
  const g16 = n / 16
  const nearMultiple = (v, g) => { const m = Math.abs(v) % g; return Math.min(m, g - m) <= 1 }

  const cand = []
  const bandVals = []
  for (let ky = 0; ky <= n / 2; ky++) {
    for (let kx = 0; kx < n; kx++) {
      const fy = ky
      const fx = signed(kx)
      if (fy === 0 && fx <= 0) continue
      const r = Math.hypot(fx, fy)
      if (r < rLo || r > rHi) continue
      if (Math.abs(fx) < cfg.axisExclude || Math.abs(fy) < cfg.axisExclude) continue
      if ((nearMultiple(fx, g8) && nearMultiple(fy, g8)) || (nearMultiple(fx, g16) && nearMultiple(fy, g16))) continue
      cand.push([fx, fy])
      bandVals.push(M[ky * n + kx])
    }
  }
  if (!cand.length) return { score: null, peaks: 0, n, reason: 'empty band' }
  const sorted = Float64Array.from(bandVals).sort()
  const bandMedian = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  let best = 0
  let bestAt = null
  let peaks = 0
  for (let i = 0; i < cand.length; i++) {
    const [fx, fy] = cand[i]
    const m = bandVals[i]
    let nb = bandMedian
    for (const [dx, dy] of NEIGH) { const v = at(fx + dx, fy + dy); if (v > nb) nb = v }
    const ratio = m / (nb > 0 ? nb : 1e-12)
    if (ratio >= cfg.peakAt) peaks++
    if (ratio > best) { best = ratio; bestAt = [fx, fy] }
  }
  const period = bestAt ? n / Math.hypot(bestAt[0], bestAt[1]) : null
  return { score: best, peaks, n, at: bestAt, periodPx: period }
}
