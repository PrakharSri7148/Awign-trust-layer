import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadImage, createCanvas } from '@napi-rs/canvas'
import { analyzeFrame, decodeToFrame } from './index.js'
import { STATUS, VERDICT } from './schema.js'
import { checkBlur } from './checks/blur.js'
import { checkExposure } from './checks/exposure.js'
import { checkResolution } from './checks/resolution.js'
import { blockiness, checkNoise } from './checks/noise.js'
import { checkObstruction } from './checks/obstruction.js'
import { checkGlare } from './checks/glare.js'
import { checkShake } from './checks/shake.js'
import { noiseSigma } from './stats.js'
import { nodeEnv, asFile, encodeImage } from './testing/nodeEnv.js'
import { addNoise, adjust, boxBlur, frameFromGray, makeGray, mapChannels, motionBlur, paintDisc, paintRect, sceneGray, toRgba } from './testing/synth.js'

const W = 960
const H = 640
const scene = sceneGray(W, H, 11)
const frameOf = (gray, opts) => frameFromGray(gray, W, H, opts)
const status = (r) => r.status

// ---- blur ---------------------------------------------------------------
test('blur: sharp scene passes, heavy blur fails', () => {
  assert.equal(status(checkBlur(frameOf(scene))), STATUS.PASS)
  assert.equal(status(checkBlur(frameOf(boxBlur(scene, W, H, 12)))), STATUS.FAIL)
})

test('blur: sensor noise on a blurry photo is NOT mistaken for sharpness (old Laplacian passed this)', () => {
  const noisyBlur = addNoise(boxBlur(scene, W, H, 10), 14)
  assert.notEqual(status(checkBlur(frameOf(noisyBlur))), STATUS.PASS)
})

test('blur: a sharp but dim, low-contrast scene still passes (contrast-invariant)', () => {
  assert.equal(status(checkBlur(frameOf(adjust(scene, 0.2, 15)))), STATUS.PASS)
})

test('blur: a blank wall is "cannot judge" (warn), not "blurry" (fail)', () => {
  const r = checkBlur(frameOf(makeGray(W, H, (x) => 200 + (x / W) * 4)))
  assert.equal(r.status, STATUS.WARN)
  assert.equal(r.details.reason, 'low_texture')
})

test('blur: a sharp subject on a soft background passes', () => {
  const g = boxBlur(scene, W, H, 14)
  const sharp = scene
  // keep the left 55% sharp
  const mixed = g.map((v, i) => ((i % W) < W * 0.55 ? sharp[i] : v))
  assert.equal(status(checkBlur(frameOf(mixed))), STATUS.PASS)
})

test('blur: scores fall monotonically with blur', () => {
  const v = [0, 3, 8, 16].map((r) => checkBlur(frameOf(r ? boxBlur(scene, W, H, r) : scene)).value)
  for (let i = 1; i < v.length; i++) assert.ok(v[i] < v[i - 1], `${v}`)
})

async function realFrame(name, mapPixels) {
  const img = await loadImage(fs.readFileSync(new URL(`./testing/fixtures/${name}`, import.meta.url)))
  const c = createCanvas(img.width, img.height)
  c.getContext('2d').drawImage(img, 0, 0)
  let rgba = new Uint8ClampedArray(c.getContext('2d').getImageData(0, 0, img.width, img.height).data)
  if (mapPixels) rgba = mapPixels(rgba, img.width, img.height)
  const bytes = encodeImage(rgba, img.width, img.height, { type: 'jpeg', quality: 93 })
  return decodeToFrame(asFile(bytes, 'image/jpeg'), { env: nodeEnv })
}

test('real photos: sharp originals pass blur/exposure/obstruction; heavy blur fails', async () => {
  for (const name of ['china.jpg', 'flower.jpg']) {
    const f = await realFrame(name)
    assert.equal(checkBlur(f).status, STATUS.PASS, `${name} blur`)
    assert.equal(checkExposure(f).status, STATUS.PASS, `${name} exposure`)
    assert.equal(checkObstruction(f).status, STATUS.PASS, `${name} obstruction`)
    const soft = await realFrame(name, (px, w, h) => mapChannels(px, w, h, (g) => boxBlur(g, w, h, 5, 3)))
    assert.notEqual(checkBlur(soft).status, STATUS.PASS, `${name} blurred`)
  }
})

// ---- exposure -----------------------------------------------------------
test('exposure: normal passes, dark and over-exposed fail with the right kind', () => {
  assert.equal(checkExposure(frameOf(scene)).status, STATUS.PASS)
  const dark = checkExposure(frameOf(adjust(scene, 0.2, 0)))
  assert.equal(dark.status, STATUS.FAIL)
  assert.equal(dark.details.kind, 'dark')
  const over = checkExposure(frameOf(adjust(scene, 1.6, 120)))
  assert.equal(over.status, STATUS.FAIL)
  assert.equal(over.details.kind, 'over')
})

test('exposure: washed-out low contrast warns', () => {
  const r = checkExposure(frameOf(adjust(scene, 0.15, 100)))
  assert.equal(r.status, STATUS.WARN)
  assert.equal(r.details.kind, 'flat')
})

