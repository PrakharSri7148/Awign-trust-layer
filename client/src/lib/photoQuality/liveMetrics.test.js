import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeLive } from './live.js'
import { HUD_ORDER, computeLiveMetrics, initialHudState } from './liveMetrics.js'
import { combineScores } from './policy.js'
import { evaluateFace } from './face/facecheck.js'
import { STATUS } from './schema.js'
import { addNoise, adjust, boxBlur, frameFromGray, makeGray, mapChannels, paintDisc, paintRect, sceneGray, toRgba } from './testing/synth.js'

const W = 480
const H = 270
const scene = sceneGray(W, H, 4)
const colour = (g = scene) => mapChannels(toRgba(g), W, H, (c, i) => c.map((v) => v * [1.05, 0.98, 0.9][i]))
const frameOf = (g = scene, rgba) => frameFromGray(g, W, H, { rgba: rgba ?? colour(g) })
const VIDEO = { width: 1920, height: 1080 }
const steady = Array.from({ length: 10 }, (_, i) => ({ t: i, rot: 2, acc: 0.1 }))
const shaky = Array.from({ length: 10 }, (_, i) => ({ t: i, rot: 156, acc: 4 }))
// 256x256 native crop with a known amount of noise
const crop = (sigma, seed = 5) => ({ gray: addNoise(makeGray(256, 256, (x, y) => 120 + 0.1 * x + 0.05 * y), sigma, seed), width: 256, height: 256 })

const live = (o = {}, g, rgba) => analyzeLive(frameOf(g, rgba), { video: VIDEO, nativeCrop: crop(0.3), motion: steady, ...o })
const m = (r, id) => r.metrics[id]
const faceFound = (conf = 0.92, h = 0.21) => ({ status: STATUS.PASS, score: 0.9, hint: null, details: { count: 1, score: conf, heightFrac: h, box: { x: 0.4, y: 0.3, w: 0.15, h } } })
const faceNone = () => evaluateFace([], frameOf())

test('shape: 8 rows in a fixed order, each with value/display/pct/score/status/ticks; compression is not a row', () => {
  const r = live()
  assert.deepEqual(HUD_ORDER, ['brightness', 'focus', 'lens', 'glare', 'steady', 'noise', 'resolution', 'face'])
  assert.deepEqual(Object.keys(r.metrics), HUD_ORDER)
  for (const id of HUD_ORDER) for (const k of ['id', 'label', 'display', 'pct', 'score', 'status', 'ticks', 'raw', 'reason']) assert.ok(k in m(r, id), `${id}.${k}`)
  assert.equal(r.metrics.compression, undefined)
})

test('a good frame: every row passes, with plausible numbers', () => {
  const r = live()
  for (const id of ['brightness', 'focus', 'lens', 'glare', 'steady', 'noise', 'resolution']) assert.equal(m(r, id).status, STATUS.PASS, `${id}: ${m(r, id).display}`)
  assert.match(m(r, 'brightness').display, /^\d+%$/)
  assert.ok(m(r, 'focus').pct >= 70, `focus ${m(r, 'focus').display}`)
  assert.equal(m(r, 'lens').display, 'clear')
  assert.equal(m(r, 'resolution').display, '1920×1080')
  assert.match(m(r, 'noise').display, /^σ 0\.\d$/)
  assert.ok(r.overall.pct > 75, `overall ${r.overall.pct}`)
})

test('brightness: dark fails below ~16%, warns 16-25%, and reads luma/255', () => {
  const dark = live({}, adjust(scene, 0.15, 0))
  assert.equal(m(dark, 'brightness').status, STATUS.FAIL)
  assert.ok(m(dark, 'brightness').pct < 16)
  const dim = live({}, adjust(scene, 0.42, 0))
  assert.equal(m(dim, 'brightness').status, STATUS.WARN)
  assert.ok(m(dim, 'brightness').pct > 16 && m(dim, 'brightness').pct < 25.5, `${m(dim, 'brightness').pct}`)
  const mean = scene.reduce((a, v) => a + v, 0) / scene.length
  assert.ok(Math.abs(m(live(), 'brightness').pct - (mean / 255) * 100) < 6)
})

test('brightness: over-exposure explains itself and the bar is a position bar with two-sided ticks', () => {
  const over = live({}, adjust(scene, 2.2, 70))
  assert.notEqual(m(over, 'brightness').status, STATUS.PASS)
  assert.match(m(over, 'brightness').reason, /clipped|bright/)
  const b = m(live(), 'brightness')
  assert.equal(b.positionBar, true)
  assert.ok(Array.isArray(b.ticks.warn) && Math.abs(b.ticks.warn[0] - 25.5) < 0.1 && Math.abs(b.ticks.warn[1] - 82.4) < 0.1)
  assert.ok(Math.abs(b.ticks.fail[0] - 15.7) < 0.1 && Math.abs(b.ticks.fail[1] - 92.2) < 0.1)
})

