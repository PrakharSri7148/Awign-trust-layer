// Active liveness: a short random challenge ("blink", "turn your head to your left", ...) verified from
// FaceLandmarker blendshapes and head pose. PURE: it is driven by a timeline of samples, so every
// behaviour is unit-tested without a camera.
//
// Sample (one landmarker result, ~every 70-120 ms):
//   { t: ms (monotonic), face: bool, blink: 0..1 (mean of eyeBlinkLeft/Right), smile: 0..1 (mean of mouthSmileLeft/Right),
//     jaw: 0..1 (jawOpen), yaw: degrees, POSITIVE = the user turned to THEIR left (nose towards the right of the unmirrored image) }
//
// A challenge counts only when the signal goes neutral -> active (-> neutral for a blink). A face that is ALREADY
// smiling, eyes held open, or a photo that never moves cannot pass: it never shows the neutral->active transition
// inside the time window. The challenges are random and short, so a recorded clip would have to match them.
//
// Honest scope (iteration-3.md 2.2): this stops photos, prints and most casual replays. It does not stop a person
// performing the action for the attacker's photo, a replayed video that happens to match, or an injected virtual camera.
import { THRESHOLDS } from '../config.js'

export const CHALLENGE_TYPES = {
  blink: { label: 'Blink', prompt: 'Blink your eyes', group: 'blink' },
  turn_left: { label: 'Turn left', prompt: 'Turn your head to your left', group: 'turn' },
  turn_right: { label: 'Turn right', prompt: 'Turn your head to your right', group: 'turn' },
  smile: { label: 'Smile', prompt: 'Smile', group: 'smile' },
  open_mouth: { label: 'Open mouth', prompt: 'Open your mouth', group: 'mouth' },
}

// signal(sample) -> number the thresholds apply to (turn: signed degrees towards the requested side)
const SIGNAL = {
  blink: (s) => s.blink,
  smile: (s) => s.smile,
  open_mouth: (s) => s.jaw,
  turn_left: (s) => s.yaw,
  turn_right: (s) => -s.yaw,
}

// One config shape for every challenge: { neutral, active, holdMs, needReturn, maxActiveMs }
export function challengeConfig(id, L = THRESHOLDS.liveness) {
  if (id === 'turn_left' || id === 'turn_right') return { neutral: L.turn.neutralBelowDeg, active: L.turn.activeAboveDeg, holdMs: L.turn.holdMs, needReturn: false, maxActiveMs: Infinity, neutralAbs: true }
  const c = L[id]
  return { neutral: c.neutralBelow, active: c.activeAbove, holdMs: c.holdMs, needReturn: !!c.needReturn, maxActiveMs: c.maxActiveMs ?? Infinity }
}

// Two different KINDS of action (never blink+blink or turn_left+turn_right), in random order. `random` is injected for tests.
export function pickChallenges(random = Math.random, n = THRESHOLDS.liveness.challengesPerAttempt, pool = THRESHOLDS.liveness.pool) {
  const left = [...pool]
  const out = []
  const used = new Set()
  while (out.length < n && left.length) {
    const i = Math.floor(random() * left.length)
    const id = left.splice(i, 1)[0]
    const g = CHALLENGE_TYPES[id].group
    if (used.has(g)) continue
    used.add(g)
    out.push(id)
  }
  return out
}

// signals: for a turn challenge "neutral" means |yaw| small (facing the camera), not merely "not turned the right way".
function neutralNow(id, cfg, v, s) {
  return cfg.neutralAbs ? Math.abs(s.yaw) < cfg.neutral : v < cfg.neutral
}

// Why an attempt timed out, in words a worker can act on: face left the frame / never saw a relaxed face first /
// the movement was too small / the face did not return to neutral. (Display only: the server replays the timeline itself.)
export function timeoutReason(cur) {
  const what = CHALLENGE_TYPES[cur.id].label.toLowerCase()
  if (cur.faceLost) return `Your face left the frame, so we missed "${what}". Keep your face in view.`
  if (cur.state === 'wait_neutral') return `We need to see a relaxed face first before "${what}". Look at the camera, relax, then do it.`
  if (cur.state === 'armed') return `We saw too little movement for "${what}". Make it a bit bigger and clearer.`
  return `We saw "${what}" but not the return to a normal face. Relax your face afterwards.`
}

