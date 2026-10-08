// Discrete segment meters for the live HUD. Pure: the HUD component only renders what these return.
//
//   toSegments(pct, n, status)  a quality meter: round(pct / 100 * n) segments are lit, in the status colour
//   segmentTicks(ticks, n)      where the warn / fail notches go, as boundary indices between segments
//   positionSegments(pct, ticks, n)  brightness: ONE lit segment at the position, the good zone marked
//
// Segment i (0-based) covers pct [i/n, (i+1)/n). A boundary index k (1..n-1) sits between segment k-1 and k.
import { THRESHOLDS } from './config.js'
import { STATUS } from './schema.js'

export const SEGMENTS = THRESHOLDS.live.hud.segments ?? 10
export const OVERALL_SEGMENTS = THRESHOLDS.live.hud.overallSegments ?? 20

const TONE = { [STATUS.PASS]: 'pass', [STATUS.WARN]: 'warn', [STATUS.FAIL]: 'fail' }
const clampPct = (p) => (p == null || Number.isNaN(p) ? 0 : Math.max(0, Math.min(100, p)))

export function toSegments(pct, n = SEGMENTS, status = STATUS.PASS) {
  const lit = Math.round((clampPct(pct) / 100) * n)
  const tone = TONE[status] ?? 'pass'
  return { n, lit, tone, cells: Array.from({ length: n }, (_, i) => i < lit) }
}

// A notch is only drawn where it falls strictly inside the meter (a fail at 0% or a warn at 100% has none).
export function segmentTicks(ticks, n = SEGMENTS) {
  const at = (v) => {
    if (typeof v !== 'number') return null
    const k = Math.round((clampPct(v) / 100) * n)
    return k > 0 && k < n ? k : null
  }
  return { warn: at(ticks?.warn), fail: at(ticks?.fail) }
}

// Brightness is a position, not a quality: the lit segment is where the mean luma sits; the good zone
// (between the warn levels) is every segment whose centre lies inside it.
export function positionSegments(pct, ticks, n = SEGMENTS, status = STATUS.PASS) {
  const at = Math.min(n - 1, Math.floor((clampPct(pct) / 100) * n))
  const [lo, hi] = Array.isArray(ticks?.warn) ? ticks.warn : [null, null]
  const zone = Array.from({ length: n }, (_, i) => {
    const centre = ((i + 0.5) / n) * 100
    return lo != null && centre >= lo && centre <= hi
  })
  return { n, at, zone, tone: TONE[status] ?? 'pass', cells: Array.from({ length: n }, (_, i) => i === at) }
}
