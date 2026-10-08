import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeFrameAsync, evaluateFace, softenCropBlur } from './index.js'
import { STATUS, VERDICT } from './schema.js'
import { taskConfig } from './config.js'
import { boxBlur, frameFromGray, sceneGray } from './testing/synth.js'

// Regression (Phase 8b): a face task used to BLOCK on the face-crop sharpness alone even when the whole photo was in focus.
const W = 960
const H = 640
const BIG = { native: { width: 4000, height: 3000 } }
const task = taskConfig('task_selfie_checkin')
const scene = sceneGray(W, H, 7)

function face(h = 0.5) {
  const hPx = h * H
  const wPx = 0.78 * hPx
  return {
    box: { x: 0.5 - wPx / W / 2, y: 0.5 - h / 2, w: wPx / W, h },
    score: 0.92,
    keypoints: [{ x: 0.47, y: 0.45 }, { x: 0.53, y: 0.45 }, { x: 0.5, y: 0.52 }, { x: 0.5, y: 0.6 }, { x: 0.44, y: 0.45 }, { x: 0.56, y: 0.45 }],
  }
}
// sharp photo, soft face crop (the face box plus the margin the sharpness measurement samples)
function softFaceOnSharpPhoto() {
  const f = face()
  const blurred = boxBlur(scene, W, H, 12)
  return scene.map((v, i) => {
    const x = (i % W) / W
    const y = Math.floor(i / W) / H
    const mx = 0.25 * f.box.w
    const my = 0.25 * f.box.h
    return x > f.box.x - mx && x < f.box.x + f.box.w + mx && y > f.box.y - my && y < f.box.y + f.box.h + my ? blurred[i] : v
  })
}
const run = (gray) => analyzeFrameAsync(frameFromGray(gray, W, H, BIG), { task, detector: { detect: async () => [face()] } })

test('the face-crop evaluation alone still fails a soft face (the logic is unchanged)', () => {
  const r = evaluateFace([face()], frameFromGray(softFaceOnSharpPhoto(), W, H, BIG))
  assert.equal(r.status, STATUS.FAIL)
})

test('a soft face on an in-focus photo is a WARNING, not a block: the worker can submit', async () => {
  const report = await run(softFaceOnSharpPhoto())
  assert.notEqual(report.checks.blur.status, STATUS.FAIL, `whole-frame focus ${report.checks.blur.value}`)
  assert.equal(report.checks.face.status, STATUS.WARN)
  assert.equal(report.checks.face.details.softened, 'crop_blur_only')
  assert.notEqual(report.verdict, VERDICT.BLOCK)
})

test('a genuinely blurry photo is still blocked (by the whole-frame focus check)', async () => {
  const report = await run(boxBlur(scene, W, H, 12))
  assert.equal(report.checks.blur.status, STATUS.FAIL)
  assert.equal(report.verdict, VERDICT.BLOCK)
  assert.ok(report.issues.some((i) => i.id === 'blur' && i.blocking))
})

test('a face with another failure (cut off) is NOT softened even if the crop is also soft', () => {
  const cut = { status: STATUS.FAIL, details: { reasons: [{ metric: 'cropBlur', status: STATUS.FAIL }, { metric: 'visible', status: STATUS.FAIL }] } }
  assert.equal(softenCropBlur(cut, { status: STATUS.PASS }), cut)
})

test('no softening when the whole-frame focus itself fails, or when there is no blur result', () => {
  const only = { status: STATUS.FAIL, details: { reasons: [{ metric: 'cropBlur', status: STATUS.FAIL }] } }
  assert.equal(softenCropBlur(only, { status: STATUS.FAIL }), only)
  assert.equal(softenCropBlur(only, null), only)
  assert.equal(softenCropBlur(null, { status: STATUS.PASS }), null)
})
