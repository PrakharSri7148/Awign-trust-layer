// "Is a sharp photo refused by the in-app capture?" Feeds REAL photos (never upscaled) through Chrome's fake camera,
// presses the real shutter in the real Capture screen, and records what the app decided plus the captured JPEG, so the
// server engine can judge the exact same bytes (backend/tools/focus_diagnose.py).
//   node tools/e2e/focus-capture.mjs <outDir> <task: shelf|selfie> <photo> [photo ...]
// The camera is Chrome's fake device: it cannot reproduce autofocus, front-camera softness or a real blink. For the
// selfie task the live challenge is answered with the labelled MOCK (dev builds only); focus is unaffected by that.
// Writes <outDir>/<n>.jpg (the captured photo) and <outDir>/results.json.
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const [outDir, taskKey, ...photos] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:5173/'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TASK = { shelf: 'Shelf / site photo', selfie: 'Selfie check-in' }[taskKey]
const W = Number(process.env.STREAM_W ?? 1920)
const H = Number(process.env.STREAM_H ?? 1080)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (!BASE.includes('127.0.0.1')) throw new Error('refusing to run against ' + BASE)

// FACE_CROPS=<json {file: {cx, cy}}>: for the selfie task the stream is a WxH WINDOW of the photo around the face at native
// scale (no resampling at all), so the face is big enough for the live landmarker and nothing is enlarged.
const CROPS = process.env.FACE_CROPS ? JSON.parse(fs.readFileSync(process.env.FACE_CROPS, 'utf8')) : {}

// photo -> mjpeg frames at WxH: scaled DOWN to fit (never up), centred on grey. q97 like the other streams.
async function stream(photo, file) {
  const img = await loadImage(fs.readFileSync(photo))
  const crop = CROPS[path.basename(photo)]
  if (crop) {
    const c = createCanvas(W, H); const x = c.getContext('2d'); x.fillStyle = '#777'; x.fillRect(0, 0, W, H)
    const sx = Math.max(0, Math.min(img.width - W, Math.round(crop.cx * img.width - W / 2))); const sy = Math.max(0, Math.min(img.height - H, Math.round(crop.cy * img.height - H / 2)))
    const sw = Math.min(W, img.width); const sh = Math.min(H, img.height)
    x.drawImage(img, sx, sy, sw, sh, Math.round((W - sw) / 2), Math.round((H - sh) / 2), sw, sh)
    fs.writeFileSync(file, Buffer.concat(Array(30).fill(c.toBuffer('image/jpeg', 97))))
    return { scale: 1, window: [sx, sy, sw, sh] }
  }
  const s = Math.min(1, W / img.width, H / img.height)
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.fillStyle = '#777'; x.fillRect(0, 0, W, H); x.imageSmoothingQuality = 'high'
  const w = Math.round(img.width * s); const h = Math.round(img.height * s)
  x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
  fs.writeFileSync(file, Buffer.concat(Array(30).fill(c.toBuffer('image/jpeg', 97))))
  return { scale: s }
}

const MOCK = () => {
  window.__mockFace = { blink: 0.05, smile: 0.05, jaw: 0.02, yawDeg: 0, present: true }
  window.__landmarkerMock = () => { const m = window.__mockFace; return { blendshapes: { eyeBlinkLeft: m.blink, eyeBlinkRight: m.blink, mouthSmileLeft: m.smile, mouthSmileRight: m.smile, jawOpen: m.jaw }, yawDeg: m.yawDeg } }
}
const ACTION = { blink: { blink: 0.9 }, smile: { smile: 0.9 }, open_mouth: { jaw: 0.8 }, turn_left: { yawDeg: 30 }, turn_right: { yawDeg: -30 } }
const NEUTRAL = { blink: 0.05, smile: 0.05, jaw: 0.02, yawDeg: 0 }
const live = (page) => page.$eval('[data-liveness]', (e) => ({ tone: e.dataset.liveness, challenge: e.dataset.challenge ?? null })).catch(() => null)

const results = []
for (const [n, photo] of photos.entries()) {
  const mj = path.join(outDir, `stream-${n}.mjpeg`)
  const { scale, window: win } = await stream(photo, mj)
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${mj}`] })
  const rec = { n, source: path.basename(photo), scaleToStream: scale, window: win }
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 })
    if (taskKey === 'selfie') await page.evaluateOnNewDocument(MOCK)
    await page.goto(BASE + '?debug=checks', { waitUntil: 'networkidle0' })
    for (const h of await page.$$('.tasks .chip')) if ((await h.evaluate((e) => e.innerText)) === TASK) await h.click()
    await page.click('.live__start'); await page.waitForSelector('.hud', { timeout: 30000 })
    if (taskKey === 'selfie') {
      const t0 = Date.now()
      for (let i = 0; i < 40 && (await live(page))?.tone !== 'ok' && Date.now() - t0 < 60000; i++) {
        const st = await live(page)
        if (st?.challenge) { await sleep(450); await page.evaluate((p) => Object.assign(window.__mockFace, p), ACTION[st.challenge]); await sleep(st.challenge === 'blink' ? 260 : 800); await page.evaluate((p) => Object.assign(window.__mockFace, p), NEUTRAL) }
        await sleep(400)
      }
      rec.liveToneBeforeShutter = (await live(page))?.tone
    }
    await sleep(1500)
    const bursts = []; page.on('console', (m) => { if (m.text().startsWith('[burst]')) bursts.push(m.text().slice(8)) })
    const t = Date.now()
    await page.click('.live__shutter'); await page.waitForSelector('.qc', { timeout: 40000 })
    rec.captureMs = Date.now() - t
    await sleep(300)
    const ui = await page.evaluate(() => ({
      title: document.querySelector('.qc__title')?.innerText, why: document.querySelector('.qc__why')?.innerText ?? null,
      submit: [...document.querySelectorAll('.capture-grid__side .btn')].map((b) => b.innerText.trim()),
      debug: document.querySelector('[data-testid=checks-debug]')?.innerText.replace(/\s+/g, ' ') ?? null,
      rows: [...document.querySelectorAll('.qc__row')].map((r) => r.innerText.replace(/\s+/g, ' ')),
    }))
    Object.assign(rec, ui)
    rec.canSubmit = ui.submit.some((s) => /^Submit/.test(s))
    const b64 = await page.evaluate(async () => { const img = [...document.querySelectorAll('img')].find((i) => i.src.startsWith('blob:')); if (!img) return null; const b = await (await fetch(img.src)).blob(); const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s) })
    if (b64) { fs.writeFileSync(path.join(outDir, `${n}.jpg`), Buffer.from(b64, 'base64')); rec.captured = `${n}.jpg` }
    rec.burst = bursts[0] ? JSON.parse(bursts[0]) : null
  } catch (e) {
    rec.error = String(e.message).slice(0, 200)
    try { const pg = (await browser.pages()).at(-1); rec.stateAtFailure = await pg.evaluate(() => ({ live: document.querySelector('[data-liveness]')?.innerText ?? null, tone: document.querySelector('[data-liveness]')?.dataset.liveness ?? null, shutter: document.querySelector('.live__shutter')?.disabled ?? null, hint: document.querySelector('.live__hint')?.innerText ?? null })); await pg.screenshot({ path: path.join(outDir, `fail-${n}.png`) }) } catch {}
  } finally { await browser.close() }
  results.push(rec)
  console.log(`${rec.n} ${rec.source} ${rec.error ? 'ERROR ' + rec.error : `${rec.title} | submit:${rec.canSubmit}`}`)
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 1))
  fs.rmSync(mj, { force: true })
}
