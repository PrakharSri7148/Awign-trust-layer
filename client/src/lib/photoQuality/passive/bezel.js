// Screen / print frame detector: a phone or monitor (or a sheet of paper) showing a face appears as a LARGE rectangle
// inside the frame whose four edges are long straight lines with a consistent brightness step across them (dark bezel
// outside a bright screen, or a white paper margin around a darker picture). Heuristic, evidence only: a door, window,
// picture frame or a monitor BEHIND the person also makes rectangles, which is why a rectangle only counts when it is
// large and (when we know where the face is) contains the face. Mirrored line for line by photo_quality/passive.py.
import { THRESHOLDS } from '../config.js'

// Box-mean downscale by an integer factor so the cost is bounded and Python can do exactly the same.
export function downscaleGray(gray, w, h, maxSide) {
  const f = Math.max(1, Math.ceil(Math.max(w, h) / maxSide))
  if (f === 1) return { g: Float64Array.from(gray), w, h }
  const nw = Math.floor(w / f)
  const nh = Math.floor(h / f)
  const g = new Float64Array(nw * nh)
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let s = 0
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += gray[(y * f + j) * w + x * f + i]
    g[y * nw + x] = s / (f * f)
  }
  return { g, w: nw, h: nh }
}

function smooth3(a) {
  const o = new Float64Array(a.length)
  for (let i = 0; i < a.length; i++) o[i] = ((a[i - 1] ?? a[i]) + a[i] + (a[i + 1] ?? a[i])) / 3
  return o
}

// strongest local maximum >= thr inside [lo, hi] (indices); null if none. first=true -> the outermost candidate.
function pickLine(cov, lo, hi, thr, fromStart) {
  const idx = []
  for (let i = Math.max(2, lo); i <= Math.min(cov.length - 3, hi); i++) {
    if (cov[i] >= thr && cov[i] >= cov[i - 1] && cov[i] >= cov[i + 1] && cov[i] >= cov[i - 2] && cov[i] >= cov[i + 2]) idx.push(i)
  }
  if (!idx.length) return null
  return fromStart ? idx[0] : idx[idx.length - 1]
}

// faceBox: { x, y, w, h } normalised, optional.
export function bezelMetrics(gray, width, height, faceBox = null, cfg = THRESHOLDS.passive.bezel) {
  const { g, w, h } = downscaleGray(gray, width, height, cfg.maxSide)
  if (w < 40 || h < 40) return { score: 0, sides: 0, consistent: 0, found: false }
  const T = cfg.edgeStep
  const x0 = Math.floor(w * (1 - cfg.span) / 2), x1 = Math.ceil(w * (1 + cfg.span) / 2)
  const y0 = Math.floor(h * (1 - cfg.span) / 2), y1 = Math.ceil(h * (1 + cfg.span) / 2)
  const rowCov = new Float64Array(h)
  const colCov = new Float64Array(w)
  for (let y = 1; y < h - 1; y++) {
    let c = 0
    for (let x = x0; x < x1; x++) if (Math.abs(g[(y + 1) * w + x] - g[(y - 1) * w + x]) >= T) c++
    rowCov[y] = c / (x1 - x0)
  }
  for (let x = 1; x < w - 1; x++) {
    let c = 0
    for (let y = y0; y < y1; y++) if (Math.abs(g[y * w + x + 1] - g[y * w + x - 1]) >= T) c++
    colCov[x] = c / (y1 - y0)
  }
  const rc = smooth3(rowCov)
  const cc = smooth3(colCov)
  const ins = cfg.inset
  const top = pickLine(rc, Math.floor(h * ins), Math.floor(h * 0.45), cfg.coverage, true)
  const bottom = pickLine(rc, Math.ceil(h * 0.55), Math.ceil(h * (1 - ins)), cfg.coverage, false)
  const left = pickLine(cc, Math.floor(w * ins), Math.floor(w * 0.45), cfg.coverage, true)
  const right = pickLine(cc, Math.ceil(w * 0.55), Math.ceil(w * (1 - ins)), cfg.coverage, false)
  const okV = top != null && bottom != null && bottom - top >= cfg.minGap * h
  const okH = left != null && right != null && right - left >= cfg.minGap * w
  const B = cfg.band

  // mean luminance of a strip, for the step across each present line
  const meanRect = (xa, xb, ya, yb) => {
    let s = 0, n = 0
    for (let y = Math.max(0, ya); y < Math.min(h, yb); y++) for (let x = Math.max(0, xa); x < Math.min(w, xb); x++) { s += g[y * w + x]; n++ }
    return n ? s / n : null
  }
  const yTop = (top ?? 0), yBot = (bottom ?? 0), xL = (left ?? 0), xR = (right ?? 0)
  const spanX = [Math.floor((okH ? xL : w * 0.15) + B), Math.ceil((okH ? xR : w * 0.85) - B)]
  const spanY = [Math.floor((okV ? yTop : h * 0.15) + B), Math.ceil((okV ? yBot : h * 0.85) - B)]
  const diffs = {}
  if (top != null && okV) diffs.top = meanRect(spanX[0], spanX[1], top - 1 - B, top - 1) - meanRect(spanX[0], spanX[1], top + 2, top + 2 + B)
  if (bottom != null && okV) diffs.bottom = meanRect(spanX[0], spanX[1], bottom + 2, bottom + 2 + B) - meanRect(spanX[0], spanX[1], bottom - 1 - B, bottom - 1)
  if (left != null && okH) diffs.left = meanRect(left - 1 - B, left - 1, spanY[0], spanY[1]) - meanRect(left + 2, left + 2 + B, spanY[0], spanY[1])
  if (right != null && okH) diffs.right = meanRect(right + 2, right + 2 + B, spanY[0], spanY[1]) - meanRect(right - 1 - B, right - 1, spanY[0], spanY[1])
  // diff = outside - inside. A consistent frame: >= 3 sides with |diff| >= minStep and the same sign.
  const vals = Object.values(diffs).filter((v) => v != null && !Number.isNaN(v))
  const pos = vals.filter((v) => v >= cfg.minStep)
  const neg = vals.filter((v) => v <= -cfg.minStep)
  const use = pos.length >= neg.length ? pos : neg
  const sides = vals.length
  const consistent = use.length
  const rect = okV && okH ? { x0: left / w, y0: top / h, x1: right / w, y1: bottom / h } : null
  const area = rect ? (rect.x1 - rect.x0) * (rect.y1 - rect.y0) : 0
  let score = 0
  if (consistent >= 3 && rect && area >= cfg.minArea) {
    const meanAbs = use.reduce((a, v) => a + Math.abs(v), 0) / use.length
    score = (consistent / 4) * Math.min(1, meanAbs / cfg.stepFull)
    if (faceBox) {
      const ix = Math.max(0, Math.min(rect.x1, faceBox.x + faceBox.w) - Math.max(rect.x0, faceBox.x))
      const iy = Math.max(0, Math.min(rect.y1, faceBox.y + faceBox.h) - Math.max(rect.y0, faceBox.y))
      const inside = (ix * iy) / (faceBox.w * faceBox.h)
      if (inside < cfg.faceInside) score *= 0.3 // a rectangle that does not contain the face is more likely a window or a monitor behind the person
    }
  }
  return { score, sides, consistent, found: score > 0, rect, area, polarity: use === pos ? 'outside-brighter' : 'outside-darker' }
}
