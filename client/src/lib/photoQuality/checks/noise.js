import { THRESHOLDS } from '../config.js'
import { STATUS, checkResult, ramp } from '../schema.js'
import { noiseSigma } from '../stats.js'

// JPEG compresses 8x8 blocks independently, so heavy compression leaves small
// steps exactly on the 8px grid. Ratio of the gradient across block boundaries
// to the gradient elsewhere: ~1.0 for clean images, rising with compression.
// Smooth content inflates the ratio (tiny steps over a ~0 interior), so the
// absolute excess in grey levels is returned too and must also be visible.
// Patch origins are 8px-aligned (see frame.patchOrigins).
// Differences are capped: block steps are small, while a real edge that happens
// to land on the 8px grid would otherwise dominate the boundary average.
const STEP_CAP = 20

export function blockinessStats(gray, w, h) {
  let bSum = 0
  let bN = 0
  let iSum = 0
  let iN = 0
  for (let y = 0; y < h; y += 2) {
    for (let x = 1; x < w; x++) {
      const d = Math.min(STEP_CAP, Math.abs(gray[y * w + x] - gray[y * w + x - 1]))
      if (x % 8 === 0) { bSum += d; bN++ } else if (x % 8 !== 7 && x % 8 !== 1) { iSum += d; iN++ }
    }
  }
  for (let x = 0; x < w; x += 2) {
    for (let y = 1; y < h; y++) {
      const d = Math.min(STEP_CAP, Math.abs(gray[y * w + x] - gray[(y - 1) * w + x]))
      if (y % 8 === 0) { bSum += d; bN++ } else if (y % 8 !== 7 && y % 8 !== 1) { iSum += d; iN++ }
    }
  }
  if (!bN || !iN || iSum === 0) return null
  const b = bSum / bN
  const i = iSum / iN
  return { ratio: b / i, excess: b - i }
}

export const blockiness = (gray, w, h) => blockinessStats(gray, w, h)?.ratio ?? null

// 1 = clean. sigma in grey levels (0..255).
export const noiseSigmaScore = (sigma, t = THRESHOLDS.noise) => ramp(sigma, t.sigmaFail + 5, 1)

export function checkNoise(frame) {
  const t = THRESHOLDS.noise
  const patches = frame.native.patches
  const sigmas = patches.map((p) => noiseSigma(p.gray, p.width, p.height))
  // Median over patches so one textured or lucky patch doesn't decide.
  const sigma = [...sigmas].sort((a, b) => a - b)[Math.floor(sigmas.length / 2)]
  const blocks = patches.map((p) => blockinessStats(p.gray, p.width, p.height)).filter((v) => v != null)
  const med = (key) => {
    const v = blocks.map((b) => b[key]).sort((a, b) => a - b)
    return v.length ? v[Math.floor(v.length / 2)] : null
  }
  const blockRatio = med('ratio')
  const blockExcess = med('excess')
  // Only count blockiness whose steps are actually visible.
  const block = blockRatio != null && blockExcess >= t.blockMinExcess ? blockRatio : null

  const pixels = frame.native.width * frame.native.height
  const bitsPerPixel = frame.native.bytes && /jpe?g/i.test(frame.native.mime ?? '') ? (frame.native.bytes * 8) / pixels : null

  const noisy = sigma >= t.sigmaFail ? STATUS.FAIL : sigma >= t.sigmaWarn ? STATUS.WARN : STATUS.PASS
  const blocky = block == null ? STATUS.PASS : block >= t.blockFail ? STATUS.FAIL : block >= t.blockWarn ? STATUS.WARN : STATUS.PASS
  const order = [STATUS.PASS, STATUS.WARN, STATUS.FAIL]
  const status = order[Math.max(order.indexOf(noisy), order.indexOf(blocky))]

  let hint = null
  if (status !== STATUS.PASS) {
    const parts = []
    if (noisy !== STATUS.PASS) parts.push('grainy (low light)')
    if (blocky !== STATUS.PASS) parts.push('heavily compressed')
    hint = `Photo looks ${parts.join(' and ')}. Use more light and send the original, not a forwarded copy.`
  }
  return checkResult('noise', {
    status,
    score: Math.min(noiseSigmaScore(sigma, t), block == null ? 1 : ramp(block, t.blockFail + 0.2, 1.02)),
    value: sigma,
    hint,
    details: { noiseSigma: sigma, blockiness: blockRatio, blockExcess, bitsPerPixel, patches: patches.length },
  })
}
