// Offline experiments behind the focus-bug diagnosis (edge-validator/progress.md, Phase 8a). REAL photos from
// edge-validator/samples/good, SYNTHETIC degradations (labelled in the output; this is not camera data).
//   node tools/focus-experiments.mjs burst [n]   H5: does the burst's sharpness function (480 px) pick the frame the check likes (1280 px)?
//   node tools/focus-experiments.mjs scale [n]   how the blur score moves with the pixel size of the same photo (resample down / up)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { blurMetrics } from '../src/lib/photoQuality/checks/blur.js'
import { frameSharpness } from '../src/lib/photoQuality/burst.js'
import { THRESHOLDS } from '../src/lib/photoQuality/config.js'
import { rgbaToGray } from '../src/lib/photoQuality/frame.js'
import { addNoise, boxBlur, mulberry32, motionBlur } from '../src/lib/photoQuality/testing/synth.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(here, '../../edge-validator/samples/good')
const [mode = 'burst', nArg = '40'] = process.argv.slice(2)
const files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().slice(0, Number(nArg))
const { failBelow, warnBelow } = THRESHOLDS.blur
const statusOf = (s) => (s < failBelow ? 'fail' : s < warnBelow ? 'warn' : 'pass')

async function gray(file, maxSide = 1280) {
  const img = await loadImage(fs.readFileSync(path.join(dir, file)))
  const s = Math.min(1, maxSide / Math.max(img.width, img.height))
  const w = Math.round(img.width * s); const h = Math.round(img.height * s)
  const c = createCanvas(w, h); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h)
  return { g: rgbaToGray(x.getImageData(0, 0, w, h).data, w * h), w, h, img }
}
const checkScore = (g, w, h) => blurMetrics(g, w, h).score ?? 0.01

if (mode === 'burst') {
  // A handheld burst: 8 frames of the same scene whose softness differs a little (defocus 0-2 passes, motion 0-8 px, noise 0-3).
  const rnd = mulberry32(42)
  let top1 = 0, trials = 0, regret = []; let worseStatus = 0; let tie = 0; const rho = []
  for (const f of files) {
    const { g, w, h } = await gray(f)
    for (let t = 0; t < 4; t++) {
      const frames = []
      for (let i = 0; i < 8; i++) {
        let x = g
        const defocus = rnd() < 0.5 ? 0 : Math.floor(rnd() * 3)
        if (defocus) x = boxBlur(x, w, h, defocus, 1)
        const mot = rnd() < 0.5 ? 0 : 2 + rnd() * 6
        if (mot) x = motionBlur(x, w, h, mot, rnd() * Math.PI)
        const nz = rnd() * 3
        if (nz > 0.5) x = addNoise(x, nz, 1 + Math.floor(rnd() * 1e6))
        frames.push(x)
      }
      const burst = frames.map((x) => frameSharpness(x, w, h)) // what the camera uses (resized to scoreSize inside)
      const check = frames.map((x) => checkScore(x, w, h)) // what judges the captured photo
      const pb = burst.indexOf(Math.max(...burst)); const pc = check.indexOf(Math.max(...check))
      trials++; if (pb === pc) top1++
      regret.push(check[pc] - check[pb])
      if (statusOf(check[pb]) !== statusOf(check[pc]) && check[pb] < check[pc]) worseStatus++
      // Spearman rank correlation
      const rank = (a) => { const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = Array(a.length); o.forEach(([, i], k) => (r[i] = k)); return r }
      const ra = rank(burst); const rb = rank(check); const n = 8
      rho.push(1 - (6 * ra.reduce((s, v, i) => s + (v - rb[i]) ** 2, 0)) / (n * (n * n - 1)))
    }
  }
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
  const p = (a, q) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))]
  console.log(`H5 burst metric (480 px) vs check metric (1280 px): ${files.length} REAL photos x 4 synthetic 8-frame bursts = ${trials} bursts`)
  console.log(`  picks the same frame as the check would:        ${top1}/${trials} (${((100 * top1) / trials).toFixed(0)}%)`)
  console.log(`  rank correlation burst-vs-check (Spearman):     median ${med(rho).toFixed(2)}, p10 ${p(rho, 0.1).toFixed(2)}`)
  console.log(`  check-score regret of the pick (best - picked): median ${med(regret).toFixed(3)}, p90 ${p(regret, 0.9).toFixed(3)}, max ${Math.max(...regret).toFixed(3)}  (fail/warn lines are ${failBelow}/${warnBelow})`)
  console.log(`  bursts where the pick lands in a WORSE status than the best frame: ${worseStatus}/${trials} (${((100 * worseStatus) / trials).toFixed(1)}%)`)
}

if (mode === 'scale') {
  // The same photo at several pixel sizes: down-sampling (a smaller sensor frame of the same scene) and enlarging (what the fake face stream did).
  const sizes = [1920, 1280, 960, 640, 480]
  const ups = [2, 3, 4]
  console.log(`blur score of ${files.length} REAL good photos, source resampled (Chrome-style high-quality). Percentiles over photos:`)
  const rows = {}
  for (const f of files) {
    const { img } = await gray(f, 4096)
    const long = Math.max(img.width, img.height)
    const score = (w0) => { const s = w0 / long; const w = Math.round(img.width * s), h = Math.round(img.height * s); const c = createCanvas(w, h); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h); const g = rgbaToGray(x.getImageData(0, 0, w, h).data, w * h); const a = Math.min(1, 1280 / Math.max(w, h)); if (a < 1) { const c2 = createCanvas(Math.round(w * a), Math.round(h * a)); const x2 = c2.getContext('2d'); x2.imageSmoothingQuality = 'high'; x2.drawImage(c, 0, 0, c2.width, c2.height); return checkScore(rgbaToGray(x2.getImageData(0, 0, c2.width, c2.height).data, c2.width * c2.height), c2.width, c2.height) } return checkScore(g, w, h) }
    for (const sz of sizes) (rows[`${sz}px long side`] ??= []).push(score(Math.min(sz, long)))
    // enlarged: take the 1/k centre crop at native pixels... then stretch it back to the original crop's size = k-times enlargement
    for (const k of ups) { const cw = Math.round(1280 / k); const ch = Math.round(cw * img.height / img.width); const c = createCanvas(cw, ch); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, img.width, img.height, 0, 0, cw, ch); const up = createCanvas(1280, Math.round(1280 * img.height / img.width)); const ux = up.getContext('2d'); ux.imageSmoothingQuality = 'high'; ux.drawImage(c, 0, 0, up.width, up.height); (rows[`${k}x enlarged`] ??= []).push(checkScore(rgbaToGray(ux.getImageData(0, 0, up.width, up.height).data, up.width * up.height), up.width, up.height)) }
  }
  const q = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))]
  for (const [k, v] of Object.entries(rows)) console.log(`  ${k.padEnd(18)} p5 ${q(v, 0.05).toFixed(3)}  p50 ${q(v, 0.5).toFixed(3)}  p95 ${q(v, 0.95).toFixed(3)}   below warn(${warnBelow}): ${v.filter((s) => s < warnBelow).length}/${v.length}   below fail(${failBelow}): ${v.filter((s) => s < failBelow).length}/${v.length}`)
}
