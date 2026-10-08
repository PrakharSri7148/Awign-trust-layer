// The `liveness` check: did a live person complete the random challenge for this photo?
// Not derived from pixels: the evidence comes from the camera session (face/liveness.js) and is attached to
// the report like the face check. The server never trusts this verdict; it re-checks the evidence (Phase 7e).
import { THRESHOLDS } from '../config.js'
import { STATUS, checkResult } from '../schema.js'
import { passiveScore } from '../passive/passive.js'

export const FACE_REQUIRED = 'required'

// Passive evidence: { photo: { moire, bezel } (from the captured photo), live: { banding, planar, glareFace, moire?, bezel? } (from the
// camera session) }. The strongest reading of each signal wins; the combiner turns them into one 0..1 score.
export function combinePassive(passive) {
  if (!passive) return null
  const photo = passive.photo ?? {}
  const live = passive.live ?? {}
  const pick = (a, b) => (a?.score == null ? b : b?.score == null ? a : a.score >= b.score ? a : b)
  const signals = { moire: pick(photo.moire, live.moire), bezel: pick(photo.bezel, live.bezel), banding: live.banding, planar: live.planar, glareFace: live.glareFace }
  const sc = passiveScore(signals)
  return { ...sc, signals: { moire: signals.moire?.score ?? null, bezel: signals.bezel?.score ?? null, banding: signals.banding?.score ?? null, planar: signals.planar?.planar ?? null, glareFaceOverlap: signals.glareFace?.overlap ?? null } }
}

const SPOOF_HINT = 'This photo looks like it may show a screen or a print. It will be reviewed.'

// evidence: { status: 'passed' | 'failed' | 'review', reason?, attempts?, challenges?, results? } | null
// source: 'camera' | 'file'. passive: see combinePassive. Tasks without a face never run this.
export function evaluateLiveness({ task, evidence, source = 'camera', passive = null } = {}) {
  const mode = task?.face ?? 'off'
  if (mode === 'off') return null
  const required = mode === FACE_REQUIRED
  const p = combinePassive(passive)
  const suspicious = p?.status === 'warn' || p?.status === 'fail'
  const pDetails = p ? { passive: { score: p.score, status: p.status, signals: p.signals } } : {}

  if (!evidence) {
    if (!required) {
      // optional face tasks have no active challenge: only the passive evidence can raise a flag
      return suspicious ? checkResult('liveness', { status: STATUS.WARN, score: 1 - p.score, hint: SPOOF_HINT, details: { reason: 'passive_suspicious', source, ...pDetails } }) : null
    }
    if (source === 'file') {
      // No live camera at all (permission denied, unsupported): a picked file cannot do a challenge. Do not strand
      // the worker: allow it, flagged for review.
      return checkResult('liveness', { status: STATUS.WARN, score: 0.3, hint: 'Live check not possible with a picked photo. It will be sent for review.', details: { reason: 'no_live_camera', source, ...pDetails } })
    }
    return checkResult('liveness', { status: STATUS.FAIL, score: 0, hint: 'The live check was not completed. Open the camera and follow the on-screen prompt.', details: { reason: 'no_evidence', source, ...pDetails } })
  }

  const base = { challenges: evidence.challenges ?? null, attempts: evidence.attempts ?? 1, source, ...pDetails }
  if (evidence.status === 'passed') {
    // The challenge was done, but the picture itself looks like a screen / print: pass the person to review, never block on heuristics alone.
    if (suspicious) return checkResult('liveness', { status: STATUS.WARN, score: Math.min(0.5, 1 - p.score), value: 1, hint: SPOOF_HINT, details: { ...base, reason: 'passive_suspicious' } })
    return checkResult('liveness', { status: STATUS.PASS, score: 1, value: 1, details: { ...base, reason: 'challenge_passed' } })
  }
  if (evidence.status === 'review') {
    return checkResult('liveness', { status: STATUS.WARN, score: 0.3, hint: 'The live check could not be completed. It will be sent for review.', details: { ...base, reason: 'review_requested' } })
  }
  // failed
  return checkResult('liveness', {
    status: required ? STATUS.FAIL : STATUS.WARN,
    score: 0,
    value: 0,
    hint: evidence.reason ?? 'The live check failed. Try again.',
    details: { ...base, reason: 'challenge_failed' },
  })
}

// How long a pass stays usable before the photo is taken (config only; the camera enforces it).
export const livenessValidMs = () => THRESHOLDS.liveness.validForMs
