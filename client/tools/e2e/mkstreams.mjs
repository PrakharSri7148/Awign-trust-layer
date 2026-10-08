// Builds fake-camera "videos" for Chrome (--use-file-for-fake-video-capture): an .mjpeg file is
// just JPEG frames concatenated. Also writes meta.json with each source's mean luma so the HUD
// can be checked against the truth.
//   node tools/e2e/mkstreams.mjs <outDir>
import fs from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { encodeImage } from '../../src/lib/photoQuality/testing/nodeEnv.js'
import { noiseSigma } from '../../src/lib/photoQuality/stats.js'
import { addNoise, adjust, boxBlur, mapChannels, paintRect, sceneGray, toRgba } from '../../src/lib/photoQuality/testing/synth.js'

const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const W = 1920
const H = 1080
const g = sceneGray(W, H, 17)
const tint = (gray) => mapChannels(toRgba(gray), W, H, (c, i) => c.map((v) => v * [1.05, 0.98, 0.9][i]))
const meanLuma = (rgba) => { let s = 0; for (let i = 0; i < rgba.length; i += 4) s += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]; return s / (rgba.length / 4) }
const meta = {}
const jpg = (rgba) => encodeImage(rgba, W, H, { type: 'jpeg', quality: 97 }) // >=97: lower adds blocking artefacts
const write = (name, rgba, frames = 30) => { meta[name] = { meanLuma: Math.round(meanLuma(rgba) * 10) / 10 }; const b = jpg(rgba); fs.writeFileSync(`${out}/${name}.mjpeg`, Buffer.concat(Array(frames).fill(b))); return b }