// The run of ONE attempt: the challenges in order, each with a deadline.
export function createChallengeRun(challenges, { startT = 0, L = THRESHOLDS.liveness } = {}) {
  const ids = [...challenges]
  const results = []
  const timeline = [] // compact evidence for the server: [t, blink, smile, jaw, yaw, face]
  let index = 0
  let phase = 'running' // running | passed | failed
  let reason = null
  let cur = null // state of the current challenge
  let lastFaceT = startT
  let lastSampleT = startT

  const begin = (t) => {
    const id = ids[index]
    cur = { id, cfg: challengeConfig(id, L), t0: t, state: 'wait_neutral', neutralSince: null, activeSince: null, peak: 0, faceLost: false }
  }
  begin(startT)

  const finish = (status, t, why = null) => {
    results.push({ id: cur.id, status, t0: Math.round(cur.t0 - startT), t1: Math.round(t - startT), peak: Number(cur.peak.toFixed(3)) })
    if (status !== 'pass') {
      phase = 'failed'
      reason = why
      return
    }
    index++
    if (index >= ids.length) phase = 'passed'
    else begin(t)
  }

  function push(s) {
    if (phase !== 'running') return snapshot(s.t)
    lastSampleT = s.t
    const cap = L.evidence.maxSamples
    timeline.push([Math.round(s.t - startT), r3(s.blink), r3(s.smile), r3(s.jaw), Math.round((s.yaw ?? 0) * 10) / 10, s.face ? 1 : 0])
    if (timeline.length > cap) timeline.shift()

    if (s.face) {
      lastFaceT = s.t
      cur.faceLost = false
    } else if (s.t - lastFaceT >= L.faceLostMs) {
      // No face for a while: the attempt does not pause, but the action must start over from neutral.
      cur.state = 'wait_neutral'
      cur.neutralSince = null
      cur.activeSince = null
      cur.faceLost = true
    }

    if (s.face) advance(s)
    if (phase === 'running' && s.t - cur.t0 >= L.timeoutMs) finish('timeout', s.t, timeoutReason(cur))
    return snapshot(s.t)
  }

  function advance(s) {
    const v = SIGNAL[cur.id](s)
    const c = cur.cfg
    cur.peak = Math.max(cur.peak, v)
    const isNeutral = neutralNow(cur.id, c, v, s)
    switch (cur.state) {
      case 'wait_neutral':
        if (isNeutral) {
          cur.neutralSince ??= s.t
          if (s.t - cur.neutralSince >= L.neutralMs) cur.state = 'armed'
        } else cur.neutralSince = null
        break
      case 'armed':
        if (v >= c.active) {
          cur.state = 'active'
          cur.activeSince = s.t
          if (c.holdMs === 0 && !c.needReturn) finish('pass', s.t)
        }
        break
      case 'active': {
        const held = s.t - cur.activeSince
        if (c.needReturn) {
          if (v < c.neutral + 0.1) finish('pass', s.t) // closed, then open again = a blink
          else if (held > c.maxActiveMs) {
            // eyes closed for too long is not a blink: start over
            cur.state = 'wait_neutral'
            cur.neutralSince = null
            cur.activeSince = null
          }
        } else if (v >= c.active - (c.active - c.neutral) * 0.25) {
          if (held >= c.holdMs) finish('pass', s.t)
        } else {
          cur.state = 'armed' // let go before the hold was reached
          cur.activeSince = null
        }
        break
      }
      default:
        break
    }
  }

  function snapshot(t = lastSampleT) {
    const total = ids.length
    const current = phase === 'running'
      ? {
          id: cur.id,
          label: CHALLENGE_TYPES[cur.id].label,
          prompt: CHALLENGE_TYPES[cur.id].prompt,
          state: cur.state,
          remainingMs: Math.max(0, L.timeoutMs - (t - cur.t0)),
          faceLost: cur.faceLost,
          // 0..1 how close the signal is to counting (for the on-screen cue)
          progress: cur.state === 'active' ? 1 : Math.max(0, Math.min(1, cur.peak / cur.cfg.active)),
        }
      : null
    return { phase, index, total, current, results: results.map((r) => ({ ...r })), reason, ids: [...ids] }
  }

  return {
    push,
    snapshot,
    // What the server needs to re-check the attempt (nonce/ids are added by the session).
    evidence: () => ({ challenges: [...ids], results: results.map((r) => ({ ...r })), timeline: timeline.map((x) => [...x]), status: phase, reason, durationMs: Math.round(lastSampleT - startT) }),
  }
}

const r3 = (x) => (x == null ? 0 : Math.round(x * 1000) / 1000)

// The worker-facing session: attempts, "send for review" after too many failures, and how long a pass stays valid.
export function createLivenessSession({ random = Math.random, now = () => Date.now(), L = THRESHOLDS.liveness } = {}) {
  let run = null
  let attempts = 0
  let passedAt = null
  let evidence = null
  let issued = null // { id, challenges } from the server in 7e, otherwise picked locally
  let reviewRequested = false

  return {
    start({ challenges, nonce = null, startT = now() } = {}) {
      issued = { nonce, challenges: challenges ?? pickChallenges(random, L.challengesPerAttempt, L.pool) }
      run = createChallengeRun(issued.challenges, { startT, L })
      return run.snapshot(startT)
    },
    push(sample) {
      if (!run) return null
      const snap = run.push(sample)
      if (snap.phase === 'passed' && passedAt == null) {
        passedAt = now()
        evidence = { ...run.evidence(), nonce: issued.nonce, attempt: attempts + 1 }
      } else if (snap.phase === 'failed' && !evidence) {
        attempts++
        evidence = { ...run.evidence(), nonce: issued.nonce, attempt: attempts }
      }
      return snap
    },
    snapshot: () => run?.snapshot() ?? null,
    // Back to "waiting for a face" (the camera starts the next attempt when a face is steady); attempts are kept.
    reset() {
      run = null
      evidence = null
      passedAt = null
    },
    // After a failed attempt: try again (fresh random challenges) unless the attempts are used up.
    retry(opts) {
      evidence = null
      passedAt = null
      return this.start(opts)
    },
    attempts: () => attempts,
    canRetry: () => attempts < L.maxAttempts,
    requestReview() {
      reviewRequested = true
    },
    // A pass is only good for `validForMs`: the photo must be taken soon after, not minutes later.
    valid: () => passedAt != null && now() - passedAt <= L.validForMs,
    state() {
      const snap = run?.snapshot()
      return { phase: snap?.phase ?? 'idle', valid: this.valid(), passedAt, attempts, canRetry: attempts < L.maxAttempts, reviewRequested, evidence, snapshot: snap }
    },
  }
}
