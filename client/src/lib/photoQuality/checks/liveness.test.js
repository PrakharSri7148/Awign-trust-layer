import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withCheck } from '../merge.js'
import { analyzeFrame } from '../index.js'
import { CHECK_IDS, CHECK_LABELS, STATUS, VERDICT } from '../schema.js'
import { evaluateLiveness } from './liveness.js'
import { frameFromGray, sceneGray, toRgba } from '../testing/synth.js'
import { THRESHOLDS } from '../config.js'
import { aggregate } from '../policy.js'
import { checkResult } from '../schema.js'

const required = { face: 'required' }
const optional = { face: 'optional' }
const passed = { status: 'passed', challenges: ['blink', 'smile'], attempts: 1 }

test('liveness is a registered check with a label, ordered right after face', () => {
  assert.ok(CHECK_IDS.includes('liveness'))
  assert.equal(CHECK_IDS.indexOf('liveness'), CHECK_IDS.indexOf('face') + 1)
  assert.equal(CHECK_LABELS.liveness, 'Liveness')
})

test('tasks without a face never run it', () => {
  assert.equal(evaluateLiveness({ task: { face: 'off' }, evidence: passed }), null)
  assert.equal(evaluateLiveness({ task: undefined, evidence: passed }), null)
})

test('required face: passed evidence passes; failed or missing evidence fails (and blocks)', () => {
  assert.equal(evaluateLiveness({ task: required, evidence: passed }).status, STATUS.PASS)
  const failed = evaluateLiveness({ task: required, evidence: { status: 'failed', reason: 'We did not see "blink" in time.' } })
  assert.equal(failed.status, STATUS.FAIL)
  assert.match(failed.hint, /blink/)
  assert.equal(evaluateLiveness({ task: required, evidence: null }).status, STATUS.FAIL) // camera path, no evidence = forged or skipped
})

test('required face with a picked file (no live camera at all): allowed but flagged for review, not stranded', () => {
  const r = evaluateLiveness({ task: required, evidence: null, source: 'file' })
  assert.equal(r.status, STATUS.WARN)
  assert.equal(r.details.reason, 'no_live_camera')
})

test('"send for review" after too many failures is a warning, not a block', () => {
  assert.equal(evaluateLiveness({ task: required, evidence: { status: 'review' } }).status, STATUS.WARN)
})

test('optional face: no evidence = no check; a failure is only a warning', () => {
  assert.equal(evaluateLiveness({ task: optional, evidence: null }), null)
  assert.equal(evaluateLiveness({ task: optional, evidence: { status: 'failed' } }).status, STATUS.WARN)
})

test('policy: a failed liveness blocks a required task, never an optional one', () => {
  const failed = checkResult('liveness', { status: STATUS.FAIL, score: 0, hint: 'x' })
  assert.equal(aggregate([failed], { task: required }).verdict, VERDICT.BLOCK)
  assert.equal(aggregate([failed], { task: optional }).verdict, VERDICT.WARN)
})

test('merged into a real report it changes the verdict and keeps the other checks', () => {
  const g = sceneGray(640, 480, 3)
  const report = analyzeFrame(frameFromGray(g, 640, 480, { rgba: toRgba(g) }), { task: required })
  const blocked = withCheck(report, evaluateLiveness({ task: required, evidence: { status: 'failed' } }), required)
  assert.equal(blocked.verdict, VERDICT.BLOCK)
  assert.ok(blocked.issues.some((i) => i.id === 'liveness' && i.blocking))
  const ok = withCheck(report, evaluateLiveness({ task: required, evidence: passed }), required)
  assert.equal(ok.checks.liveness.status, STATUS.PASS)
  assert.ok(Object.keys(ok.checks).length > Object.keys(report.checks).length - 1)
})

import { combinePassive } from './liveness.js'
import { analyzeLive } from '../live.js'
import { addNoise, boxBlur, makeGray } from '../testing/synth.js'

