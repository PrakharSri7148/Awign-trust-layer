import { THRESHOLDS } from '../config.js'
import { STATUS, checkResult, ramp } from '../schema.js'
import { percentile } from '../stats.js'

export function exposureMetrics(gray) {
  const n = gray.length
  let sum = 0
  let crushed = 0
  let clipped = 0
  for (let i = 0; i < n; i++) {
    const v = gray[i]
    sum += v
    if (v < 25) crushed++
    if (v > 245) clipped++
  }
  return {
    mean: sum / n,
    crushedFrac: crushed / n,
    clippedFrac: clipped / n,
    p5: percentile(gray, 0.05),
    p95: percentile(gray, 0.95),
  }
}

export function checkExposure(frame) {
  const t = THRESHOLDS.exposure
  const m = exposureMetrics(frame.gray)
  const range = m.p95 - m.p5
  const details = { ...m, range }

  let status = STATUS.PASS
  let kind = null
  const raise = (s, k) => {
    if (s === STATUS.FAIL || status === STATUS.PASS) {
      status = s
      kind = k
    }
  }
  if (m.mean < t.darkMeanFail || m.crushedFrac > t.crushedFracFail) raise(STATUS.FAIL, 'dark')
  else if (m.mean < t.darkMeanWarn || m.crushedFrac > t.crushedFracWarn) raise(STATUS.WARN, 'dark')
  if (m.mean > t.overMeanFail || m.clippedFrac > t.clippedFracFail) raise(STATUS.FAIL, 'over')
  else if (m.mean > t.overMeanWarn || m.clippedFrac > t.clippedFracWarn) raise(STATUS.WARN, 'over')
  if (status === STATUS.PASS && range < t.flatRangeWarn) raise(STATUS.WARN, 'flat')

  const darkScore = Math.min(ramp(m.mean, t.darkMeanFail - 20, t.darkMeanWarn + 25), ramp(m.crushedFrac, 0.8, 0.2))
  const overScore = Math.min(ramp(m.mean, t.overMeanFail + 15, t.overMeanWarn - 25), ramp(m.clippedFrac, 0.5, 0.05))
  const score = Math.min(darkScore, overScore, ramp(range, 15, t.flatRangeWarn + 15))

  const hints = {
    dark: 'Too dark. Move to better light or turn on the flash.',
    over: 'Overexposed. Move away from the bright light or avoid pointing at it.',
    flat: 'Low contrast, the photo looks washed out or hazy. Wipe the lens and avoid shooting into light.',
  }
  return checkResult('exposure', {
    status,
    score,
    value: m.mean,
    hint: kind ? hints[kind] : null,
    details: { ...details, kind },
  })
}