// ---- resolution ---------------------------------------------------------
test('resolution: tiers by native size', () => {
  const t = (w, h) => checkResolution(frameOf(scene, { native: { width: w, height: h } })).status
  assert.equal(t(4000, 3000), STATUS.PASS)
  assert.equal(t(1280, 720), STATUS.PASS) // 0.92 MP
  assert.equal(t(960, 640), STATUS.WARN) // 0.61 MP
  assert.equal(t(640, 360), STATUS.FAIL) // short side < 480
  assert.equal(t(320, 240), STATUS.FAIL)
})

test('resolution uses the ORIGINAL size even though analysis is downscaled', async () => {
  const w = 2000
  const h = 1500
  const file = asFile(encodeImage(toRgba(sceneGray(w, h, 3)), w, h, { type: 'jpeg', quality: 90 }), 'image/jpeg')
  const f = await decodeToFrame(file, { env: nodeEnv })
  assert.equal(f.width, 1280)
  assert.equal(checkResolution(f).status, STATUS.PASS)
  assert.equal(checkResolution(f).details.width, 2000)
})

// ---- noise / compression -----------------------------------------------
test('noise sigma estimate is accurate on white noise and ignores edges', () => {
  for (const s of [2, 5, 10]) {
    const flat = addNoise(makeGray(W, H, () => 128), s, 4)
    assert.ok(Math.abs(noiseSigma(flat, W, H) - s) < 0.15 * s, `sigma ${s}`)
    // The same noise on a busy scene: the median estimator should stay close.
    const busy = addNoise(scene, s, 4)
    assert.ok(Math.abs(noiseSigma(busy, W, H) - s) < 0.35 * s + 0.5, `busy sigma ${s}`)
  }
})

test('noise: clean passes, grainy flagged', () => {
  assert.equal(checkNoise(frameOf(scene)).status, STATUS.PASS)
  assert.equal(checkNoise(frameOf(addNoise(scene, 7))).status, STATUS.WARN)
  assert.equal(checkNoise(frameOf(addNoise(scene, 14))).status, STATUS.FAIL)
})

test('compression: JPEG blockiness rises as quality drops', async () => {
  const w = 1200
  const h = 800
  const rgba = toRgba(sceneGray(w, h, 8))
  const blocks = []
  for (const q of [95, 60, 20]) {
    const f = await decodeToFrame(asFile(encodeImage(rgba, w, h, { type: 'jpeg', quality: q }), 'image/jpeg'), { env: nodeEnv })
    blocks.push(f.native.patches.map((p) => blockiness(p.gray, p.width, p.height)).reduce((a, b) => a + b, 0) / f.native.patches.length)
  }
  assert.ok(blocks[0] < blocks[1] && blocks[1] < blocks[2], `${blocks}`)
  assert.ok(blocks[0] < 1.15, `clean q95 should not look blocky: ${blocks[0]}`)
})

test('compression: heavy JPEG is flagged, high quality is not', async () => {
  const w = 1200
  const h = 800
  const rgba = toRgba(sceneGray(w, h, 8))
  const hi = await decodeToFrame(asFile(encodeImage(rgba, w, h, { type: 'jpeg', quality: 95 }), 'image/jpeg'), { env: nodeEnv })
  const lo = await decodeToFrame(asFile(encodeImage(rgba, w, h, { type: 'jpeg', quality: 12 }), 'image/jpeg'), { env: nodeEnv })
  assert.equal(checkNoise(hi).status, STATUS.PASS)
  assert.notEqual(checkNoise(lo).status, STATUS.PASS)
})

// ---- obstruction --------------------------------------------------------
const colorScene = () => {
  const r = toRgba(scene)
  return mapChannels(r, W, H, (g, c) => g.map((v) => v * [1.05, 0.98, 0.9][c]))
}

test('obstruction: clean scene, plain wall and sky region are not "covered"', () => {
  assert.equal(checkObstruction(frameOf(scene, { rgba: colorScene() })).status, STATUS.PASS)
  const wall = makeGray(W, H, () => 215)
  assert.equal(checkObstruction(frameOf(wall)).status, STATUS.PASS)
  const sky = colorScene()
  paintRect(sky, W, H, 0, 0, W, H * 0.4, [150, 190, 235])
  assert.equal(checkObstruction(frameOf(scene, { rgba: sky })).status, STATUS.PASS)
})

test('obstruction: a uniformly dim photo is an exposure problem, not a covered lens', () => {
  const dim = adjust(scene, 0.3, 0)
  assert.equal(checkObstruction(frameOf(dim)).status, STATUS.PASS)
})

test('obstruction: dark patch in a corner warns, big dark area fails, full cover fails', () => {
  const corner = colorScene()
  paintRect(corner, W, H, 0, 0, W * 0.45, H * 0.45, [8, 8, 8])
  assert.equal(checkObstruction(frameOf(scene, { rgba: corner })).status, STATUS.WARN)

  const half = colorScene()
  paintRect(half, W, H, 0, 0, W * 0.6, H, [10, 10, 12])
  assert.equal(checkObstruction(frameOf(scene, { rgba: half })).status, STATUS.FAIL)

  const black = toRgba(makeGray(W, H, () => 6))
  assert.equal(checkObstruction(frameOf(scene, { rgba: black })).status, STATUS.FAIL)
})

