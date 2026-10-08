import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeFrame, compactReport, evaluateFace } from './index.js'
import { analyzeLive, createReadyTracker, summarize } from './live.js'
import { frameSharpness, pickBest, steadiness } from './burst.js'
import { createMotionBuffer } from './motionBuffer.js'
import { motionSamples, sensorShake } from './checks/shakeSensor.js'
import { withCheck, withSensorShake } from './merge.js'
import { frameFromTransfer, frameToTransfer } from './transfer.js'
import { STATUS, VERDICT, checkResult } from './schema.js'
import { adjust, boxBlur, frameFromGray, makeGray, mapChannels, paintRect, sceneGray, toRgba } from './testing/synth.js'

const W = 480
const H = 360
const scene = sceneGray(W, H, 4)
const colour = (gray = scene) => mapChannels(toRgba(gray), W, H, (g, c) => g.map((v) => v * [1.05, 0.98, 0.9][c]))
const live = (gray = scene, rgba, opts) => analyzeLive(frameFromGray(gray, W, H, { rgba: rgba ?? colour(gray) }), opts)
const steadySamples = Array.from({ length: 10 }, (_, i) => ({ t: i, rot: 2, acc: 0.1 }))
const shakySamples = Array.from({ length: 10 }, (_, i) => ({ t: i, rot: 80, acc: 4 }))

// ---- live feedback ------------------------------------------------------
test('live: a good frame is clean with no hint', () => {
  const r = live()
  assert.equal(r.clean, true, JSON.stringify(Object.entries(r.checks).filter(([, c]) => c.status !== 'pass')))
  assert.equal(r.hint, null)
})

test('live: dark, covered, blurry and glaring frames each raise their own cue', () => {
  const dark = live(adjust(scene, 0.15, 0))
  assert.equal(dark.checks.light.status, STATUS.FAIL)
  assert.equal(dark.hintId, 'light')

  const covered = colour()
  paintRect(covered, W, H, 0, 0, W * 0.6, H, [8, 8, 8])
  const lens = live(scene, covered)
  assert.equal(lens.checks.lens.status, STATUS.FAIL)
  assert.equal(lens.hintId, 'lens') // the lens outranks lighting

  const blurry = live(boxBlur(scene, W, H, 10))
  assert.equal(blurry.checks.focus.status, STATUS.FAIL)
  assert.match(blurry.hint, /focus/i)
})

test('live: motion makes the "steady" cue fire; no sensor means no opinion', () => {
  assert.equal(live(scene, undefined, { motion: shakySamples }).checks.steady.status, STATUS.FAIL)
  assert.equal(live(scene, undefined, { motion: steadySamples }).checks.steady.status, STATUS.PASS)
  assert.equal(live(scene, undefined, { motion: null }).checks.steady.status, STATUS.PASS)
})

test('live: a flat frame is not called out of focus', () => {
  assert.equal(live(makeGray(W, H, () => 150)).checks.focus.status, STATUS.PASS)
})

test('live: the face cue comes from the supplied face result, with its box', () => {
  const face = evaluateFace([], frameFromGray(scene, W, H))
  const r = live(scene, undefined, { face })
  assert.equal(r.checks.face.status, STATUS.FAIL)
  assert.equal(r.hintId, 'face')
})

test('live: headline hint prefers failures and follows the priority order', () => {
  const s = summarize({
    glare: { status: STATUS.FAIL, hint: 'glare!' },
    focus: { status: STATUS.WARN, hint: 'soft' },
    light: { status: STATUS.WARN, hint: 'dim' },
  })
  assert.equal(s.hintId, 'glare') // a failure beats warnings
  const w = summarize({ focus: { status: STATUS.WARN, hint: 'soft' }, light: { status: STATUS.WARN, hint: 'dim' } })
  assert.equal(w.hintId, 'light') // among equals, light comes before focus
})

