// The live HUD's numbers: for each of the 8 quality parameters a value, a 0..100 bar, a status
// and where the status changes, plus one overall percentage. Pure: no DOM, no clock. The
// per-tick pixel work is done ONCE by analyzeLive (live.js); this only turns those results
// into display rows and smooths them (EMA for numbers, a 2-tick hysteresis for statuses) so a
// static scene doesn't jitter and a status doesn't flicker at a threshold.
//
// Spec: edge-validator/iteration-2.md §2. Deliberately display-only: nothing here is sent anywhere.
import { THRESHOLDS } from './config.js'
import { fmtFace, fmtMotion, fmtRot, fmtSigma, fmtSize, focusScore, lensText, pct0 } from './display.js'
import { opticalTicks } from './checks/opticalMotion.js'
import { noiseSigmaScore } from './checks/noise.js'
import { glareScore } from './checks/glare.js'
import { combineScores } from './policy.js'
import { STATUS, ramp } from './schema.js'

export const HUD_ORDER = ['brightness', 'focus', 'lens', 'glare', 'steady', 'noise', 'resolution', 'face']
export const HUD_LABELS = {
  brightness: 'Brightness',
  focus: 'Focus',
  lens: 'Lens',
  glare: 'Glare',
  steady: 'Steadiness',
  noise: 'Noise',
  resolution: 'Resolution',
  face: 'Face',
  liveness: 'Liveness',
}
// Face tasks get one more row. Never part of the overall until it has a score (7c wires the challenge into it).
export const hudOrder = (faceMode) => (faceMode && faceMode !== 'off' ? [...HUD_ORDER, 'liveness'] : HUD_ORDER)

export const initialHudState = () => ({ ema: {}, shown: {}, faceMisses: 0, faceSeq: null, sigma: null })

const row = (id, o) => ({
  id,
  label: HUD_LABELS[id],
  value: null, // the smoothable number behind `display` (null = nothing to show / excluded)
  display: '—',
  unit: '',
  pct: 0, // bar fill 0..100
  score: null, // 0..1; null = not part of the overall
  status: STATUS.PASS,
  reason: null,
  ticks: null, // where the status changes, in `pct` coordinates (two-sided where the metric is)
  raw: {},
  ...o,
})

// ---- the rows -----------------------------------------------------------------------------
// Each builder returns the UNSMOOTHED row. `x` fields are what gets EMA-smoothed.

function brightnessRow({ exposure }) {
  const t = THRESHOLDS.exposure
  const d = exposure.details
  const x = (d.mean / 255) * 100
  const reason =
    d.kind === 'over' && d.clippedFrac >= 0.02
      ? `highlights clipped ${Math.round(d.clippedFrac * 100)}%`
      : d.kind === 'flat'
        ? 'washed out / hazy'
        : d.kind === 'dark'
          ? 'too dark'
          : d.kind === 'over'
            ? 'too bright'
            : null
  return row('brightness', {
    x,
    unit: '%',
    score: exposure.score,
    status: exposure.status,
    reason: exposure.status === STATUS.PASS ? null : reason,
    // A POSITION bar (where the mean luma sits), not a quality bar: good zone between the warn levels.
    positionBar: true,
    ticks: {
      warn: [(t.darkMeanWarn / 255) * 100, (t.overMeanWarn / 255) * 100],
      fail: [(t.darkMeanFail / 255) * 100, (t.overMeanFail / 255) * 100],
    },
    raw: { mean: d.mean, clippedFrac: d.clippedFrac, range: d.range, kind: d.kind },
  })
}