test('focus: heavy blur gives a low percentage and a fail; ticks sit at the live thresholds through the same ramp', () => {
  const blurry = live({}, boxBlur(scene, W, H, 10))
  assert.equal(m(blurry, 'focus').status, STATUS.FAIL)
  assert.ok(m(blurry, 'focus').pct < 50, `${m(blurry, 'focus').display}`)
  const t = m(live(), 'focus').ticks
  assert.ok(Math.abs(t.fail - 43) < 1 && Math.abs(t.warn - 66) < 1, JSON.stringify(t))
})

test('focus: a flat scene shows "—" and is excluded from the overall', () => {
  const flat = live({}, makeGray(W, H, () => 150))
  assert.equal(m(flat, 'focus').display, '—')
  assert.equal(m(flat, 'focus').score, null)
  assert.equal(m(flat, 'focus').status, STATUS.PASS)
})

test('noise: sigma 6 reads ~6 and warns; a clean crop is fine; between crops the last sigma is kept', () => {
  const noisy = live({ nativeCrop: crop(6) })
  const sigma = m(noisy, 'noise').raw.sigma
  assert.ok(Math.abs(sigma - 6) < 1, `sigma ${sigma}`)
  assert.equal(m(noisy, 'noise').status, STATUS.WARN)
  assert.equal(live({ nativeCrop: crop(11) }).metrics.noise.status, STATUS.FAIL)
  // the crop is only read every other tick; the next tick passes none
  const next = analyzeLive(frameOf(), { video: VIDEO, nativeCrop: null, motion: steady, prev: noisy.state })
  assert.ok(Math.abs(m(next, 'noise').raw.sigma - 6) < 1)
  // before the first crop there is nothing to show
  const none = analyzeLive(frameOf(), { video: VIDEO, nativeCrop: null })
  assert.equal(m(none, 'noise').display, '…')
  assert.equal(m(none, 'noise').score, null)
})

test('lens: a covered area is not "clear"; full cover reads "covered"', () => {
  const rgba = colour()
  paintRect(rgba, W, H, 0, 0, W * 0.6, H, [8, 8, 8])
  const r = live({}, scene, rgba)
  assert.equal(m(r, 'lens').status, STATUS.FAIL)
  assert.notEqual(m(r, 'lens').display, 'clear')
  const black = live({}, makeGray(W, H, () => 5))
  assert.equal(m(black, 'lens').display, 'covered')
})

test('glare: a soft blown-out spot is reported with its area', () => {
  const rgba = colour()
  paintDisc(rgba, W, H, 360, 90, 85, [255, 255, 255], { soft: 0.6 }) // a soft-edged reflection
  const r = live({}, scene, rgba)
  assert.notEqual(m(r, 'glare').status, STATUS.PASS)
  assert.match(m(r, 'glare').display, /%$/)
})

test('steadiness: shows RMS degrees per second; acceleration-driven warnings say so; no sensor is excluded', () => {
  assert.equal(m(live({ motion: shaky }), 'steady').display, '156°/s')
  assert.equal(m(live({ motion: shaky }), 'steady').status, STATUS.FAIL)
  assert.ok(m(live({ motion: steady }), 'steady').pct > 85)
  const accel = Array.from({ length: 10 }, (_, i) => ({ t: i, rot: 5, acc: 2.2 }))
  const a = m(live({ motion: accel }), 'steady')
  assert.notEqual(a.status, STATUS.PASS)
  assert.match(a.reason, /acceleration 2\.2 m\/s²/) // never a warning with no visible cause
  // no sensor AND no previous frame yet: "measuring…", excluded (a laptop gets the image-based reading from the 2nd tick)
  const none = m(live({ motion: null }), 'steady')
  assert.equal(none.display, 'measuring…')
  assert.equal(none.score, null)
})

test('resolution tiers from the video size', () => {
  const at = (width, height) => live({ video: { width, height } }).metrics.resolution
  assert.equal(at(640, 360).status, STATUS.FAIL)
  assert.equal(at(960, 640).status, STATUS.WARN)
  assert.equal(at(1920, 1080).status, STATUS.PASS)
  assert.equal(at(1920, 1080).display, '1920×1080')
  assert.equal(analyzeLive(frameOf()).metrics.resolution.display, '—') // no video info yet
})

test('face: off / searching / not found (3 consecutive empties) / found, and which count towards the overall', () => {
  const off = live({ task: { face: 'off' } })
  assert.equal(m(off, 'face').display, 'off')
  assert.equal(m(off, 'face').score, null)

  // required task, no detection yet -> searching, excluded
  let r = live({ task: { face: 'required' }, face: null })
  assert.equal(m(r, 'face').display, 'searching…')
  assert.equal(m(r, 'face').score, null)

  // one and two empty detections are still "searching" (evaluateFace itself already says FAIL)
  const none = faceNone()
  assert.equal(none.status, STATUS.FAIL)
  r = live({ task: { face: 'required' }, face: none, faceSeq: 1 })
  assert.equal(m(r, 'face').display, 'searching…')
  r = live({ task: { face: 'required' }, face: none, faceSeq: 2, prev: r.state })
  assert.equal(m(r, 'face').display, 'searching…')
  // the SAME detection seen again on later ticks must not count as another miss
  r = live({ task: { face: 'required' }, face: none, faceSeq: 2, prev: r.state })
  assert.equal(m(r, 'face').display, 'searching…')
  // third consecutive empty detection -> not found: required = fail, scored 0 and included
  r = live({ task: { face: 'required' }, face: none, faceSeq: 3, prev: r.state })
  assert.equal(m(r, 'face').display, 'not found')
  assert.equal(m(r, 'face').status, STATUS.FAIL)
  assert.equal(m(r, 'face').score, 0)
  assert.ok(r.overall.score < 0.5 * 0.9) // the zero drags the overall down

  // optional task: amber, not red
  let o = { state: undefined }
  for (let i = 1; i <= 3; i++) o = live({ task: { face: 'optional' }, face: none, faceSeq: i, prev: o.state })
  assert.equal(m(o, 'face').status, STATUS.WARN)

  // found: confidence and size, and a detection resets the miss counter
  const f = live({ task: { face: 'required' }, face: faceFound(), faceSeq: 4, prev: r.state })
  assert.equal(m(f, 'face').display, '92% · 21%')
  assert.equal(f.state.faceMisses, 0)
})

