// Live viewfinder guidance. Cheap checks on a ~480px preview frame, several times a
// second, so the worker can fix a problem BEFORE pressing the shutter. This is
// deliberately coarse (at preview size only gross blur/exposure problems are
// visible); the full check on the captured photo remains the authority.
import { THRESHOLDS } from './config.js'
import { blurMetrics } from './checks/blur.js'
import { checkExposure } from './checks/exposure.js'
import { glareMetrics, glareStatus } from './checks/glare.js'
import { checkObstruction } from './checks/obstruction.js'
import { makeThumb, opticalMotion } from './checks/opticalMotion.js'
import { checkResolution } from './checks/resolution.js'
import { sensorShake } from './checks/shakeSensor.js'
import { computeLiveMetrics, initialHudState } from './liveMetrics.js'
import { STATUS } from './schema.js'
import { noiseSigma } from './stats.js'
import { bandingEvidence, rowProfile } from './passive/banding.js'
import { bezelMetrics } from './passive/bezel.js'
import { moireMetrics } from './passive/moire.js'
import { passiveScore } from './passive/passive.js'

// What to tell the worker first when several things are wrong.
export const LIVE_PRIORITY = ['lens', 'light', 'face', 'steady', 'focus', 'glare']
export const LIVE_LABELS = { lens: 'Lens', light: 'Light', face: 'Face', steady: 'Steady', focus: 'Focus', glare: 'Glare' }

const mk = (status, hint = null, extra = {}) => ({ status, hint, ...extra })

// frame: a small frame (frame.js buildFrame). motion: recent motion samples or null.
// face: an evaluateFace() result for this task, or null when not applicable / not run yet.
// For the HUD numbers (all optional; without them the rows that need them are simply blank):
//   task      { face: 'off'|'optional'|'required' }  (defaults to 'required' when `face` is given)
//   faceSeq   increments each time the face detector finishes (to count consecutive misses)
//   video     { width, height } of the camera stream (the resolution row)
//   nativeCrop { gray, width, height }: a centre crop at the camera's native resolution (noise)
//   now       a millisecond clock reading (so a skipped tick isn't read as double motion)
//   prev      the `state` returned last tick
// Every pixel metric is computed ONCE here and shared by the chips and the HUD rows.
export function analyzeLive(frame, { motion = null, face = null, task = null, faceSeq = null, video = null, nativeCrop = null, now = null, liveness = null, prev = initialHudState() } = {}) {
  const live = THRESHOLDS.live
  const checks = {}

  const exposure = checkExposure(frame)
  checks.light = mk(exposure.status === STATUS.PASS ? STATUS.PASS : exposure.status, exposure.hint)

  const blur = blurMetrics(frame.gray, frame.width, frame.height, THRESHOLDS.blur)
  if (blur.score == null) checks.focus = mk(STATUS.PASS, null, { value: null }) // flat scene: nothing to judge
  else if (blur.score < live.blurBad) checks.focus = mk(STATUS.FAIL, 'Out of focus. Tap the subject and hold steady.', { value: blur.score })
  else if (blur.score < live.blurSoft) checks.focus = mk(STATUS.WARN, 'A little soft. Hold steady.', { value: blur.score })
  else checks.focus = mk(STATUS.PASS, null, { value: blur.score })

  const lens = checkObstruction(frame) // same thresholds as the capture check; details = the raw metrics
  checks.lens =
    lens.status === STATUS.FAIL
      ? mk(STATUS.FAIL, lens.details.fullCover ? 'Almost completely dark: uncover the lens or find more light.' : 'Something is covering part of the lens.')
      : lens.status === STATUS.WARN
        ? mk(STATUS.WARN, 'Something may be covering part of the lens.')
        : mk(STATUS.PASS)

  const glareM = glareMetrics(frame, { ...THRESHOLDS.glare, cell: live.glareCell })
  const g = glareStatus(glareM)
  checks.glare = mk(g.status, g.hint)

  // Steadiness has two independent sources: the phone's motion sensors (when it has them) and
  // the picture itself (how far the whole image moved since the last tick; works on any camera).
  const steady = motion ? sensorShake(motion) : null
  const thumb = makeThumb(frame.gray, frame.width, frame.height)
  const optical = prev.thumb ? opticalMotion(prev.thumb, thumb, now != null && prev.thumbAt != null ? now - prev.thumbAt : null) : null
  const worse = [steady, optical].filter(Boolean).sort((a, b) => (a.status === STATUS.FAIL ? 0 : a.status === STATUS.WARN ? 1 : 2) - (b.status === STATUS.FAIL ? 0 : b.status === STATUS.WARN ? 1 : 2))[0]
  checks.steady = worse
    ? mk(worse.status, worse.status === STATUS.PASS ? null : 'Hold still.', { rotRms: steady?.rotRms ?? null, motionPct: optical?.pct ?? null })
    : mk(STATUS.PASS)

  if (face) checks.face = mk(face.status, face.hint, { box: face.details?.box ?? null })

  // ---- HUD rows ----
  const resolution = video ? checkResolution({ native: { width: video.width, height: video.height, patches: [] } }) : null
  const sigma = nativeCrop ? noiseSigma(nativeCrop.gray, nativeCrop.width, nativeCrop.height) : null
  const { metrics, overall, state } = computeLiveMetrics(
    {
      exposure,
      blurScore: blur.score,
      lens,
      glare: { m: glareM, ...g },
      steady,
      optical,
      sigma,
      resolution,
      face,
      faceSeq,
      faceMode: task ? task.face : face ? 'required' : 'off',
      liveness,
    },
    prev,
  )

  // ---- passive screen / print evidence (face tasks only; evidence, not a verdict: see passive/*.js) ----
  let passive = null
  let extra = {}
  if (task && task.face && task.face !== 'off') {
    const profiles = [...(prev.profiles ?? []), rowProfile(frame.gray, frame.width, frame.height)].slice(-8)
    // the native crop is only read every other tick: keep the last moire reading in between
    const moire = nativeCrop ? moireMetrics(nativeCrop.gray, nativeCrop.width, nativeCrop.height) : prev.moire ?? null
    const faceBox = face?.details?.box ?? null
    const bezel = bezelMetrics(frame.gray, frame.width, frame.height, faceBox)
    const banding = bandingEvidence(profiles)
    const glareFace = faceBox && glareM.bbox ? { overlap: boxOverlap(glareM.bbox, faceBox) } : null
    const sc = passiveScore({ moire, bezel, banding, glareFace })
    passive = {
      moire: { score: moire?.score ?? null, peaks: moire?.peaks ?? 0 },
      bezel: { score: bezel.score, consistent: bezel.consistent },
      banding: { score: banding.score, driftRows: banding.driftRows ?? null },
      glareFace,
      score: sc.score,
      status: sc.status,
    }
    extra = { profiles, moire }
  }

  return { ...summarize(checks), metrics, overall, passive, state: { ...state, ...extra, thumb, thumbAt: now } }
}

// share of the FACE box covered by the glare blob (both normalised; glare uses x0/x1/y0/y1, the face box x/y/w/h)
export function boxOverlap(g, f) {
  const ix = Math.max(0, Math.min(g.x1, f.x + f.w) - Math.max(g.x0, f.x))
  const iy = Math.max(0, Math.min(g.y1, f.y + f.h) - Math.max(g.y0, f.y))
  return f.w > 0 && f.h > 0 ? (ix * iy) / (f.w * f.h) : 0
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