function focusRow({ blurScore }) {
  const live = THRESHOLDS.live
  if (blurScore == null) return row('focus', { raw: { blurScore: null }, reason: 'not enough detail to judge' })
  const fs = focusScore(blurScore, live.hud.focusFull)
  const status = blurScore < live.blurBad ? STATUS.FAIL : blurScore < live.blurSoft ? STATUS.WARN : STATUS.PASS
  return row('focus', {
    x: fs * 100,
    unit: '%',
    score: fs,
    status,
    // ticks through the SAME ramp as the bar, at the live thresholds
    ticks: { warn: focusScore(live.blurSoft, live.hud.focusFull) * 100, fail: focusScore(live.blurBad, live.hud.focusFull) * 100 },
    raw: { blurScore },
  })
}

function lensRow({ lens }) {
  const t = THRESHOLDS.obstruction
  const m = lens.details
  const status = lens.status
  return row('lens', {
    x: m.area * 100,
    unit: '%',
    score: lens.score,
    status,
    reason: m.finger && status !== STATUS.PASS ? 'finger?' : null,
    ticks: { warn: Math.max(0, 1 - t.warnArea / t.failArea) * 100, fail: 0 },
    raw: { area: m.area, fullCover: m.fullCover, coverTotal: m.coverTotal },
    fullCover: m.fullCover,
  })
}

function glareRow({ glare }) {
  const t = THRESHOLDS.glare
  const m = glare.m
  const reason = glare.status === STATUS.PASS ? null : m.soft ? `soft glare, ${m.region ?? ''}`.trim() : 'hard-edged white area'
  return row('glare', {
    x: m.area * 100,
    unit: '%',
    score: glareScore(m, t),
    status: glare.status,
    reason,
    ticks: { warn: glareScore({ soft: true, area: t.warnArea }, t) * 100, fail: glareScore({ soft: true, area: t.failArea }, t) * 100 },
    raw: { area: m.area, soft: m.soft, halo: m.halo, region: m.region },
  })
}

// Two sources, combined as the WORSE of the two: the phone's sensors (°/s, m/s²) and the image
// itself (% of frame width per tick). The display shows the sensor when there is one, otherwise
// the image motion; `reason` says what is driving a non-pass so a warning is never unexplained.
function steadyRow({ steady, optical }) {
  const t = THRESHOLDS.shake.sensor
  if (!steady && !optical) return row('steady', { display: 'measuring…', raw: { samples: 0 } })
  const rotScore = (r) => ramp(r, t.rotFail * 1.5, 2)
  const rank = { [STATUS.FAIL]: 2, [STATUS.WARN]: 1, [STATUS.PASS]: 0 }
  const sensorWorse = steady && (!optical || rank[steady.status] >= rank[optical.status])
  const status = steady && optical ? (sensorWorse ? steady.status : optical.status) : (steady ?? optical).status
  const score = Math.min(steady?.score ?? 1, optical?.score ?? 1)
  let reason = null
  if (status !== STATUS.PASS) {
    if (steady && sensorWorse) {
      const accDriven = steady.rotRms < t.rotWarn && steady.accRms != null && steady.accRms >= t.accWarn
      reason = accDriven ? `acceleration ${steady.accRms.toFixed(1)} m/s²` : null
    } else {
      reason = `image moving ${optical.pct.toFixed(1)}% of the frame`
    }
  }
  const raw = { rotRms: steady?.rotRms ?? null, accRms: steady?.accRms ?? null, samples: steady?.samples ?? 0, motionPct: optical?.pct ?? null }
  if (steady) {
    return row('steady', {
      x: steady.rotRms ?? 0, unit: '°/s', score, status, reason, mode: 'sensor',
      ticks: { warn: rotScore(t.rotWarn) * 100, fail: rotScore(t.rotFail) * 100 }, raw,
    })
  }
  return row('steady', { x: optical.pct, unit: '%', score, status, reason, mode: 'optical', ticks: opticalTicks(), raw })
}

