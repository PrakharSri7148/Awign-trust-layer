import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeFrame, decodeToFrame, runPhotoQuality } from './index.js'
import { aggregate } from './policy.js'
import { analysisSize, patchOrigins, resizeGray, rgbaToGray } from './frame.js'
import { STATUS, VERDICT, checkResult } from './schema.js'
import { nodeEnv, asFile, encodeImage } from './testing/nodeEnv.js'
import { boxBlur, frameFromGray, sceneGray, toRgba } from './testing/synth.js'

test('analysisSize only ever shrinks, keeps aspect ratio', () => {
  assert.deepEqual(analysisSize(4000, 3000), { width: 1280, height: 960 })
  assert.deepEqual(analysisSize(300, 200), { width: 300, height: 200 })
  assert.deepEqual(analysisSize(1, 10000), { width: 1, height: 1280 })
})

test('rgbaToGray uses BT.601 luma', () => {
  const g = rgbaToGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]))
  assert.ok(Math.abs(g[0] - 76.245) < 1e-3)
  assert.ok(Math.abs(g[1] - 149.685) < 1e-3)
  assert.ok(Math.abs(g[2] - 29.07) < 1e-3)
})

test('resizeGray averages blocks', () => {
  const src = Float32Array.from([0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100])
  const { gray, width, height } = resizeGray(src, 4, 4, 2)
  assert.equal(width, 2)
  assert.equal(height, 2)
  assert.deepEqual([...gray], [50, 50, 50, 50])
})

test('patch origins are 8px aligned and inside the image', () => {
  for (const [w, h] of [[4000, 3000], [1000, 700], [200, 100], [384, 384]]) {
    for (const p of patchOrigins(w, h)) {
      assert.equal(p.x % 8, 0)
      assert.equal(p.y % 8, 0)
      assert.ok(p.x + p.width <= w && p.y + p.height <= h)
    }
  }
})

test('policy: blocking fail > warn > pass, issues ordered', () => {
  const r = [
    checkResult('noise', { status: STATUS.WARN, score: 0.5, hint: 'n' }),
    checkResult('blur', { status: STATUS.FAIL, score: 0.1, hint: 'b' }),
    checkResult('glare', { status: STATUS.FAIL, score: 0.2, hint: 'g' }),
    checkResult('shake', { status: STATUS.PASS, score: 1 }),
  ]
  const out = aggregate(r)
  assert.equal(out.verdict, VERDICT.BLOCK)
  assert.deepEqual(out.issues.map((i) => i.id), ['blur', 'glare', 'noise'])
  assert.equal(out.issues[1].blocking, false) // glare is flag-only
  assert.equal(aggregate([checkResult('glare', { status: STATUS.FAIL, score: 0 })]).verdict, VERDICT.WARN)
  assert.equal(aggregate([checkResult('blur', { status: STATUS.PASS, score: 1 })]).verdict, VERDICT.PASS)
  assert.equal(aggregate([]).verdict, VERDICT.PASS)
})

test('optional face never blocks', () => {
  const r = [checkResult('face', { status: STATUS.FAIL, score: 0 })]
  assert.equal(aggregate(r, { task: { face: 'optional' } }).verdict, VERDICT.WARN)
  assert.equal(aggregate(r, { task: { face: 'required' } }).verdict, VERDICT.BLOCK)
})

test('a throwing check is isolated and reported as skip', () => {
  const frame = frameFromGray(sceneGray(120, 80), 120, 80)
  const report = analyzeFrame(frame, { checks: { blur: () => { throw new Error('boom') } } })
  assert.equal(report.checks.blur.status, STATUS.SKIP)
  assert.equal(report.checks.blur.details.error, 'boom')
  assert.equal(report.verdict, VERDICT.PASS)
})

test('decode path: sharp PNG passes, blurred PNG blocks (real decode + scale)', async () => {
  const w = 1200
  const h = 900
  const sharp = sceneGray(w, h, 5)
  const sharpFile = asFile(encodeImage(toRgba(sharp), w, h, { type: 'png' }), 'image/png')
  const blurFile = asFile(encodeImage(toRgba(boxBlur(sharp, w, h, 14)), w, h, { type: 'png' }), 'image/png')

  const ok = await runPhotoQuality(sharpFile, { env: nodeEnv })
  const bad = await runPhotoQuality(blurFile, { env: nodeEnv })
  assert.equal(ok.metrics.width, w)
  assert.equal(ok.metrics.height, h)
  assert.equal(ok.checks.blur.status, STATUS.PASS)
  assert.equal(bad.checks.blur.status, STATUS.FAIL)
  assert.equal(bad.verdict, VERDICT.BLOCK)
})

test('decode path builds native patches and an analysis frame <= 1280px', async () => {
  const w = 2000
  const h = 1500
  const file = asFile(encodeImage(toRgba(sceneGray(w, h, 2)), w, h, { type: 'jpeg', quality: 92 }), 'image/jpeg')
  const frame = await decodeToFrame(file, { env: nodeEnv })
  assert.equal(frame.width, 1280)
  assert.equal(frame.height, 960)
  assert.equal(frame.native.width, w)
  assert.equal(frame.native.mime, 'image/jpeg')
  assert.ok(frame.native.bytes > 0)
  assert.ok(frame.native.patches.length >= 1)
  assert.equal(frame.native.patches[0].width, 384)
})

test('undecodable input rejects with a clear error', async () => {
  await assert.rejects(runPhotoQuality(asFile(Buffer.from('not an image'), 'image/jpeg'), { env: nodeEnv }), /Could not decode image/)
})