test('live: "ready" needs consecutive clean frames and resets on any problem', () => {
  const ready = createReadyTracker(3)
  const clean = { clean: true }
  const dirty = { clean: false }
  assert.deepEqual([clean, clean, dirty, clean, clean, clean, clean].map(ready), [false, false, false, false, false, true, true])
})

// ---- burst --------------------------------------------------------------
test('burst: sharpness falls as blur grows; flat frames score low but not zero', () => {
  const s = [0, 4, 10].map((r) => frameSharpness(r ? boxBlur(scene, W, H, r) : scene, W, H))
  assert.ok(s[0] > s[1] && s[1] > s[2], `${s}`)
  assert.ok(frameSharpness(makeGray(W, H, () => 130), W, H) < 0.05)
})

test('burst: the sharpest frame wins, even among mostly blurry ones', () => {
  const frames = [6, 5, 0, 7, 6, 5].map((r, i) => ({ i, sharpness: frameSharpness(r ? boxBlur(scene, W, H, r) : scene, W, H) }))
  assert.equal(pickBest(frames).i, 2)
  assert.equal(pickBest(frames).index, 2) // the position in the input, so the caller can report it
})

test('burst: a slightly less sharp frame taken while the phone was steady beats a sharper one taken mid-shake', () => {
  const a = { id: 'shaky', sharpness: 0.32, motion: shakySamples }
  const b = { id: 'steady', sharpness: 0.29, motion: steadySamples }
  assert.equal(pickBest([a, b]).id, 'steady')
  assert.ok(steadiness(steadySamples) > steadiness(shakySamples))
  assert.equal(steadiness(null), 1) // no sensor: don't penalise
  assert.equal(pickBest([]), null)
})

// ---- sensor shake -------------------------------------------------------
test('sensor shake: thresholds, and too few samples = no verdict', () => {
  assert.equal(sensorShake(steadySamples).status, STATUS.PASS)
  assert.equal(sensorShake(Array.from({ length: 5 }, () => ({ rot: 35, acc: 0.2 }))).status, STATUS.WARN)
  assert.equal(sensorShake(shakySamples).status, STATUS.FAIL)
  assert.equal(sensorShake([{ rot: 99, acc: 9 }]), null)
  assert.equal(sensorShake(null), null)
})

test('motion events become magnitude samples', () => {
  const [s] = motionSamples([{ t: 5, rot: { alpha: 3, beta: 4, gamma: 0 }, acc: { x: 0, y: 3, z: 4 } }])
  assert.deepEqual([s.t, s.rot, s.acc], [5, 5, 5])
  assert.equal(motionSamples([{ t: 1, rot: null, acc: null }])[0].rot, null)
})

test('motion buffer: windows, rolling retention, and a real event feed', () => {
  const buf = createMotionBuffer({ keepMs: 1000 })
  for (let t = 0; t <= 2000; t += 100) buf.push({ t, rot: { alpha: 0, beta: 0, gamma: 10 }, acc: null })
  assert.ok(buf.size <= 11, 'old samples are dropped')
  assert.equal(buf.window(1500, 1800).length, 4)
  assert.equal(buf.window(0, 500).length, 0)
  assert.equal(buf.recent(300, 2000).length, 4)

  const listeners = {}
  const target = { addEventListener: (n, f) => (listeners[n] = f), removeEventListener: (n) => delete listeners[n] }
  const live = createMotionBuffer({ now: () => 42 })
  live.start(target)
  listeners.devicemotion({ rotationRate: { alpha: 1, beta: 2, gamma: 2 }, acceleration: { x: 0, y: 0, z: 0.5 } })
  assert.equal(live.recent(100, 42)[0].rot, 3)
  live.stop()
  assert.equal(listeners.devicemotion, undefined)
})

// ---- merging results computed elsewhere ---------------------------------
const baseReport = () => analyzeFrame(frameFromGray(scene, W, H, { native: { width: 2000, height: 1500 } }))