function noiseRow({ sigma }) {
  const t = THRESHOLDS.noise
  if (sigma == null) return row('noise', { display: '…', raw: { sigma: null } })
  const status = sigma >= t.sigmaFail ? STATUS.FAIL : sigma >= t.sigmaWarn ? STATUS.WARN : STATUS.PASS
  return row('noise', {
    x: sigma,
    unit: 'σ',
    score: noiseSigmaScore(sigma, t),
    status,
    ticks: { warn: noiseSigmaScore(t.sigmaWarn, t) * 100, fail: noiseSigmaScore(t.sigmaFail, t) * 100 },
    raw: { sigma },
  })
}

function resolutionRow({ resolution }) {
  if (!resolution) return row('resolution', { raw: {} })
  const d = resolution.details
  const t = THRESHOLDS.resolution
  return row('resolution', {
    value: d.megapixels,
    display: fmtSize(d.width, d.height),
    score: resolution.score,
    pct: resolution.score * 100,
    status: resolution.status,
    reason: resolution.status === STATUS.PASS ? null : resolution.hint,
    ticks: { warn: ramp(t.warnMegapixels, 0.3, 2) * 100, fail: 0 },
    raw: { width: d.width, height: d.height, megapixels: d.megapixels },
    fixed: true, // exact, nothing to smooth
  })
}

// Face has three states beyond "found": off (the task has none), searching (no confident answer
// yet: the detector runs every few ticks and says "no face" on the first empty frame), not found.
function faceRow({ face, faceMode }, state) {
  const N = THRESHOLDS.live.hud.faceMissesBeforeNotFound
  if (!faceMode || faceMode === 'off') return row('face', { display: 'off', raw: { mode: 'off' } })
  if (!face) return row('face', { display: 'searching…', raw: { mode: faceMode } })
  const d = face.details ?? {}
  if (d.count === 0) {
    if (state.faceMisses < N) return row('face', { display: 'searching…', raw: { mode: faceMode, misses: state.faceMisses } })
    return row('face', {
      display: 'not found',
      score: 0,
      pct: 0,
      status: faceMode === 'required' ? STATUS.FAIL : STATUS.WARN,
      reason: face.hint,
      raw: { mode: faceMode, misses: state.faceMisses },
      fixed: true,
    })
  }
  const status = faceMode === 'optional' && face.status === STATUS.FAIL ? STATUS.WARN : face.status
  const t = THRESHOLDS.face
  return row('face', {
    x: (d.score ?? 0) * 100,
    x2: (d.heightFrac ?? 0) * 100,
    unit: '%',
    score: face.score,
    status,
    reason: status === STATUS.PASS ? null : face.hint,
    ticks: { warn: t.minScoreWarn * 100, fail: t.minScoreFail * 100 }, // confidence levels
    raw: { confidence: d.score, heightFrac: d.heightFrac, visibleFrac: d.visibleFrac, yaw: d.yaw, roll: d.roll },
  })
}

// Placeholder until the challenge state machine feeds it (Phase 7c): shows that the check exists on this task.
function livenessRow({ liveness, faceMode }) {
  if (!liveness) return row('liveness', { display: faceMode === 'required' ? 'required' : 'not checked', raw: { mode: faceMode } })
  return row('liveness', liveness)
}

// ---- smoothing ------------------------------------------------------------------------------
const ema = (prev, x, a) => (prev == null ? x : prev + a * (x - prev))

