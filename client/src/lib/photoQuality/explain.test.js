import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeFrame, evaluateFace } from './index.js'
import { explainReport } from './explain.js'
import { withCheck } from './merge.js'
import { STATUS } from './schema.js'
import { THRESHOLDS, taskConfig } from './config.js'
import { boxBlur, frameFromGray, sceneGray } from './testing/synth.js'

const W = 960
const H = 640
const BIG = { native: { width: 4000, height: 3000 } } // so the resolution check stays out of the way
const sharp = sceneGray(W, H, 7)

function face({ h = 0.35, score = 0.92 } = {}) {
  const hPx = h * H
  const wPx = 0.78 * hPx
  return {
    box: { x: 0.5 - wPx / W / 2, y: 0.45 - h / 2, w: wPx / W, h },
    score,
    keypoints: [
      { x: 0.47, y: 0.4 },
      { x: 0.53, y: 0.4 },
      { x: 0.5, y: 0.47 },
      { x: 0.5, y: 0.55 },
      { x: 0.44, y: 0.4 },
      { x: 0.56, y: 0.4 },
    ],
  }
}

test('a blocked blur says which check, the Focus % on screen and the Focus % it needs', () => {
  const report = analyzeFrame(frameFromGray(boxBlur(sharp, W, H, 6), W, H))
  const blur = explainReport(report).find((e) => e.id === 'blur')
  assert.ok(blur, 'blur is listed')
  assert.equal(blur.blocking, true)
  assert.equal(blur.label, 'Focus')
  assert.match(blur.numbers, /^Focus \d+% — needs at least \d+%$/)
  // the needed % is the % of failBelow, in the same scale the HUD uses
  const need = Math.round(((THRESHOLDS.blur.failBelow - 0.05) / (THRESHOLDS.live.hud.focusFull - 0.05)) * 100)
  assert.ok(blur.numbers.endsWith(`${need}%`), blur.numbers)
})

test('a warn-only photo lists its warnings but nothing as blocking', () => {
  const report = analyzeFrame(frameFromGray(boxBlur(sharp, W, H, 2), W, H))
  const ex = explainReport(report)
  assert.ok(ex.every((e) => !e.blocking), JSON.stringify(ex))
})

test('a clean photo has nothing to explain', () => {
  assert.deepEqual(explainReport(analyzeFrame(frameFromGray(sharp, W, H, BIG))), [])
})

test('face problems carry the measured value and the limit (structured reasons)', () => {
  const r = evaluateFace([face({ h: 0.05 })], frameFromGray(sharp, W, H))
  assert.equal(r.status, STATUS.FAIL)
  const reason = r.details.reasons.find((x) => x.metric === 'height')
  assert.ok(reason && Math.abs(reason.value - 0.05) < 1e-9 && reason.limit === THRESHOLDS.face.minHeightFail)
  const report = withCheck(analyzeFrame(frameFromGray(sharp, W, H), { task: taskConfig('task_selfie_checkin') }), r, taskConfig('task_selfie_checkin'))
  const f = explainReport(report).find((e) => e.id === 'face')
  assert.equal(f.blocking, true)
  assert.match(f.numbers, /face is 5% of the frame height — needs at least 8%/)
})

test('a blurred face crop is explained with the crop sharpness and its limit', () => {
  const gray = sharp.slice()
  const f = face()
  const blurred = boxBlur(gray, W, H, 6)
  const r = evaluateFace([f], frameFromGray(blurred, W, H))
  const reason = (r.details.reasons ?? []).find((x) => x.metric === 'cropBlur')
  assert.ok(reason, JSON.stringify(r.details.reasons))
  assert.ok([THRESHOLDS.face.cropBlurFail, THRESHOLDS.face.cropBlurWarn].includes(reason.limit))
  assert.ok(reason.value < reason.limit, 'the measured value is below the limit it was judged against')
  assert.ok(r.details.crop.width > 0 && r.details.crop.height > 0, 'crop size is reported')
})
