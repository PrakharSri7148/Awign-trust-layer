import { THRESHOLDS } from '../config.js'
import { STATUS, checkResult, ramp } from '../schema.js'
import { box3, noiseSigma, percentile, sobel, tileValues, tiles } from '../stats.js'

// Variance of the Laplacian ([[0,1,0],[1,-4,1],[0,1,0]]). Kept for the legacy
// edgeValidator API; the check below no longer uses it because it is neither
// contrast- nor noise-robust.
export function laplacianVariance(gray, width, height) {
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const v = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i]
      sum += v
      sumSq += v * v
      n++
    }
  }
  if (n === 0) return 0
  const mean = sum / n
  return sumSq / n - mean * mean
}

const NOISE_GRAD = 0.94 // p98 of Sobel/4 on 3x3-smoothed white noise, per unit sigma (measured)

// Edge sharpness per tile = how steep the steepest edges are relative to the
// tile's own contrast. Sharp edge -> big jump over 1-2px; blur spreads the
// same contrast over many px. Dividing by contrast makes dim and bright scenes
// comparable; subtracting the noise floor stops sensor noise reading as detail.
export function blurMetrics(gray, width, height, cfg = THRESHOLDS.blur) {
  const sigma = noiseSigma(gray, width, height, 2)
  const sm = box3(gray, width, height)
  const grad = sobel(sm, width, height)
  const scores = []
  let texturedTiles = 0
  for (const t of tiles(width, height, cfg.grid, cfg.grid)) {
    const px = tileValues(sm, width, t)
    const range = percentile(px, 0.95) - percentile(px, 0.05)
    if (range < cfg.minTileRange) continue
    texturedTiles++
    const peak = percentile(tileValues(grad, width, t), 0.98)
    scores.push(Math.max(0, peak - NOISE_GRAD * sigma) / range)
  }
  // 66th percentile: a sharp subject against a soft background still passes,
  // while an out-of-focus frame has no sharp tiles at all.
  const score = scores.length >= cfg.minTexturedTiles ? percentile(scores, 0.66) : null
  return { score, texturedTiles, sigma, tileScores: scores }
}

export function checkBlur(frame) {
  const cfg = THRESHOLDS.blur
  const m = blurMetrics(frame.gray, frame.width, frame.height, cfg)
  if (m.score == null) {
    // A blank wall, sky or sheet: focus cannot be judged, which is not the same as blurry.
    return checkResult('blur', {
      status: STATUS.WARN,
      score: 0.6,
      value: null,
      hint: 'Not enough detail to judge focus. Make sure the subject is in frame.',
      details: { reason: 'low_texture', texturedTiles: m.texturedTiles, noiseSigma: m.sigma },
    })
  }
  const status = m.score < cfg.failBelow ? STATUS.FAIL : m.score < cfg.warnBelow ? STATUS.WARN : STATUS.PASS
  return checkResult('blur', {
    status,
    score: ramp(m.score, 0.05, 0.25),
    value: m.score,
    hint:
      status === STATUS.FAIL
        ? 'Photo is out of focus. Tap the subject to focus and hold steady.'
        : status === STATUS.WARN
          ? 'Photo is slightly soft. Hold steady for a crisper shot.'
          : null,
    details: { texturedTiles: m.texturedTiles, noiseSigma: m.sigma, tileScores: m.tileScores },
  })
}