test('EMA damps jitter on a static scene to within +-3 points after warm-up', () => {
  let prev = initialHudState()
  const shown = []
  for (let i = 0; i < 24; i++) {
    const wobble = i % 2 ? 15 : -15 // +-6% of 255 swing in the raw brightness
    const r = analyzeLive(frameOf(adjust(scene, 1, wobble)), { video: VIDEO, nativeCrop: crop(0.3), motion: steady, prev })
    prev = r.state
    if (i >= 8) shown.push(m(r, 'brightness').pct)
  }
  assert.ok(Math.max(...shown) - Math.min(...shown) <= 6, `swing ${Math.max(...shown) - Math.min(...shown)}`) // i.e. +-3
})

test('hysteresis: a status flips only after two consecutive ticks', () => {
  let r = live()
  assert.equal(m(r, 'brightness').status, STATUS.PASS)
  const darkFrame = adjust(scene, 0.15, 0)
  r = analyzeLive(frameOf(darkFrame), { video: VIDEO, nativeCrop: crop(0.3), prev: r.state })
  assert.equal(m(r, 'brightness').status, STATUS.PASS, 'one dark tick is not enough')
  r = analyzeLive(frameOf(darkFrame), { video: VIDEO, nativeCrop: crop(0.3), prev: r.state })
  assert.equal(m(r, 'brightness').status, STATUS.FAIL, 'the second one flips it')
  // a single good tick in between resets the pending flip
  let q = live()
  q = analyzeLive(frameOf(darkFrame), { video: VIDEO, prev: q.state })
  q = analyzeLive(frameOf(), { video: VIDEO, prev: q.state })
  q = analyzeLive(frameOf(darkFrame), { video: VIDEO, prev: q.state })
  assert.equal(m(q, 'brightness').status, STATUS.PASS)
})

test('overall = combineScores of the included rows (and nothing else)', () => {
  const r = live({ task: { face: 'off' } })
  const included = HUD_ORDER.map((id) => m(r, id).score).filter((s) => s != null)
  assert.ok(Math.abs(r.overall.score - combineScores(included)) < 1e-12)
  assert.equal(r.overall.count, included.length)
  assert.equal(r.overall.pct, r.overall.score * 100)
  // rows with nothing to judge are left out, not counted as zero or one
  const sparse = computeLiveMetrics({ exposure: { details: { mean: 100, clippedFrac: 0, range: 100, kind: null }, score: null, status: 'pass' }, blurScore: null, lens: { details: { area: 0, fullCover: false }, score: null, status: 'pass' }, glare: { m: { area: 0, soft: false }, status: 'pass' }, steady: null, sigma: null, resolution: null, face: null, faceMode: 'off' })
  assert.equal(sparse.overall.count, 1) // only glare has a score here
  assert.equal(sparse.overall.score, 1)
})

test('combineScores is half the worst plus half the mean (pinned to the Python copy)', () => {
  assert.ok(Math.abs(combineScores([0.2, 0.6, 1.0]) - 0.4) < 1e-12)
  assert.equal(combineScores([]), 1)
})

test('the HUD never changes what the chips say', () => {
  const r = live({}, adjust(scene, 0.15, 0))
  assert.equal(r.checks.light.status, STATUS.FAIL)
  assert.equal(r.hintId, 'light')
  assert.ok('clean' in r && 'hint' in r)
})

test('face tasks get a Liveness row that has no score yet and so stays out of the overall; other tasks do not', () => {
  const none = live()
  assert.ok(!('liveness' in none.metrics))
  const req = live({ task: { face: 'required' }, face: faceFound() })
  assert.deepEqual(Object.keys(req.metrics), [...HUD_ORDER, 'liveness'])
  assert.equal(m(req, 'liveness').display, 'required')
  assert.equal(m(req, 'liveness').score, null)
  const opt = live({ task: { face: 'optional' }, face: faceFound() })
  assert.equal(m(opt, 'liveness').display, 'not checked')
  const scored = Object.values(req.metrics).map((x) => x.score).filter((s) => s != null)
  assert.equal(req.overall.count, scored.length)
})