test('withCheck re-derives verdict and issues when a check is added', () => {
  const r = baseReport()
  assert.equal(r.verdict, VERDICT.PASS)
  const merged = withCheck(r, checkResult('face', { status: STATUS.FAIL, score: 0, hint: 'no face' }), { face: 'required' })
  assert.equal(merged.verdict, VERDICT.BLOCK)
  assert.equal(merged.issues[0].id, 'face')
  assert.ok(merged.qualityScore < r.qualityScore)
  assert.equal(withCheck(r, null), r)
})

test('withSensorShake: the worse of image and sensor wins; both are kept as evidence', () => {
  const r = baseReport()
  assert.equal(r.checks.shake.status, STATUS.PASS)
  const shaky = withSensorShake(r, shakySamples)
  assert.equal(shaky.checks.shake.status, STATUS.FAIL)
  assert.equal(shaky.verdict, VERDICT.WARN) // shake never blocks
  assert.match(shaky.checks.shake.hint, /moving/)
  assert.ok(shaky.checks.shake.details.sensor.rotRms > 60)
  assert.equal(withSensorShake(r, steadySamples).checks.shake.status, STATUS.PASS)
  assert.equal(withSensorShake(r, null), r)
})

// ---- worker transfer -----------------------------------------------------
test('transfer: frames round-trip and shared buffers are listed once', () => {
  const frame = frameFromGray(scene, W, H)
  const { payload, transfer } = frameToTransfer(frame)
  // default frames reuse the analysis gray as the only native patch: one buffer, listed once
  assert.equal(new Set(transfer).size, transfer.length)
  assert.equal(transfer.length, 2) // rgba + gray (the patch is the same gray)
  const back = frameFromTransfer(structuredClone(payload))
  assert.equal(back.width, W)
  assert.deepEqual([...back.gray.slice(0, 5)], [...frame.gray.slice(0, 5)])
  assert.deepEqual(analyzeFrame(back).verdict, analyzeFrame(frame).verdict)
})

test('compactReport sends the sensor evidence to the server (and nothing for file picks)', () => {
  const r = baseReport()
  assert.equal(compactReport(r).sensor, null)
  const c = compactReport(withSensorShake(r, shakySamples))
  assert.ok(c.sensor.rotation_rms > 60 && c.sensor.samples === 10)
  assert.equal(c.checks.shake.status, STATUS.FAIL)
  assert.ok(!JSON.stringify(c).includes('tileScores')) // heavy details are not sent
})

// ---- the worker's message handling (the Worker itself only forwards messages) -----------------
import { handleMessage } from './workerHandlers.js'

test('worker: a live message gives the same HUD numbers as analyzing on this thread', () => {
  const rgba = toRgba(scene)
  const opts = { motion: steadySamples.map((s) => ({ ...s, rot: 2 })), task: { face: 'off' }, video: { width: 1920, height: 1080 }, nativeCrop: null }
  const direct = analyzeLive(frameFromGray(scene, W, H, { rgba }), opts)
  const reply = handleMessage({ id: 7, type: 'live', frame: { rgba, width: W, height: H }, opts })
  assert.equal(reply.id, 7)
  assert.deepEqual(reply.summary.metrics, direct.metrics)
  assert.deepEqual(reply.summary.checks, direct.checks)
  assert.deepEqual(reply.summary.state, direct.state) // the smoothing state comes back for the next tick
})

test('worker: a full-analysis message still works, and a bad message is an error reply, not a crash', () => {
  const { payload } = frameToTransfer(frameFromGray(scene, W, H, { native: { width: 2000, height: 1500 } }))
  const ok = handleMessage({ id: 1, frame: structuredClone(payload), task: {} })
  assert.equal(ok.report.verdict, VERDICT.PASS)
  const bad = handleMessage({ id: 2, type: 'live', frame: null, opts: {} })
  assert.equal(bad.id, 2)
  assert.match(bad.error, /./)
})
