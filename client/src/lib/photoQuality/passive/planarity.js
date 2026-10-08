// Planarity: the landmarks of a FLAT picture (a photo, a screen) move between two views as ONE homography; a real 3-D
// face does not (nose, ears and cheeks sit at different depths, so turning the head shifts them differently).
// planarity(ptsA, ptsB): fit a homography A -> B by DLT (least squares) and report the residual, in face-widths,
// next to how much the face actually moved. Meaningful only when it moved: with no motion it says "unknown".
import { THRESHOLDS } from '../config.js'

// Solve the small normal equations (8x8) by Gaussian elimination with partial pivoting.
function solve(A, b) {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array(n)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}

function fitHomography(a, b) {
  // h33 = 1; for each pair: [x y 1 0 0 0 -x*u -y*u] h = u ; [0 0 0 x y 1 -x*v -y*v] h = v   (normal equations)
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0))
  const Atb = new Array(8).fill(0)
  const add = (row, rhs) => {
    for (let i = 0; i < 8; i++) { Atb[i] += row[i] * rhs; for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j] }
  }
  for (let i = 0; i < a.length; i++) {
    const [x, y] = a[i]
    const [u, v] = b[i]
    add([x, y, 1, 0, 0, 0, -x * u, -y * u], u)
    add([0, 0, 0, x, y, 1, -x * v, -y * v], v)
  }
  const h = solve(AtA, Atb)
  return h && [...h, 1]
}

const apply = (h, [x, y]) => {
  const d = h[6] * x + h[7] * y + h[8]
  return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d]
}

// ptsA/ptsB: [[x, y], ...] in normalised image coordinates (same index = same landmark). faceWidth: normalised.
export function planarity(ptsA, ptsB, faceWidth, cfg = THRESHOLDS.passive.planarity) {
  if (!ptsA || !ptsB || ptsA.length !== ptsB.length || ptsA.length < cfg.minPoints || !(faceWidth > 0)) return { planar: null, reason: 'not enough points' }
  let motion = 0
  for (let i = 0; i < ptsA.length; i++) motion += Math.hypot(ptsB[i][0] - ptsA[i][0], ptsB[i][1] - ptsA[i][1])
  motion = motion / ptsA.length / faceWidth
  if (motion < cfg.minMotion) return { planar: null, motion, reason: 'face did not move enough' }
  // work in face-width units around the centroid so the fit is well conditioned
  const cx = ptsA.reduce((s, p) => s + p[0], 0) / ptsA.length
  const cy = ptsA.reduce((s, p) => s + p[1], 0) / ptsA.length
  const norm = (p) => [(p[0] - cx) / faceWidth, (p[1] - cy) / faceWidth]
  const a = ptsA.map(norm)
  const b = ptsB.map(norm)
  const h = fitHomography(a, b)
  if (!h) return { planar: null, motion, reason: 'degenerate' }
  let r = 0
  for (let i = 0; i < a.length; i++) {
    const p = apply(h, a[i])
    r += (p[0] - b[i][0]) ** 2 + (p[1] - b[i][1]) ** 2
  }
  const residual = Math.sqrt(r / a.length)
  // verdict on the residual RELATIVE to the motion: a flat picture leaves ~0 (simulated: 0.000), a simulated 3-D face
  // leaves 1.2-1.4 of it. A face that only SLIDES sideways (no rotation) also leaves ~0: that is why this is weak evidence.
  const rel = residual / motion
  return { planar: rel <= cfg.planarRelBelow ? true : rel >= cfg.organicRelAbove ? false : null, residual, motion, rel }
}
