// Live viewfinder guidance. Cheap checks on a ~480px preview frame, several times a
// second, so the worker can fix a problem BEFORE pressing the shutter. This is
// deliberately coarse (at preview size only gross blur/exposure problems are
// visible); the full check on the captured photo remains the authority.
import { THRESHOLDS } from './config.js'
import { blurMetrics } from './checks/blur.js'
import { checkExposure } from './checks/exposure.js'
import { glareMetrics, glareStatus } from './checks/glare.js'
import { obstructionMetrics } from './checks/obstruction.js'
import { sensorShake } from './checks/shakeSensor.js'
import { STATUS } from './schema.js'

// What to tell the worker first when several things are wrong.
export const LIVE_PRIORITY = ['lens', 'light', 'face', 'steady', 'focus', 'glare']
export const LIVE_LABELS = { lens: 'Lens', light: 'Light', face: 'Face', steady: 'Steady', focus: 'Focus', glare: 'Glare' }

const mk = (status, hint = null, extra = {}) => ({ status, hint, ...extra })

// frame: a small frame (frame.js buildFrame). motion: recent motion samples or null.
// face: an evaluateFace() result for this task, or null when not applicable / not run yet.
export function analyzeLive(frame, { motion = null, face = null } = {}) {
  const live = THRESHOLDS.live
  const checks = {}

  const exposure = checkExposure(frame)
  checks.light = mk(exposure.status === STATUS.PASS ? STATUS.PASS : exposure.status, exposure.hint)

  const blur = blurMetrics(frame.gray, frame.width, frame.height, THRESHOLDS.blur)
  if (blur.score == null) checks.focus = mk(STATUS.PASS, null, { value: null }) // flat scene: nothing to judge
  else if (blur.score < live.blurBad) checks.focus = mk(STATUS.FAIL, 'Out of focus. Tap the subject and hold steady.', { value: blur.score })
  else if (blur.score < live.blurSoft) checks.focus = mk(STATUS.WARN, 'A little soft. Hold steady.', { value: blur.score })
  else checks.focus = mk(STATUS.PASS, null, { value: blur.score })

  const lens = obstructionMetrics(frame)
  const t = THRESHOLDS.obstruction
  checks.lens =
    lens.fullCover || lens.area >= t.failArea
      ? mk(STATUS.FAIL, lens.fullCover ? 'Almost completely dark: uncover the lens or find more light.' : 'Something is covering part of the lens.')
      : lens.area >= t.warnArea
        ? mk(STATUS.WARN, 'Something may be covering part of the lens.')
        : mk(STATUS.PASS)

  const g = glareStatus(glareMetrics(frame, { ...THRESHOLDS.glare, cell: live.glareCell }))
  checks.glare = mk(g.status, g.hint)

  const steady = motion ? sensorShake(motion) : null
  checks.steady = steady
    ? mk(steady.status, steady.status === STATUS.PASS ? null : 'Hold still.', { rotRms: steady.rotRms })
    : mk(STATUS.PASS)

  if (face) checks.face = mk(face.status, face.hint, { box: face.details?.box ?? null })

  return summarize(checks)
}

// Pick the headline hint and decide whether things look good enough to shoot.
export function summarize(checks) {
  let worst = null
  for (const id of LIVE_PRIORITY) {
    const c = checks[id]
    if (!c || c.status === STATUS.PASS || c.status === STATUS.SKIP) continue
    if (!worst || (c.status === STATUS.FAIL && worst.c.status !== STATUS.FAIL)) worst = { id, c }
  }
  const clean = Object.values(checks).every((c) => c.status === STATUS.PASS || c.status === STATUS.SKIP)
  return { checks, clean, hint: worst?.c.hint ?? null, hintId: worst?.id ?? null }
}

// "Ready" needs several clean frames in a row, so it doesn't flicker.
export function createReadyTracker(frames = THRESHOLDS.live.readyFrames) {
  let run = 0
  return (summary) => {
    run = summary.clean ? run + 1 : 0
    return run >= frames
  }
}
