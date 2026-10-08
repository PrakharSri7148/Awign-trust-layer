// Prints, for every .jpg in a folder, the browser FaceLandmarker's head yaw (degrees; positive = the user turned to
// THEIR left) read both ways from the transformation matrix, the nose ratio and a few blendshapes. This is how the
// matrix layout (column-major) and the yaw sign were verified against real photos (progress.md Phase 7c); compare
// with the Python landmarker (backend/.venv/bin/python, mediapipe FaceLandmarker) on the same photos.
//   node tools/e2e/landmarker-pose.mjs <folder>      (needs a dev server on 127.0.0.1:5173, see iteration-2.md section 4)
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const dir = process.argv[2]
const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:5173/'
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] })
const p = await b.newPage()
await p.goto(BASE, { waitUntil: 'networkidle0' })
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jpg')).sort()) {
  const b64 = fs.readFileSync(`${dir}/${f}`).toString('base64')
  const r = await p.evaluate(async (b64) => {
    const { mediapipeLandmarker } = await import('/src/lib/photoQuality/face/mediapipeLandmarker.js')
    const { yawFromMatrix, noseRatio } = await import('/src/lib/photoQuality/face/livenessSignals.js')
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }))
    const s = Math.min(1, 480 / Math.max(bmp.width, bmp.height)); const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s)
    const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.drawImage(bmp, 0, 0, w, h)
    const out = await mediapipeLandmarker({ base: '/mediapipe' }).detectFull({ width: w, height: h, rgba: x.getImageData(0, 0, w, h).data })
    if (!out.points) return null
    return { columnMajorYaw: yawFromMatrix(out.matrix, false), rowMajorYaw: yawFromMatrix(out.matrix, true), noseRatio: noseRatio(out.points), blinkL: out.blendshapes.eyeBlinkLeft, smile: out.blendshapes.mouthSmileLeft, jawOpen: out.blendshapes.jawOpen }
  }, b64)
  console.log(f.slice(0, 8), r ? JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v.toFixed(2))]))) : 'no face')
}
await b.close()