function smooth(r, state, cfg) {
  const next = { ...r }
  const prevE = state.ema[r.id] ?? {}
  const e = {}
  const a = cfg.ema
  if (r.x != null && !r.fixed) {
    e.x = ema(prevE.x, r.x, a)
    if (r.x2 != null) e.x2 = ema(prevE.x2, r.x2, a)
    if (r.score != null) e.score = ema(prevE.score, r.score, a)
  } else if (r.score != null) {
    e.score = r.score
  }
  next.value = e.x ?? r.value
  if (e.score != null) next.score = e.score

  // Display from the smoothed number.
  switch (r.id) {
    case 'brightness':
      next.display = pct0(e.x)
      next.pct = e.x
      break
    case 'focus':
      if (e.x != null) { next.display = pct0(e.x); next.pct = e.x }
      break
    case 'lens':
      next.display = lensText(e.x / 100, r.fullCover)
      next.pct = (e.score ?? 0) * 100
      break
    case 'glare':
      next.display = `${e.x.toFixed(e.x < 10 ? 1 : 0)}%`
      next.pct = (e.score ?? 0) * 100
      break
    case 'steady':
      if (e.x != null) { next.display = r.mode === 'optical' ? fmtMotion(e.x) : fmtRot(e.x); next.pct = (e.score ?? 0) * 100 }
      break
    case 'noise':
      if (e.x != null) { next.display = fmtSigma(e.x); next.pct = (e.score ?? 0) * 100 }
      break
    case 'face':
      if (e.x != null) { next.display = fmtFace(e.x / 100, e.x2 / 100); next.pct = (e.score ?? 0) * 100 }
      break
    default:
      break
  }
  return { row: next, ema: e }
}

// A status only changes once the new one has been seen on `cfg.hysteresisTicks` consecutive ticks.
// Only between two SCORED readings: a row that starts or stops having a score (face: searching ->
// not found, steadiness: sensor appears) is a change of state, not a flicker, and shows at once.
function hysteresis(r, shown, cfg) {
  const prev = shown[r.id]
  const hasScore = r.score != null
  if (!prev || prev.hasScore !== hasScore) return { status: r.status, entry: { status: r.status, pending: null, n: 0, hasScore } }
  if (r.status === prev.status) return { status: prev.status, entry: { status: prev.status, pending: null, n: 0, hasScore } }
  const n = prev.pending === r.status ? prev.n + 1 : 1
  if (n >= cfg.hysteresisTicks) return { status: r.status, entry: { status: r.status, pending: null, n: 0, hasScore } }
  return { status: prev.status, entry: { status: prev.status, pending: r.status, n, hasScore } }
}

// inputs: { exposure, blurScore, lens, glare:{m,status,hint}, steady, optical, sigma, resolution, face, faceSeq, faceMode }
// prev: the `state` this returned last tick (initialHudState() the first time).
export function computeLiveMetrics(inputs, prev = initialHudState(), cfg = THRESHOLDS.live.hud) {
  // The noise crop is only read every other tick: keep the last σ in between.
  const sigma = inputs.sigma ?? prev.sigma

  // Face: count consecutive EMPTY detections, once per new detection (not once per tick).
  let faceMisses = prev.faceMisses
  const seq = inputs.faceSeq
  if (inputs.face && (seq == null || seq !== prev.faceSeq)) {
    faceMisses = inputs.face.details?.count === 0 ? faceMisses + 1 : 0
  }
  const state0 = { ...prev, faceMisses }

  const built = {
    brightness: brightnessRow(inputs),
    focus: focusRow(inputs),
    lens: lensRow(inputs),
    glare: glareRow(inputs),
    steady: steadyRow(inputs),
    noise: noiseRow({ sigma }),
    resolution: resolutionRow(inputs),
    face: faceRow(inputs, state0),
    liveness: livenessRow(inputs),
  }
  const order = hudOrder(inputs.faceMode)

  const metrics = {}
  const emaOut = {}
  const shownOut = {}
  for (const id of order) {
    const { row: sm, ema: e } = smooth(built[id], state0, cfg)
    const h = hysteresis(sm, prev.shown, cfg)
    sm.status = h.status
    metrics[id] = sm
    emaOut[id] = e
    shownOut[id] = h.entry
  }

  const scores = order.map((id) => metrics[id].score).filter((s) => s != null)
  const overallScore = scores.length ? combineScores(scores) : null
  return {
    metrics,
    overall: { score: overallScore, pct: overallScore == null ? null : overallScore * 100, count: scores.length },
    state: { ema: emaOut, shown: shownOut, faceMisses, faceSeq: seq ?? prev.faceSeq, sigma },
  }
}