const spoofy = { photo: { moire: { score: 30 }, bezel: { score: 0.9 } }, live: null }
const clean = { photo: { moire: { score: 3 }, bezel: { score: 0 } }, live: { banding: { score: 0 }, planar: { planar: false } } }

test('combinePassive takes the stronger reading of the photo and the live session', () => {
  const p = combinePassive({ photo: { moire: { score: 3 } }, live: { moire: { score: 30 } } })
  assert.equal(p.signals.moire, 30)
  assert.equal(combinePassive(null), null)
  assert.equal(combinePassive(clean).status, 'pass')
  assert.equal(combinePassive(spoofy).status, 'warn')
})

test('a passed challenge on a picture that looks like a screen is a WARNING for review, never a block', () => {
  const r = evaluateLiveness({ task: required, evidence: passed, passive: spoofy })
  assert.equal(r.status, STATUS.WARN)
  assert.equal(r.details.reason, 'passive_suspicious')
  assert.ok(r.details.passive.score >= 0.45)
  assert.equal(aggregate([r], { task: required }).verdict, VERDICT.WARN)
  assert.equal(evaluateLiveness({ task: required, evidence: passed, passive: clean }).status, STATUS.PASS)
})

test('a FAILED challenge still blocks whatever the passive evidence says', () => {
  assert.equal(evaluateLiveness({ task: required, evidence: { status: 'failed' }, passive: clean }).status, STATUS.FAIL)
})

test('optional face tasks: only passive evidence can flag, and a clean photo adds no Liveness row', () => {
  assert.equal(evaluateLiveness({ task: optional, evidence: null, passive: clean }), null)
  const r = evaluateLiveness({ task: optional, evidence: null, passive: spoofy })
  assert.equal(r.status, STATUS.WARN)
  assert.equal(aggregate([r], { task: optional }).verdict, VERDICT.WARN)
})

// (a screen's grid is rotated against the sensor; an axis-aligned one sits on the JPEG/axis bins the detector ignores on purpose)
test('analyzeLive: face tasks carry passive evidence (moire from the native crop), other tasks do not', () => {
  const W = 480, H = 270
  const base = addNoise(boxBlur(sceneGray(W, H, 4), W, H, 3), 3, 4)
  const rgba = toRgba(base)
  const mkFrame = () => frameFromGray(base, W, H, { rgba: rgba.slice() })
  const crop = (grid) => ({ gray: addNoise(makeGray(256, 256, (x, y) => 120 + 0.1 * x + (grid ? 14 * (Math.cos((2 * Math.PI * (x * 0.98 + y * 0.19)) / 3.3) + Math.cos((2 * Math.PI * (y * 0.98 - x * 0.19)) / 3.3)) / 2 : 0)), 3, 5), width: 256, height: 256 })
  const off = analyzeLive(mkFrame(), { task: { face: 'off' }, video: { width: 1920, height: 1080 } })
  assert.equal(off.passive, null)
  const clean1 = analyzeLive(mkFrame(), { task: { face: 'required' }, nativeCrop: crop(false), video: { width: 1920, height: 1080 } })
  assert.ok(clean1.passive.moire.score != null && clean1.passive.moire.score < THRESHOLDS.passive.moire.warn)
  const grid = analyzeLive(mkFrame(), { task: { face: 'required' }, nativeCrop: crop(true), video: { width: 1920, height: 1080 } })
  assert.ok(grid.passive.moire.score >= THRESHOLDS.passive.moire.fail, String(grid.passive.moire.score))
  // the last moire reading is kept on ticks without a native crop, and the banding ring fills up
  const next = analyzeLive(mkFrame(), { task: { face: 'required' }, prev: grid.state, video: { width: 1920, height: 1080 } })
  assert.equal(next.passive.moire.score, grid.passive.moire.score)
  assert.equal(next.state.profiles.length, 2)
})
