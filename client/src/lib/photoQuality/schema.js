// Shared vocabulary for the photo-quality engine.

export const REPORT_VERSION = 1

export const STATUS = { PASS: 'pass', WARN: 'warn', FAIL: 'fail', SKIP: 'skip' }
export const VERDICT = { PASS: 'pass', WARN: 'warn', BLOCK: 'block' }

// Ordered by how much a worker should care about it (used to sort issues).
export const CHECK_IDS = [
  'obstruction',
  'resolution',
  'exposure',
  'blur',
  'face',
  'liveness',
  'glare',
  'shake',
  'noise',
]

export const CHECK_LABELS = {
  blur: 'Focus',
  exposure: 'Lighting',
  glare: 'Glare',
  resolution: 'Resolution',
  obstruction: 'Lens',
  noise: 'Noise / compression',
  shake: 'Steadiness',
  face: 'Face',
  liveness: 'Liveness',
}

// score: 0..1, 1 = good. value: the raw metric behind it. hint: what the worker should do.
export function checkResult(id, { status, score = null, value = null, hint = null, details = {} }) {
  return { id, status, score, value, hint, details }
}

export const skipped = (id, reason) =>
  checkResult(id, { status: STATUS.SKIP, hint: null, details: { reason } })

// Map a metric onto a 0..1 quality score. `bad` -> 0, `good` -> 1 (either direction).
export function ramp(value, bad, good) {
  if (good === bad) return value >= good ? 1 : 0
  const t = (value - bad) / (good - bad)
  return Math.max(0, Math.min(1, t))
}