const good = write('good', tint(g))
write('dark', tint(adjust(g, 0.12, 0))) // mean luma < 40
// NB: Chrome's fake camera plays full-range JPEG as limited-range video, so the browser sees
// (Y-16)*255/219. The dim stream is chosen so the BROWSER-side luma lands in 40-65.
write('dim', tint(adjust(g, 0.47, 0)))
write('blurry', tint(boxBlur(g, W, H, 22)))
{
  const base = tint(g); const noisy = new Uint8ClampedArray(base)
  const n = addNoise(new Float32Array(W * H), 10, 3) // zero-mean noise field, sigma 10
  for (let p = 0; p < W * H; p++) { const d = n[p]; for (let c = 0; c < 3; c++) noisy[p * 4 + c] = base[p * 4 + c] + d }
  const bytes = write('noisy', noisy)
  // The truth for the noise check is what survives JPEG, not what was added: measure the frame itself.
  const img = await loadImage(bytes); const cv = createCanvas(img.width, img.height); const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0)
  const sz = 256; const d = cx.getImageData((img.width - sz) >> 1, (img.height - sz) >> 1, sz, sz).data; const gy = new Float32Array(sz * sz)
  for (let i = 0, p = 0; p < gy.length; i += 4, p++) gy[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  meta.noisy.sigma = Math.round(noiseSigma(gy, sz, sz) * 100) / 100
}
{ const c = tint(g); paintRect(c, W, H, 0, 0, W * 0.55, H, [8, 8, 8]); write('covered', c) }
// Mostly blurry with one sharp frame in five: the burst must find the sharp one.
{
  const blurry = jpg(tint(boxBlur(g, W, H, 14)))
  fs.writeFileSync(`${out}/alternating.mjpeg`, Buffer.concat(Array.from({ length: 50 }, (_, i) => (i % 5 === 4 ? good : blurry))))
}
// REAL sharp photos (samples/good, when present) as camera frames, never enlarged: a "sharp capture is not refused" check.
{
  const dirGood = new URL('../../../edge-validator/samples/good/', import.meta.url).pathname
  const picks = fs.existsSync(dirGood) ? fs.readdirSync(dirGood).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().slice(0, 3) : []
  for (const [i, f] of picks.entries()) {
    const img = await loadImage(fs.readFileSync(dirGood + f))
    const sc = Math.min(1, W / img.width, H / img.height)
    const c = createCanvas(W, H); const x = c.getContext('2d'); x.fillStyle = '#777'; x.fillRect(0, 0, W, H); x.imageSmoothingQuality = 'high'
    const w = Math.round(img.width * sc); const h = Math.round(img.height * sc)
    x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
    fs.writeFileSync(`${out}/sharp${i}.mjpeg`, Buffer.concat(Array(30).fill(c.toBuffer('image/jpeg', 97))))
    meta[`sharp${i}`] = { note: 'REAL photo from samples/good, not enlarged' }
  }
}
// Face: the astronaut portrait cropped to the head and centred in a 16:9 frame, plain surround.
{
  const face = await loadImage(fs.readFileSync(new URL('../../src/lib/photoQuality/testing/fixtures/astronaut.png', import.meta.url).pathname))
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.fillStyle = '#777'; x.fillRect(0, 0, W, H); x.imageSmoothingQuality = 'high'; // head and shoulders cropped so the face is ~44% of the frame height (landmark models need a big face; in a 16:9 frame the full portrait is too small)
  x.drawImage(face, 110, 20, 250, 250, (W - H) / 2, 0, H, H)
  fs.writeFileSync(`${out}/face.mjpeg`, Buffer.concat(Array(30).fill(c.toBuffer('image/jpeg', 97))))
  meta.face = { note: 'astronaut head, face ~44% of frame height' }
}
// SYNTHETIC spoofs of the astronaut face (heuristics can fire on these; they say nothing about real-world accuracy).
//   spoofscreen: the portrait on a "phone": dark bezel around a bright screen on a lighter table, a rotated pixel-grid
//                (moire) over everything and horizontal bands that drift from frame to frame (30 different frames).
//   spoofprint:  the portrait on white paper with a margin (frame only: no grid, no bands).
{
  const face = await loadImage(fs.readFileSync(new URL('../../src/lib/photoQuality/testing/fixtures/astronaut.png', import.meta.url).pathname))
  const scene = (paper) => {
    const c = createCanvas(W, H); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'
    x.fillStyle = paper ? '#9a9a9a' : '#777'; x.fillRect(0, 0, W, H)
    const bx = paper ? W * 0.27 : W * 0.2, by = paper ? H * 0.04 : H * 0.05, bw = paper ? W * 0.46 : W * 0.6, bh = paper ? H * 0.92 : H * 0.9
    x.fillStyle = paper ? '#f4f4f0' : '#0b0b0b'; x.fillRect(bx, by, bw, bh) // paper sheet, or the phone body (bezel)
    const m = paper ? bw * 0.1 : 36
    x.drawImage(face, 110, 20, 250, 250, bx + m + (bw - 2 * m - (bh - 2 * m)) / 2, by + m, bh - 2 * m, bh - 2 * m)
    return x.getImageData(0, 0, W, H).data
  }
  const grid = (data, frame) => {
    const out = new Uint8ClampedArray(data); const t = (11 * Math.PI) / 180; const phase = frame * 7 // NOT a multiple that lines up with the 60 px band period per tick (6 frames x 10 px = 60 px aliased to zero drift)
    for (let y = 0; y < H; y++) {
      const band = 5 * Math.sin((2 * Math.PI * (y + phase)) / 60)
      for (let x = 0; x < W; x++) {
        const u = x * Math.cos(t) + y * Math.sin(t), v = -x * Math.sin(t) + y * Math.cos(t)
        const d = (12 * (Math.cos((2 * Math.PI * u) / 3.3) + Math.cos((2 * Math.PI * v) / 3.3))) / 2 + band
        const i = (y * W + x) * 4
        out[i] += d; out[i + 1] += d; out[i + 2] += d
      }
    }
    return out
  }
  const screen = scene(false)
  fs.writeFileSync(`${out}/spoofscreen.mjpeg`, Buffer.concat(Array.from({ length: 30 }, (_, f) => encodeImage(grid(screen, f), W, H, { type: 'jpeg', quality: 97 }))))
  fs.writeFileSync(`${out}/spoofprint.mjpeg`, Buffer.concat(Array(30).fill(encodeImage(scene(true), W, H, { type: 'jpeg', quality: 97 }))))
  meta.spoofscreen = { note: 'SYNTHETIC: astronaut on a phone-like screen with a moire grid and drifting bands' }
  meta.spoofprint = { note: 'SYNTHETIC: astronaut on white paper' }
}
// Panning: every frame is the same wide scene seen 12 px further along, so the picture itself moves
// (about 3.7% of the frame width per 200 ms tick) while no motion sensor reports anything.
{
  const WW = W + 360
  const wide = sceneGray(WW, H, 17)
  const frames = []
  for (let i = 0; i < 30; i++) {
    const crop = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) crop[y * W + x] = wide[y * WW + x + i * 12]
    frames.push(jpg(tint(crop)))
  }
  fs.writeFileSync(`${out}/moving.mjpeg`, Buffer.concat(frames))
}
// Optional: a stream from a reference face photo (E2E_REF_FACE=/path/to/image.png)
if (process.env.E2E_REF_FACE && fs.existsSync(process.env.E2E_REF_FACE)) {
  const ref = await loadImage(fs.readFileSync(process.env.E2E_REF_FACE))
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.fillStyle = '#777'; x.fillRect(0, 0, W, H); x.imageSmoothingQuality = 'high'
  const s = Math.min(H / ref.height, (W * 0.8) / ref.width); x.drawImage(ref, (W - ref.width * s) / 2, (H - ref.height * s) / 2, ref.width * s, ref.height * s)
  fs.writeFileSync(`${out}/reface.mjpeg`, Buffer.concat(Array(30).fill(c.toBuffer('image/jpeg', 97))))
}
fs.writeFileSync(`${out}/meta.json`, JSON.stringify(meta, null, 2))
console.log(meta)
