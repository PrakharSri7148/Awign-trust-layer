import { THRESHOLDS } from '../config.js'
import { STATUS, checkResult, ramp } from '../schema.js'

// Mean absolute difference between pixels `step` apart, over a native patch.
function stepEnergy(gray, w, h, step) {
  let s = 0
  let n = 0
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x + step < w; x++) {
      s += Math.abs(gray[y * w + x + step] - gray[y * w + x])
      n++
    }
  }
  return n ? s / n : 0
}

// Informational only. A photo upscaled from a small original has no detail at
// the pixel scale: differences 2px apart are ~2x those 1px apart, vs ~1.45x for a
// sharp photo. But an ordinarily blurred photo reads the same (measured: 1px blur
// 1.89, upscaled 4x 1.91), so this cannot raise a flag on its own. It is kept in
// `details` for calibration against real photos.
export function smoothnessRatio(patches) {
  const ratios = []
  for (const p of patches) {
    const e1 = stepEnergy(p.gray, p.width, p.height, 1)
    if (e1 < 0.8) continue // flat patch, nothing to learn
    ratios.push(stepEnergy(p.gray, p.width, p.height, 2) / e1)
  }
  return ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null
}

export function checkResolution(frame) {
  const t = THRESHOLDS.resolution
  const { width, height } = frame.native
  const short = Math.min(width, height)
  const long = Math.max(width, height)
  const megapixels = (width * height) / 1e6
  const ratio = smoothnessRatio(frame.native.patches)
  const details = { width, height, megapixels, smoothnessRatio: ratio }

  let status = STATUS.PASS
  let hint = null
  if (short < t.failShortSide || long < t.failLongSide) {
    status = STATUS.FAIL
    hint = `Photo is too small (${width}×${height}). Use the camera at full resolution.`
  } else if (megapixels < t.warnMegapixels) {
    status = STATUS.WARN
    hint = `Low resolution (${width}×${height}). Use the camera at full resolution.`
  }
  return checkResult('resolution', {
    status,
    score: ramp(megapixels, 0.3, 2),
    value: megapixels,
    hint,
    details,
  })
}