test('obstruction: a finger-coloured blob at the edge is detected', () => {
  const rgba = colorScene()
  paintDisc(rgba, W, H, W * 0.9, H, H * 0.75, [205, 140, 115], { soft: 0.1 })
  const r = checkObstruction(frameOf(scene, { rgba }))
  assert.notEqual(r.status, STATUS.PASS)
  assert.equal(r.details.finger, true)
})

// ---- glare --------------------------------------------------------------
test('glare: clean scene passes', () => {
  assert.equal(checkGlare(frameOf(scene, { rgba: colorScene() })).status, STATUS.PASS)
})

test('glare: a soft-edged blown-out spot is flagged and located', () => {
  const rgba = colorScene()
  paintDisc(rgba, W, H, W * 0.75, H * 0.25, H * 0.3, [255, 255, 255], { soft: 0.6 })
  const r = checkGlare(frameOf(scene, { rgba }))
  assert.notEqual(r.status, STATUS.PASS)
  assert.equal(r.details.soft, true)
  assert.equal(r.details.region, 'top-right')
  assert.match(r.hint, /top-right/)
})

test('glare: a hard-edged white poster is not glare (small passes, large only warns)', () => {
  const small = colorScene()
  paintRect(small, W, H, W * 0.55, H * 0.2, W * 0.65, H * 0.4, [255, 255, 255])
  assert.equal(checkGlare(frameOf(scene, { rgba: small })).status, STATUS.PASS)
  const big = colorScene()
  paintRect(big, W, H, W * 0.5, H * 0.1, W * 0.9, H * 0.6, [255, 255, 255])
  const r = checkGlare(frameOf(scene, { rgba: big }))
  assert.equal(r.status, STATUS.WARN) // large blown-out area, but never a fail
  assert.equal(r.details.soft, false)
})

// ---- shake --------------------------------------------------------------
test('shake: sharp passes; directional motion blur is flagged with its direction', () => {
  const sharp = checkShake(frameOf(scene))
  assert.equal(sharp.status, STATUS.PASS)
  for (const angle of [0, Math.PI / 2, Math.PI / 4]) {
    const r = checkShake(frameOf(motionBlur(scene, W, H, 12, angle)))
    assert.notEqual(r.status, STATUS.PASS, `angle ${angle}`)
  }
})

test('shake: names the direction on a real photo when it is unambiguous', async () => {
  const h = await realFrame('china.jpg', (px, w, h) => mapChannels(px, w, h, (g) => motionBlur(g, w, h, 12, 0)))
  const v = await realFrame('china.jpg', (px, w, h) => mapChannels(px, w, h, (g) => motionBlur(g, w, h, 12, Math.PI / 2)))
  assert.equal(checkShake(h).details.direction, 'horizontal')
  assert.equal(checkShake(v).details.direction, 'vertical')
})

test('shake: plain defocus blur is not reported as shake (that is the blur check)', () => {
  assert.equal(checkShake(frameOf(boxBlur(scene, W, H, 4))).status, STATUS.PASS)
})

test('shake: too few edges to judge is skip, not fail', () => {
  assert.equal(checkShake(frameOf(makeGray(W, H, () => 140))).status, STATUS.SKIP)
})

test('shake: real photos pass when sharp and flag directional blur', async () => {
  for (const name of ['china.jpg', 'flower.jpg']) {
    assert.equal(checkShake(await realFrame(name)).status, STATUS.PASS, name)
    const moved = await realFrame(name, (px, w, h) => mapChannels(px, w, h, (g) => motionBlur(g, w, h, 10, 0)))
    assert.notEqual(checkShake(moved).status, STATUS.PASS, `${name} moved`)
  }
})

// ---- whole pipeline -----------------------------------------------------
test('pipeline: a good photo passes with no issues; each defect is attributed correctly', async () => {
  const w = 1600
  const h = 1200
  const gray = sceneGray(w, h, 21)
  const run = async (px) => {
    const f = await decodeToFrame(asFile(encodeImage(px, w, h, { type: 'jpeg', quality: 92 }), 'image/jpeg'), { env: nodeEnv })
    return analyzeFrame(f)
  }
  const good = await run(toRgba(gray))
  assert.equal(good.verdict, VERDICT.PASS, JSON.stringify(good.issues))
  assert.equal(good.issues.length, 0)

  const blurry = await run(toRgba(boxBlur(gray, w, h, 14)))
  assert.equal(blurry.verdict, VERDICT.BLOCK)
  assert.equal(blurry.issues[0].id, 'blur')

  const dark = await run(toRgba(adjust(gray, 0.15, 0)))
  assert.equal(dark.verdict, VERDICT.BLOCK)
  assert.ok(dark.issues.some((i) => i.id === 'exposure' && i.blocking))
})
