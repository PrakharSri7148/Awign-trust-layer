// End-to-end check of the live metrics HUD in headless Chrome with a fake camera.
//   1. node tools/e2e/mkstreams.mjs <streamsDir>
//   2. start a dev server on 127.0.0.1:5173 (NOT the one you work on; see edge-validator/iteration-2.md §4)
//   3. node tools/e2e/hud-e2e.mjs <streamsDir> [scenario]
// Needs puppeteer-core (not a dependency of the app). Exits non-zero if any check fails.
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const dir = process.argv[2]
const only = process.argv[3]
const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:5173/'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const meta = JSON.parse(fs.readFileSync(`${dir}/meta.json`, 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (name, ok, detail = '') => { console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) failed++ }
const pctile = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

// E2E_HEADFUL=1 shows the browser (npm run demo:laptop); a session started with keepOpen then waits for you to close the window.
const HEADFUL = process.env.E2E_HEADFUL === '1'
async function session(stream, { width = 1440, height = 900, query = '', fn, keepOpen = false }) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: HEADFUL ? false : 'new', defaultViewport: HEADFUL ? null : undefined,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${dir}/${stream}.mjpeg`, ...(HEADFUL ? [`--window-size=${width},${height + 90}`] : [])] })
  const page = (await browser.pages())[0] ?? await browser.newPage()
  if (!HEADFUL) await page.setViewport({ width, height })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message + ' @ ' + String(e.stack ?? '').split('\n').slice(1, 3).join(' | ').slice(0, 220)))
  page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK|favicon|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)) })
  try { await fn(page) } finally {
    check('no browser console errors', errors.length === 0, errors.join(' | '))
    if (HEADFUL && keepOpen) {
      console.log('\n   The browser stays open on the case file. Close the window (or press Ctrl+C) to stop the demo servers.')
      await new Promise((r) => browser.on('disconnected', r))
    } else await browser.close()
  }
}
const shake = (page, rot, acc) => page.evaluate((rot, acc) => { clearInterval(window.__shake); window.__shake = setInterval(() => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: rot, beta: rot, gamma: rot }, acceleration: { x: acc, y: acc, z: acc }, interval: 16 })), 16) }, rot, acc)
const open = async (page, { task, query = '', clear = true, motion = null } = {}) => {
  await page.goto(BASE + query, { waitUntil: 'networkidle0' })
  if (clear) { await page.evaluate(() => { try { localStorage.clear() } catch {} }); await page.goto(BASE + query, { waitUntil: 'networkidle0' }) }
  if (task) for (const h of await page.$$('.cap-brief__tasks .cap-chip')) if ((await h.evaluate((e) => e.innerText)) === task) await h.click()
  if (motion) await shake(page, ...motion) // after navigation, before the camera starts
  await page.click('.cap-start'); await page.waitForSelector('.cap-shutter', { timeout: 30000 })
}
// All rows as { id: { status, text } }
const rows = (page) => page.$$eval('.cap-hud__row', (r) => Object.fromEntries(r.map((x) => [x.dataset.metric, { status: x.dataset.status, text: x.querySelector('.cap-hud__value').innerText, muted: x.classList.contains('cap-hud__row--muted') }])))
const overall = (page) => page.$eval('[data-testid=hud-overall]', (e) => e.innerText)
const num = (t) => parseFloat(String(t).replace(/[^\d.\-]/g, ''))
// Samples a numeric row over `ms` to measure stability.
async function sample(page, id, ms = 3000, every = 250) { const v = []; const t0 = Date.now(); while (Date.now() - t0 < ms) { v.push(num((await rows(page))[id].text)); await sleep(every) } return v }


// ---- liveness helpers -------------------------------------------------------------------------
// MOCK (dev build only): the fake camera cannot blink or turn, so the test replaces the landmarker's BLENDSHAPES and
// head yaw with a scripted signal (window.__mockFace). The landmarks, the face detection, the state machine, the UI and
// the shutter gating are all real. Scenarios that must prove "a photo cannot pass" run WITHOUT the mock.
const withMock = (page) => page.evaluateOnNewDocument(() => {
  window.__mockFace = { blink: 0.05, smile: 0.05, jaw: 0.02, yawDeg: 0, present: true }
  window.__landmarkerMock = () => { const m = window.__mockFace; const o = { blendshapes: { eyeBlinkLeft: m.blink, eyeBlinkRight: m.blink, mouthSmileLeft: m.smile, mouthSmileRight: m.smile, jawOpen: m.jaw }, yawDeg: m.yawDeg }; if (!m.present) o.points = null; return o }
})
const mock = (page, patch) => page.evaluate((p) => Object.assign(window.__mockFace, p), patch)
const NEUTRAL = { blink: 0.05, smile: 0.05, jaw: 0.02, yawDeg: 0 }
const ACTION = { blink: { blink: 0.9 }, smile: { smile: 0.9 }, open_mouth: { jaw: 0.8 }, turn_left: { yawDeg: 30 }, turn_right: { yawDeg: -30 } }
const livenessState = (page) => page.$eval('[data-liveness]', (e) => ({ tone: e.dataset.liveness, challenge: e.dataset.challenge ?? null, text: e.innerText })).catch(() => null)
const waitLive = (page, tone, timeout = 20000) => page.waitForFunction((t) => document.querySelector('[data-liveness]')?.dataset.liveness === t, { timeout }, tone).then(() => true, () => false)
const shutterOk = (page) => page.$eval('.cap-shutter', (e) => ({ disabled: e.disabled, ok: e.dataset.liveOk }))
// Perform the CURRENT challenge like a person would: stay neutral for a moment, do the action, go back.
async function perform(page) {
  const st = await livenessState(page); if (!st?.challenge) return null
  await sleep(450) // neutral first
  await mock(page, ACTION[st.challenge]); await sleep(st.challenge === 'blink' ? 260 : 800); await mock(page, NEUTRAL)
  return st.challenge
}

// ---- sensor-fusion helpers ---------------------------------------------------------------------
// Real page, real recorder, real server. Only the SENSORS are scripted: Puppeteer sets the geolocation and the page gets
// synthetic devicemotion events (a 1.9 Hz walking signal or hand tremor). Times are real (no clock tricks: the server checks them).
const SITE = { lat: 12.9716, lng: 77.5946 }
const DEG_M = 111320
const at = (eastM, northM) => ({ latitude: SITE.lat + northM / DEG_M, longitude: SITE.lng + eastM / (DEG_M * Math.cos(SITE.lat * Math.PI / 180)), accuracy: 8 })
const putSite = async (API, id = 'site_demo_1') => (await fetch(`${API}/sites/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...SITE, radius_m: 60, country: 'IN', label: 'e2e' }) })).ok
const motionKind = (page, kind) => page.evaluate((kind) => {
  window.__mk = kind
  if (window.__mi) return
  const t0 = performance.now()
  window.__mi = setInterval(() => {
    const t = (performance.now() - t0) / 1000, w = 2 * Math.PI * 1.9 * t, n = (s) => (Math.random() - 0.5) * s
    const walk = window.__mk === 'walk'
    const acceleration = walk ? { x: 1.0 * Math.sin(w / 2) + n(0.3), y: 0.8 * Math.sin(w + 1) + n(0.3), z: 2 * Math.sin(w + 2) + 0.6 * Math.sin(2 * w) + n(0.3) } : { x: n(0.06), y: n(0.06), z: n(0.06) }
    const rotationRate = walk ? { alpha: 30 * Math.sin(w) + n(6), beta: 15 * Math.sin(w / 2) + n(6), gamma: n(6) } : { alpha: n(3), beta: n(3), gamma: n(3) }
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration, rotationRate, interval: 20 }))
  }, 20)
}, kind)
// Walk from a to b over `secs`, a position every 2.5 s with a little jitter.
async function walkTo(page, a, b, secs, jitter = 1.5) {
  const steps = Math.max(1, Math.round(secs / 2.5))
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    await page.setGeolocation(at(a[0] + f * (b[0] - a[0]) + (Math.random() - 0.5) * jitter, a[1] + f * (b[1] - a[1]) + (Math.random() - 0.5) * jitter))
    if (i < steps) await sleep((secs / steps) * 1000)
  }
}
const stay = (page, p, secs) => walkTo(page, p, p, secs, 2)
const fusionPage = async (page, { consent = true, geo = true, start = at(0, 0) } = {}) => {
  await page.browserContext().overridePermissions(new URL(BASE).origin, geo ? ['geolocation'] : [])
  await page.evaluateOnNewDocument((consent) => {
    try { localStorage.clear(); if (consent) localStorage.setItem('fusion.consent.v1', '1') } catch {}
    // A phone grants motion access; headless desktop Chrome answers 'denied' (there is no sensor), so the test plays the phone.
    if (typeof DeviceMotionEvent !== 'undefined') DeviceMotionEvent.requestPermission = async () => 'granted'
    const f = window.fetch
    window.fetch = (u, o) => { if (o?.body instanceof FormData && String(u).endsWith('/submissions')) window.__payload = o.body.get('payload'); return f(u, o) }
  }, consent)
  await page.setGeolocation(start)
  await page.goto(BASE, { waitUntil: 'networkidle0' })
}
async function submitThroughTheUi(page) {
  // After "New submission" the camera reopens by itself; on a fresh page it needs the start tap.
  await page.waitForSelector('.cap-start, .cap-shutter', { timeout: 30000 })
  if (!(await page.$('.cap-shutter'))) { await page.evaluate(() => scrollTo(0, 0)); await sleep(300); await page.click('.cap-start') }
  try { await page.waitForSelector('.cap-shutter', { timeout: 30000 }) } catch (e) { await shot(page, 'hud-timeout'); console.log('   page text:', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300)); throw e }
  await sleep(2500)
  await page.evaluate(() => scrollTo(0, 0)); await sleep(300)
  try { await page.waitForSelector('.cap-shutter', { timeout: 20000 }) } catch (e) { await shot(page, 'no-shutter'); console.log('   page text:', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 500)); throw e }
  await page.click('.cap-shutter')
  try { await page.waitForSelector('.cap-result', { timeout: 30000 }) } catch (e) { await shot(page, 'submit-timeout'); console.log('   shutter state:', JSON.stringify(await page.$eval('.cap-shutter', (b) => ({ disabled: b.disabled, ok: b.dataset.liveOk })).catch(() => null)), (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 400)); throw e }
  await (await page.$('[data-testid=arrived-btn]')).click()
  await page.waitForSelector('.verdict', { timeout: 60000 })
}
// The live Sensor feed as { id: text } (data-testid="feed-<id>").
const feed = (page) => page.$$eval('[data-testid^=feed-]', (els) => Object.fromEntries(els.map((e) => [e.dataset.testid.slice(5), (e.innerText ?? e.textContent ?? '').trim()])))
const fetched = (page) => page.$$eval('[data-testid^=fetched-]', (els) => Object.fromEntries(els.filter((e) => e.dataset.testid !== 'fetched-panel').map((e) => [e.dataset.testid.slice(8), { text: e.innerText.replace(/\s+/g, ' '), cls: e.className }])))
const openSensors = async (page) => { await page.waitForSelector('#case-tab-sensors', { timeout: 15000 }); await page.click('#case-tab-sensors') }
const openPhoto = async (page) => { await page.waitForSelector('#case-tab-photo', { timeout: 15000 }); await page.click('#case-tab-photo') }
const vsum = (page) => page.$$eval('[data-testid=fusion-verdict] li', (els) => els.map((e) => ({ text: e.innerText.replace(/\s+/g, ' '), cls: e.className })))
const shot = (page, name, opts = {}) => page.screenshot({ path: `${process.env.E2E_SHOTS ?? '/tmp'}/${name}.png`, ...opts })
const latest = async (API) => { const l = await (await fetch(`${API}/submissions`)).json(); return (await fetch(`${API}/submissions/${l[0].id}`)).json() }


const scenarios = {
  async good() {
    await session('good', { fn: async (page) => {
      await open(page, { motion: [3, 0.1] }); await sleep(2500)
      const r = await rows(page)
      // Chrome's fake camera expands full-range JPEG as if it were limited range: the browser sees (Y-16)*255/219.
      const truth = Math.max(0, (meta.good.meanLuma - 16) * 255 / 219) / 255 * 100
      check('shows all 8 parameters (+ overall)', Object.keys(r).length === 8 && (await overall(page)) !== '—', Object.keys(r).join(','))
      check('brightness within +-5 points of what the browser receives', Math.abs(num(r.brightness.text) - truth) <= 5, `${r.brightness.text} vs ${truth.toFixed(1)}%`)
      check('focus >= 70%', num(r.focus.text) >= 70, r.focus.text)
      check('noise sigma < 1.5', num(r.noise.text) < 1.5, r.noise.text)
      check('resolution shows 1920×1080', r.resolution.text === '1920×1080', r.resolution.text)
      check('lens reads clear', r.lens.text === 'clear', r.lens.text)
      check('steadiness shows the injected rotation (3 deg/s per axis = 5)', r.steady.text === '5°/s', r.steady.text)
      check('face reads "off" on a task without a face', r.face.text === 'off', r.face.text)
      check('every scored row passes', ['brightness', 'focus', 'lens', 'glare', 'steady', 'noise', 'resolution'].every((k) => r[k].status === 'pass'), JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.status]))))
      check('compression is accounted for', (await page.$eval('.cap-hud__note', (e) => e.innerText)).includes('Compression: checked when you capture'))
      const jb = await sample(page, 'brightness'); const jf = await sample(page, 'focus')
      check('brightness stable within +-3 points over 3 s', Math.max(...jb) - Math.min(...jb) <= 6, `swing ${(Math.max(...jb) - Math.min(...jb)).toFixed(1)}`)
      check('focus stable within +-3 points over 3 s', Math.max(...jf) - Math.min(...jf) <= 6, `swing ${(Math.max(...jf) - Math.min(...jf)).toFixed(1)}`)
    } })
  },
  async dark() {
    await session('dark', { fn: async (page) => {
      await open(page); await sleep(2500); const r = await rows(page)
      check(`dark (source luma ${meta.dark.meanLuma}): brightness < 16% and red`, num(r.brightness.text) < 16 && r.brightness.status === 'fail', `${r.brightness.text} ${r.brightness.status}`)
      check('hint says too dark', /too dark/i.test(await page.$eval('.cap-hint', (e) => e.innerText)))
    } })
    await session('dim', { fn: async (page) => {
      await open(page); await sleep(2500); const r = await rows(page)
      check(`dim (browser-side luma ~${((meta.dim.meanLuma - 16) * 255 / 219).toFixed(0)}): amber, not red`, r.brightness.status === 'warn', `${r.brightness.text} ${r.brightness.status}`)
    } })
  },
  async blurry() {
    await session('blurry', { fn: async (page) => {
      await open(page); await sleep(2500); const r = await rows(page)
      check('blurred: focus < 50% and not green', num(r.focus.text) < 50 && r.focus.status !== 'pass', `${r.focus.text} ${r.focus.status}`)
    } })
  },
  async noisy() {
    await session('noisy', { query: '?hud=raw', fn: async (page) => {
      await open(page, { query: '?hud=raw' }); await sleep(2500); const r = await rows(page)
      const sigma = num(r.noise.text)
      check(`noisy (the JPEG frames contain sigma ${meta.noisy.sigma}): noise reads that +- 2 and is amber/red`, Math.abs(sigma - meta.noisy.sigma) <= 2 && r.noise.status !== 'pass', `${r.noise.text} ${r.noise.status}`)
    } })
  },
  async covered() {
    await session('covered', { fn: async (page) => {
      await open(page); await sleep(2500); const r = await rows(page)
      check('covered lens: lens row is not "clear"', r.lens.text !== 'clear' && r.lens.status !== 'pass', `${r.lens.text} ${r.lens.status}`)
    } })
  },
  async shaky() {
    await session('good', { fn: async (page) => {
      await open(page, { motion: [90, 5] }); await sleep(2500); const r = await rows(page)
      check('shaky: steadiness fails and shows ~156 deg/s', r.steady.status === 'fail' && Math.abs(num(r.steady.text) - 156) <= 3, `${r.steady.text} ${r.steady.status}`)
      const acc = await (async () => { await shake(page, 5, 2.2); await sleep(3000); return rows(page) })()
      check('acceleration-driven warning explains itself', acc.steady.status !== 'pass' && /acceleration/.test(await page.$eval('[data-metric=steady] .cap-hud__reason', (e) => e.innerText)), `${acc.steady.text} ${acc.steady.status}`)
    } })
  },
  async face() {
    await session('face', { fn: async (page) => {
      await open(page, { task: 'Selfie check-in', motion: [3, 0.1] }); await sleep(1500)
      const early = (await rows(page)).face.text
      await sleep(3500); const r = await rows(page)
      check('face row searches first, then shows confidence and size', early.includes('searching') || /\d+% · \d+%/.test(early), `early "${early}"`)
      check('face found: "NN% · NN%" with a plausible size (30-60% of frame height)', /^\d+% · \d+%$/.test(r.face.text) && num(r.face.text.split('·')[1]) >= 30 && num(r.face.text.split('·')[1]) <= 60, r.face.text)
      check('face counts towards the overall', (await overall(page)) !== '—')
    } })
    await session('face', { fn: async (page) => {
      await open(page, { task: 'Shelf / site photo' }); await sleep(2000)
      check('shelf task: face reads "off"', (await rows(page)).face.text === 'off')
    } })
  },
  async laptop() {
    // No motion sensor at all (a laptop, or a phone over plain HTTP): steadiness must still work from the picture.
    await session('good', { fn: async (page) => {
      await open(page); await sleep(2500); const r = await rows(page)
      check('no sensor, still scene: steadiness shows image motion near 0 and passes', /^motion 0\.\d%$/.test(r.steady.text) && r.steady.status === 'pass', `${r.steady.text} ${r.steady.status}`)
      check('steadiness counts towards the overall (not "no sensor")', !r.steady.muted, r.steady.text)
    } })
    await session('moving', { fn: async (page) => {
      await open(page); await sleep(3500); const r = await rows(page)
      check('no sensor, panning picture: steadiness fails and says so', r.steady.status === 'fail' && /^motion [2-9]\./.test(r.steady.text), `${r.steady.text} ${r.steady.status}`)
      check('the reason names the image', /image moving/.test(await page.$eval('[data-metric=steady] .cap-hud__reason', (e) => e.innerText)))
      check('the hint tells the worker to hold still', /hold still/i.test(await page.$eval('.cap-hint', (e) => e.innerText)))
    } })
  },
  async mesh() {
    const streams = fs.existsSync(`${dir}/reface.mjpeg`) ? ['face', 'reface'] : ['face']
    for (const st of streams) await session(st, { fn: async (page) => {
      await open(page, { task: 'Selfie check-in', motion: [3, 0.1] })
      await page.waitForFunction(() => document.querySelector('.facemesh')?.dataset.mesh === 'on', { timeout: 25000 }).catch(() => {})
      await sleep(800)
      // 7b: on a wide screen the panel sits BESIDE the preview, so it cannot cover the face and may start expanded
      const sep = await page.evaluate(() => { const h = document.querySelector('.cap-hud').getBoundingClientRect(); const v = document.querySelector('.cap-stage').getBoundingClientRect(); return { apart: h.left >= v.right - 1 || h.top >= v.bottom - 1 || h.right <= v.left + 1, mode: document.querySelector('.cap-hud').dataset.mode } })
      check(`${st}: on a wide screen the HUD sits beside the preview and cannot cover the face (and starts expanded)`, sep.apart && sep.mode === 'expanded', JSON.stringify(sep))
      check(`${st}: the mesh appears over the face`, (await page.$eval('.facemesh', (c) => c.dataset.mesh)) === 'on')
      const px = await page.$eval('.facemesh', (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let blue = 0, white = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 2] > 200 && d[i] < 90 && d[i + 1] < 140 && d[i + 3] > 200) blue++; if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235 && d[i + 3] > 200) white++ } return { blue, white, w: c.width, h: c.height } })
      check(`${st}: blue dots and white lines are drawn`, px.blue > 400 && px.white > 300, JSON.stringify(px))
      await (await page.$('.cap-stage')).screenshot({ path: `${process.env.E2E_SHOTS ?? '/tmp'}/mesh-${st}.png` })
      // the mesh follows the face: its bounding box is around the face box, not the whole frame
      const box = await page.$eval('.facemesh', (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let x0 = c.width, x1 = 0, y0 = c.height, y1 = 0; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 60) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) } return { w: (x1 - x0) / c.width, h: (y1 - y0) / c.height } })
      check(`${st}: the mesh covers the face, not the whole frame`, box.w > 0.08 && box.w < 0.7 && box.h > 0.15, JSON.stringify(box))
    } })
    await session('face', { fn: async (page) => {
      await open(page, { task: 'Shelf / site photo' }); await sleep(3000)
      check('a task without a face draws no mesh (and loads no landmark model)', (await page.$('.facemesh')) === null)
    } })
    await session('good', { fn: async (page) => {
      await open(page, { task: 'Selfie check-in' }); await sleep(4000)
      check('no face in view: no mesh', (await page.$eval('.facemesh', (c) => c.dataset.mesh)) === 'off')
    } })
  },
  async facetiming() {
    // The landmark loop (face tasks) must not starve the HUD: same budget and rate as without it.
    await session('face', { fn: async (page) => {
      await open(page, { task: 'Selfie check-in', query: '?hud=raw', motion: [3, 0.1] }); await sleep(9000)
      const t = await page.evaluate(() => window.__liveTickMs ?? []); const at = await page.evaluate(() => window.__liveTickAt ?? [])
      const warm = t.slice(5); const late = at.slice(Math.floor(at.length / 2)); const gaps = late.slice(1).map((v, i) => v - late[i])
      console.log(`   with the face mesh running: UI-thread cost per tick p50 ${pctile(warm, 0.5).toFixed(1)} ms, p95 ${pctile(warm, 0.95).toFixed(1)} ms; tick gap p50 ${pctile(gaps, 0.5).toFixed(0)} ms, p95 ${pctile(gaps, 0.95).toFixed(0)} ms`)
      check('UI-thread p95 per tick <= 50 ms with the mesh running', pctile(warm, 0.95) <= 50, `${pctile(warm, 0.95).toFixed(1)} ms`)
      check('HUD still updates at about 5 Hz with the mesh running (median gap <= 300 ms)', pctile(gaps, 0.5) <= 300, `${pctile(gaps, 0.5).toFixed(0)} ms`)
      check('the mesh is on while measuring', (await page.$eval('.facemesh', (c) => c.dataset.mesh)) === 'on')
    } })
  },
  async liveness() {
    // 1. a live person (scripted signals) completes two random challenges: the shutter unlocks, the photo carries a passing Liveness check
    await session('face', { fn: async (page) => {
      await withMock(page)
      await open(page, { task: 'Selfie check-in', motion: [3, 0.1] })
      check('selfie task: the live-check prompt is shown and the shutter is LOCKED before any challenge', (await shutterOk(page)).disabled && (await shutterOk(page)).ok === '0')
      check('the HUD has a Liveness row on a face task', (await page.$('[data-metric=liveness]')) !== null)
      check('a challenge starts once the face is steady', await waitLive(page, 'run', 25000), JSON.stringify(await livenessState(page)))
      await sleep(300); await page.screenshot({ path: `${process.env.E2E_SHOTS ?? '/tmp'}/liveness-prompt-${page.viewport().width}.png` })
      const done = []
      let sawAccent = false
      for (let i = 0; i < 2; i++) {
        const before = (await livenessState(page))?.challenge
        const acting = (async () => { const c = await perform(page); if (c) done.push(c) })()
        const t0 = Date.now(); while (Date.now() - t0 < 1500) { if ((await page.$eval('.facemesh', (c) => c.dataset.accent).catch(() => 'off')) === 'on') sawAccent = true; await sleep(80) }
        await acting
        if (i === 0) await page.waitForFunction((b) => { const e = document.querySelector('[data-liveness]'); return e?.dataset.challenge && e.dataset.challenge !== b }, { timeout: 6000 }, before).catch(() => {})
      }
      check('two different kinds of challenge were asked', done.length === 2 && new Set(done.map((c) => c.split('_')[0])).size === 2, done.join(' + '))
      check('the mesh dots turn green while the action is detected', sawAccent)
      check('liveness passes after both challenges', await waitLive(page, 'ok', 8000), JSON.stringify(await livenessState(page)))
      check('the shutter unlocks', !(await shutterOk(page)).disabled)
      check('the HUD Liveness row reads "passed"', (await rows(page)).liveness?.text === 'passed', JSON.stringify((await rows(page)).liveness))
      await page.click('.cap-shutter'); await page.waitForSelector('.cap-result', { timeout: 30000 })
      const qc = await page.$$eval('.cap-check', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')))
      check('the captured photo\'s checklist has a passing Liveness row', qc.some((t) => /Liveness.*live check passed/.test(t)), qc.join(' | '))
    } })
    // 2. no motion (a photo): the challenge times out, the shutter stays locked, three misses offer "send for review" which unlocks it, flagged
    await session('face', { fn: async (page) => {
      await withMock(page)
      await open(page, { task: 'Selfie check-in' })
      check('static signals: a challenge starts', await waitLive(page, 'run', 25000))
      check('static signals: the attempt fails after the time limit', await waitLive(page, 'bad', 15000), JSON.stringify(await livenessState(page)))
      check('static signals: the shutter stays locked', (await shutterOk(page)).disabled)
      for (let a = 1; a < 3; a++) {
        await page.click('.cap-liveness__actions .cap-btn'); check(`retry ${a}: a new attempt starts`, await waitLive(page, 'run', 25000))
        check(`retry ${a}: and fails again`, await waitLive(page, 'bad', 15000))
      }
      const btn = await page.$eval('.cap-liveness__actions', (e) => e.innerText)
      check('after 3 failed attempts the worker is offered "Send for review" (not stranded)', /Send for review/.test(btn) && !/Try again/.test(btn), btn)
      await page.click('.cap-liveness__actions .cap-btn'); await sleep(400)
      check('"Send for review" unlocks the shutter', !(await shutterOk(page)).disabled)
      await page.click('.cap-shutter'); await page.waitForSelector('.cap-result', { timeout: 30000 })
      const qc = await page.$$eval('.cap-check', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')))
      check('the photo is accepted with a Liveness WARNING (sent for review), not blocked', qc.some((t) => /Liveness.*sent for review/.test(t)) && /accepted with warnings/i.test(await page.$eval('[data-testid=result-title]', (e) => e.innerText)), qc.join(' | '))
    } })
    // 3. NO MOCK: the real landmarker on a still photograph of a face (what the user reported) cannot pass
    await session('face', { fn: async (page) => {
      await open(page, { task: 'Selfie check-in', motion: [3, 0.1] })
      check('REAL model, a face that never moves: a challenge starts', await waitLive(page, 'run', 25000))
      check('REAL model, a face that never moves: the live check FAILS', await waitLive(page, 'bad', 15000), JSON.stringify(await livenessState(page)))
      const sh = await shutterOk(page)
      check('REAL model: the shutter stays locked, so a face on another screen cannot be submitted from the UI', sh.disabled && sh.ok === '0')
    } })
    // 4. no face in view: never starts
    await session('good', { fn: async (page) => {
      await open(page, { task: 'Selfie check-in' }); await sleep(6000)
      const st = await livenessState(page)
      check('no face in view: the prompt asks for a face and nothing starts', st?.tone === 'idle' && (await shutterOk(page)).disabled, JSON.stringify(st))
    } })
    // 5. other tasks are untouched
    for (const task of ['Shelf / site photo', 'Worker at site (face optional)']) await session('face', { fn: async (page) => {
      await open(page, { task }); await sleep(2500)
      check(`${task}: no live-check prompt and the shutter is free`, (await page.$('[data-liveness]')) === null && !(await shutterOk(page)).disabled)
    } })
  },
  async spoof() {
    // SYNTHETIC spoofs: a face shown on a "phone" (bezel + moire grid + drifting bands) and on paper. The challenge is
    // answered by the labelled MOCK (a worst case: a person who blinks and turns on the replayed video), so what is
    // measured here is the PASSIVE layer on real pixels from the real camera pipeline.
    const run = async (stream, label, fn) => session(stream, { fn: async (page) => {
      await withMock(page)
      await open(page, { task: 'Selfie check-in', query: '?hud=raw', motion: [3, 0.1] })
      check(`${label}: a challenge starts`, await waitLive(page, 'run', 25000))
      for (let i = 0; i < 2; i++) { const before = (await livenessState(page))?.challenge; await perform(page); if (i === 0) await page.waitForFunction((b) => { const e = document.querySelector('[data-liveness]'); return e?.dataset.challenge && e.dataset.challenge !== b }, { timeout: 6000 }, before).catch(() => {}) }
      check(`${label}: the scripted person passes the active challenge`, await waitLive(page, 'ok', 8000), JSON.stringify(await livenessState(page)))
      await sleep(4500) // let the passive evidence accumulate (moire every other tick, 8 frames of banding, ~1 s of landmarks)
      const passive = await page.evaluate(() => window.__passiveNow)
      console.log(`   ${label}: passive evidence (median over the session) moire ${passive?.session?.moire?.score?.toFixed(1)}, bezel ${passive?.session?.bezel?.score?.toFixed(2)}, banding ${passive?.session?.banding?.score?.toFixed(2)}, planar ${passive?.session?.planar?.planar}`)
      await fn(page, passive)
    } })
    await run('spoofscreen', 'phone screen', async (page, passive) => {
      check('phone screen: moire is detected', passive?.session?.moire?.score >= 8, String(passive?.session?.moire?.score))
      check('phone screen: the screen frame (bezel) is detected', passive?.session?.bezel?.score >= 0.4, String(passive?.session?.bezel?.score))
      check('phone screen: bands drifting between frames are detected', passive?.session?.banding?.score > 0, String(passive?.session?.banding?.score))
      const r = (await rows(page)).liveness
      check('phone screen: the HUD says the picture looks like a screen even though the challenge passed', r?.status === 'warn' && /screen/.test(r.text), JSON.stringify(r))
      await page.screenshot({ path: `${process.env.E2E_SHOTS ?? '/tmp'}/spoof-screen-hud.png` })
      await page.click('.cap-shutter'); await page.waitForSelector('.cap-result', { timeout: 30000 })
      const qc = await page.$$eval('.cap-check', (x) => x.map((e) => e.innerText.replace(/\s+/g, ' ')))
      check('phone screen: the captured photo is flagged "may show a screen or a print" (warning, sent for review), not passed', qc.some((t) => /Liveness.*screen or a print/.test(t)) && /accepted with warnings/i.test(await page.$eval('[data-testid=result-title]', (e) => e.innerText)), qc.filter((t) => /Liveness/.test(t)).join(' | '))
    })
    await run('spoofprint', 'paper print', async (page, passive) => {
      check('paper print: the paper frame is detected (evidence)', passive?.session?.bezel?.score >= 0.4, String(passive?.session?.bezel?.score))
      const r = (await rows(page)).liveness
      // A clean, complete frame around the face (bezel score 1.0) is enough on its own to flag for review (0.5 >= 0.45);
      // the real photos' false frames peaked at 0.75 (0.375, no flag). The active challenge is what stops a print.
      check('paper print: a complete frame around the face is flagged for review, not blocked', r?.status === 'warn' && /screen/.test(r.text), JSON.stringify(r))
    })
    // control: the same face without any screen artefacts must not be flagged
    await run('face', 'control (clean face)', async (page, passive) => {
      const r = (await rows(page)).liveness
      check('control: clean face, challenge passed -> Liveness passes and no screen flag', r?.status === 'pass' && r.text === 'passed', JSON.stringify(r))
      check('control: moire stays below the warn level', (passive?.session?.moire?.score ?? 0) < 8, String(passive?.session?.moire?.score))
    })
  },
  async fullstack() {
    // Needs the ISOLATED backend (E2E_API, default http://127.0.0.1:8001) and a Vite started with VITE_API_URL pointing at it.
    // The live person is the labelled MOCK; everything else (challenge request, evidence, submit, server re-check) is real.
    const API = process.env.E2E_API ?? 'http://127.0.0.1:8001'
    await session('face', { fn: async (page) => {
      await withMock(page)
      const reqs = []
      page.on('request', (r) => { if (r.url().includes('/liveness/challenge')) reqs.push(r.url()) })
      // a multipart body is not readable from puppeteer's request object: keep the payload the page sends
      await page.evaluateOnNewDocument(() => { const f = window.fetch; window.fetch = (u, o) => { if (o?.body instanceof FormData && String(u).endsWith('/submissions')) window.__payload = o.body.get('payload'); return f(u, o) } })
      await open(page, { task: 'Selfie check-in', motion: [3, 0.1] })
      check('the page talks to the isolated backend, never the real one', (await page.evaluate(() => performance.getEntriesByType('resource').some((x) => x.name.includes(':8000')))) === false)
      check('a challenge starts', await waitLive(page, 'run', 25000))
      check('the challenge came from the server (a nonce was requested)', reqs.length >= 1 && reqs[0].startsWith(API), reqs.join(','))
      for (let i = 0; i < 2; i++) { const before = (await livenessState(page))?.challenge; await perform(page); if (i === 0) await page.waitForFunction((b) => { const e = document.querySelector('[data-liveness]'); return e?.dataset.challenge && e.dataset.challenge !== b }, { timeout: 6000 }, before).catch(() => {}) }
      check('live check passes', await waitLive(page, 'ok', 8000))
      await page.click('.cap-shutter'); await page.waitForSelector('.cap-result', { timeout: 30000 })
      const submit = await page.$('[data-testid=arrived-btn]'); await submit.click()
      await page.waitForSelector('.verdict', { timeout: 60000 })
      const list = await (await fetch(`${API}/submissions`)).json(); const latest = list[0]
      const full = await (await fetch(`${API}/submissions/${latest.id}`)).json()
      const live = full.photo_quality.server.checks.liveness
      check('server: the liveness check passed after replaying the evidence', live?.status === 'pass' && live.details.reason === 'challenge_passed' && live.details.replay.phase === 'passed', JSON.stringify(live?.details).slice(0, 160))
      check('server: no liveness flags and a passing photo verdict', !full.quality_flags.some((f) => f.startsWith('liveness') || f === 'spoof_suspected') && full.photo_verdict !== 'block', full.quality_flags.join(','))
      // --- attacks on the API, as a client that skips the UI would do ---
      const payload = JSON.parse(await page.evaluate(() => window.__payload))
      const photo = await (await fetch(`${API}/submissions/${latest.id}/photo`)).blob()
      const post = async (p) => { const f = new FormData(); f.append('payload', JSON.stringify(p)); f.append('photo', photo, 'p.jpg'); return (await fetch(`${API}/submissions`, { method: 'POST', body: f })).json() }
      const nonce = payload.liveness_evidence.nonce
      const replay = await post({ ...payload, worker_id: 'worker_other' }) // same evidence, other worker
      check('API attack: the same evidence from another worker is rejected as forged and blocked', replay.quality_flags.includes('liveness_forged') && replay.photo_verdict === 'block', replay.quality_flags.join(','))
      const retry = await post(payload) // Phase 8d: the SAME worker re-sends the SAME submission (a lost response): a retry, not an attack
      check('retry: the same photo and evidence re-sent after a lost response is NOT treated as a replay', !retry.quality_flags.includes('liveness_replayed') && !retry.quality_flags.some((f) => f.startsWith('liveness_')) , retry.quality_flags.join(','))
      const photo2 = new Blob([photo, new Uint8Array([0xff, 0xfe, 0x00, 0x04, 0x41, 0x42])], { type: 'image/jpeg' }) // different bytes (a JPEG comment segment)
      const again = await (async () => { const f = new FormData(); f.append('payload', JSON.stringify(payload)); f.append('photo', photo2, 'p2.jpg'); return (await fetch(`${API}/submissions`, { method: 'POST', body: f })).json() })()
      check('API attack: replaying the spent nonce with a different photo is rejected and blocked', again.quality_flags.includes('liveness_replayed') && again.photo_verdict === 'block', again.quality_flags.join(','))
      const forged = await post({ ...payload, liveness_evidence: { ...payload.liveness_evidence, nonce: nonce + 'x' } })
      check('API attack: a forged nonce is rejected and blocked', forged.quality_flags.includes('liveness_forged') && forged.photo_verdict === 'block', forged.quality_flags.join(','))
      const bare = await post({ ...payload, liveness_evidence: null })
      check('API attack: a "camera" photo with no evidence (UI bypassed) is unverified and blocked', bare.quality_flags.includes('liveness_unverified') && bare.photo_verdict === 'block', bare.quality_flags.join(','))
      const claim = await post({ ...payload, liveness_evidence: null, photo_quality: { ...payload.photo_quality, checks: { ...payload.photo_quality.checks, liveness: { status: 'pass', score: 1, value: 1 } } } })
      check('API attack: claiming a liveness pass without evidence is also caught (client_missed_liveness)', claim.quality_flags.includes('client_missed_liveness'), claim.quality_flags.join(','))
    } })
  },
  async fusion_layout() {
    // The Visit recording box sits above the camera. It must not push the shutter below the fold: on a desktop-sized window the page
    // must not even need the scroll-into-view that rescues the shutter (that scroll is the safety net, not the design).
    for (const [w, h] of [[1440, 900], [1280, 720], [1024, 768]]) await session('good', { width: w, height: h, fn: async (page) => {
      await page.goto(BASE, { waitUntil: 'networkidle0' }); await page.evaluate(() => { try { localStorage.clear() } catch {} }); await page.goto(BASE, { waitUntil: 'networkidle0' })
      const visit = await page.evaluate(() => document.querySelector('[data-testid=visit-panel]')?.getBoundingClientRect().height ?? 0)
      check(`${w}x${h}: the visit box is a single compact row (<= 70 px)`, visit > 0 && visit <= 70, `${visit.toFixed(0)} px`)
      await page.click('.cap-start'); await page.waitForSelector('.cap-shutter', { timeout: 30000 }); await sleep(1500)
      const m = await page.evaluate(() => ({ scrollY: Math.round(scrollY), b: document.querySelector('.cap-shutter').getBoundingClientRect().bottom, ih: innerHeight, stageW: document.querySelector('.cap-stage').getBoundingClientRect().width, iw: innerWidth }))
      check(`${w}x${h}: the shutter is in view without the page having to scroll`, m.scrollY <= 2 && m.b <= m.ih, `scrollY ${m.scrollY}, shutter bottom ${m.b.toFixed(1)} of ${m.ih}`)
      check(`${w}x${h}: the camera is still large (>= 45% of the window width)`, m.stageW >= 0.45 * m.iw, `${m.stageW.toFixed(0)} of ${m.iw}`)
    } })
  },
  async fusion_genuine() {
    // A genuine arrival: walks 60 m to the site in 40 s (walking motion), then stands there (tremor). The recorder, the visit session,
    // the trail, the server's consistency engine and the case file are all real.
    const API = process.env.E2E_API ?? 'http://127.0.0.1:8001'
    check('setup: the site location is registered in the isolated backend', await putSite(API))
    await session('good', { fn: async (page) => {
      await fusionPage(page)
      await page.waitForSelector('[data-testid=visit-panel] .cap-visit__live', { timeout: 15000 })
      check('consent was given earlier: the recording started by itself (no tap)', true)
      check('the server opened a visit for it', await page.waitForFunction(() => document.querySelector('[data-testid=visit-panel]')?.innerText.includes('Recording'), { timeout: 5000 }).then(() => true, () => false))
      await motionKind(page, 'walk')
      await walkTo(page, [-60, 0], [-30, 0], 20)
      const a = await feed(page)
      await walkTo(page, [-30, 0], [0, 0], 20)
      const b = await feed(page)
      check('live feed: the GPS numbers are the scripted ones and change while walking (lat 5 decimals, longitude moves east, more fixes)', Math.abs(parseFloat(a.lat) - 12.9716) < 0.0001 && Math.abs(parseFloat(b.lat) - 12.9716) < 0.0001 && /^\d+\.\d{5}$/.test(b.lat) && parseFloat(b.lng) > parseFloat(a.lng) && Number(b.fixes) > Number(a.fixes) && /±\d+ m/.test(b.accuracy), JSON.stringify({ a: [a.lat, a.lng, a.fixes], b: [b.lat, b.lng, b.fixes, b.accuracy] }))
      check('live feed: |acceleration| and |rotation| are live numbers, the sensor rate is shown', num(b.acc) > 0.3 && num(b.gyro) > 3 && num(b.rate) >= 20, `${b.acc} · ${b.gyro} · ${b.rate}`)
      check('live feed: the activity is "walking" with a step rhythm near 1.9 Hz', b.activity === 'walking' && Math.abs(num(b.rhythm) - 1.9) < 0.4, `${b.activity} ${b.rhythm}`)
      check('live feed: the visit id, the clock offset and 5 s windows are shown', /^[\w-]{8}$/.test(b.visit) && /ms$/.test(b.offset) && Number(b.windows) >= 4, `${b.visit} ${b.offset} ${b.windows}`)
      check('live feed: the trail drawing is there, with the registered site', (await page.$('[data-testid=feed-trail] .cap-trail__site')) !== null && (await page.$('[data-testid=feed-trail] .cap-trail__path')) !== null)
      const na = await page.$eval('[data-testid=feed-na]', (e) => e.innerText)
      check('live feed: what cannot be fetched is listed with the reason (WiFi, cell, mock flag, background)', /WiFi/.test(na) && /Cell towers/.test(na) && /mock location/i.test(na) && /screen is off/i.test(na) && /native app/.test(na))
      await page.evaluate(() => document.querySelector('[data-testid=sensor-feed]').scrollIntoView({ block: 'start' })); await sleep(400)
      await shot(page, 'fusion-feed-walking')
      await page.evaluate(() => scrollTo(0, 0))
      await motionKind(page, 'still')
      await stay(page, [0, 0], 25)
      const c = await feed(page)
      check('live feed: standing at the site the activity becomes "still"', c.activity === 'still', c.activity)
      check('the live summary shows fixes and distance', /\d+ location fixes? · \d+ m/.test(await page.$eval('[data-testid=visit-panel]', (e) => e.innerText)), await page.$eval('[data-testid=visit-panel]', (e) => e.innerText.replace(/\s+/g, ' ')))
      const n0 = (await (await fetch(`${API}/submissions`)).json()).length // earlier scenarios in a full run have already stored submissions
      await page.click('.cap-start').catch(() => {}); await page.waitForSelector('.cap-shutter', { timeout: 30000 }); await sleep(2500)
      await page.evaluate(() => scrollTo(0, 0)); await sleep(300); await page.click('.cap-shutter'); await page.waitForSelector('.cap-result', { timeout: 30000 })
      check('worker flow: after the photo is verified the button is "I\'ve reached the site" and a hint explains what happens next', /I've reached the site/.test(await page.$eval('[data-testid=arrived-btn]', (e) => e.innerText)) && /Photo checked/.test(await page.$eval('[data-testid=arrival-hint]', (e) => e.innerText)))
      check('worker flow: the sensor fusion has NOT been sent yet (no NEW submission exists before the tap)', (await (await fetch(`${API}/submissions`)).json()).length === n0)
      await (await page.$('[data-testid=arrived-btn]')).click()
      check('worker flow: the next step is "Arrival" (the stepper marks it active)', /arrival/i.test(await page.$eval('.stepper [aria-current=step]', (e) => e.innerText).catch(() => '')) || /verifying your arrival/i.test(await page.evaluate(() => document.body.innerText)))
      await page.waitForSelector('.verdict', { timeout: 60000 })
      const payload = JSON.parse(await page.evaluate(() => window.__payload))
      check('the submission carried a visit id and a trail with fixes and windows', !!payload.visit_id && payload.trail?.fixes?.length >= 8 && payload.trail?.windows?.length >= 8, `${payload.trail?.fixes?.length} fixes, ${payload.trail?.windows?.length} windows`)
      check('the trail says what the sensors were (location granted, motion granted, gyroscope)', payload.trail.sensors.geo === 'granted' && payload.trail.sensors.motion === 'granted' && payload.trail.sensors.gyro === true, JSON.stringify(payload.trail.sensors))
      check('walking windows show a walking rhythm near 1.9 Hz', payload.trail.windows.filter((w) => w.cad_hz && Math.abs(w.cad_hz - 1.9) < 0.35 && w.cad_pw > 0.4).length >= 4, payload.trail.windows.slice(0, 10).map((w) => `${w.cad_hz}/${w.cad_pw}`).join(' '))
      const full = await latest(API)
      check('server: fusion scored it (version 1) with motion known', full.fusion_version === 1 && full.motion_known === true, `v${full.fusion_version} known ${full.motion_known}`)
      check('server: motion consistency is high (>= 0.85) and the submission is accepted', full.motion_score >= 0.85 && full.status === 'accepted', `${full.motion_score} ${full.status}`)
      check('server: no spoof flags, and the visit was verified', !full.quality_flags.some((f) => /^(gps_jump|flat_motion|trail_|visit_unverified|arrival_without|gps_outside)/.test(f)), full.quality_flags.join(','))
      check('server: the trail points and the site are stored for the case file', full.fusion.trail.points.length >= 6 && full.fusion.site?.radius_m === 60, `${full.fusion.trail.points.length} points`)
      const vs = await vsum(page)
      const mv = vs.find((l) => /Movement vs GPS/i.test(l.text)); const ar = vs.find((l) => /Arrival at site/i.test(l.text))
      check('verdict: "Movement vs GPS" says the movement matches, in green', mv && /green/.test(mv.cls), JSON.stringify(mv))
      check('verdict: "Arrival at site" says GPS places the worker at the site, in green', ar && /green/.test(ar.cls) && /places you at the site/.test(ar.text), JSON.stringify(ar))
      const fe = await fetched(page)
      check('verdict: "What was fetched" counts fixes and motion windows, the activity share, the registered site, no jumps', /\d+ fixes/.test(fe.fixes?.text) && /five-second windows/.test(fe.windows?.text) && /walking \d+%/.test(fe.activity?.text) && /registered, radius 60 m/.test(fe.site?.text) && /none/.test(fe.jumps?.text), JSON.stringify(Object.values(fe).map((x) => x.text)))
      check('verdict: the IP line says what it got on a loopback test (private address or no database), not a made-up place', /private|not available/.test(fe.ip?.text), fe.ip?.text)
      check('verdict: no "GPS unavailable" note when the visit recording had fresh fixes', !/GPS unavailable/.test(await page.evaluate(() => document.body.innerText)) && payload.gps?.lat != null, JSON.stringify(payload.gps))
      await page.evaluate(() => document.querySelector('[data-testid=fetched-panel]').scrollIntoView({ block: 'center' })); await sleep(500)
      await shot(page, 'fusion-verdict-genuine')
      await page.goto(BASE + 'dashboard', { waitUntil: 'networkidle0' })
      await page.waitForSelector('[data-testid=subs-table] tbody tr', { timeout: 20000 })
      await (await page.$$('[data-testid=subs-table] tbody tr'))[0].click()
      await openSensors(page)
      await page.waitForSelector('[data-testid=fusion-section] .rd-fz-trail', { timeout: 15000 })
      await sleep(1200)
      const t = await page.$eval('[data-testid=fusion-section]', (e) => e.innerText.replace(/\s+/g, ' '))
      check('the case file shows the Sensor fusion section: both scores, "consistent", the trail drawing and the timeline', /Motion vs GPS trail/i.test(t) && /Network vs claimed area/i.test(t) && /consistent/.test(t) && (await page.$$('.rd-fz-strip')).length >= 2, t.slice(0, 200))
      await page.evaluate(() => document.querySelector('[data-testid=fusion-section]').scrollIntoView({ block: 'start' })); await sleep(300)
      await page.screenshot({ path: `${process.env.E2E_SHOTS ?? '/tmp'}/fusion-genuine.png` })
    } })
  },
  async fusion_teleport() {
    // The headline spoof: the GPS sits 14 km away, jumps onto the site, and the phone never moves. Perfect photo (the live camera).
    const API = process.env.E2E_API ?? 'http://127.0.0.1:8001'
    await putSite(API)
    await session('good', { fn: async (page) => {
      await fusionPage(page, { start: at(-14000, 0) }) // the faker's GPS starts far away (so there is exactly ONE jump, onto the site)
      await page.waitForSelector('[data-testid=visit-panel] .cap-visit__live', { timeout: 15000 })
      await motionKind(page, 'still')
      await stay(page, [-14000, 0], 32)
      await stay(page, [0, 0], 32)
      await submitThroughTheUi(page)
      const full = await latest(API)
      check('server: the GPS jump with a still phone is detected', full.quality_flags.includes('gps_jump') && full.quality_flags.includes('gps_jump_flat_motion'), full.quality_flags.join(','))
      check('server: motion consistency is low (< 0.4) even though the photo is fine', full.motion_score < 0.4 && full.photo_verdict !== 'block', `${full.motion_score} ${full.photo_verdict}`)
      check('server: flagged by the classifier and in the review queue, with a reason that states what was measured', full.status === 'flagged' && full.needs_review === true && /jumped/.test(full.top_reason) && !/location change/.test(full.top_reason), `${full.status} ${full.top_reason}`)
      check('the verdict screen shows FLAGGED and the reason', /FLAGGED/.test(await page.$eval('.verdict', (e) => e.innerText)) && /jumped/.test(await page.$eval('.reason__text', (e) => e.innerText)))
      const vs = await vsum(page)
      const mv = vs.find((l) => /Movement vs GPS/i.test(l.text))
      check('verdict: "Movement vs GPS" states the jump, in red', mv && /jumped/.test(mv.text) && /red/.test(mv.cls), JSON.stringify(mv))
      const fe = await fetched(page)
      check('verdict: "What was fetched" shows the GPS jump in red', /1 jump/.test(fe.jumps?.text) && /feed--red/.test(fe.jumps?.cls), JSON.stringify(fe.jumps))
      await page.evaluate(() => document.querySelector('[data-testid=fusion-verdict]').scrollIntoView({ block: 'start' })); await sleep(500)
      await shot(page, 'fusion-verdict-teleport')
      await page.goto(BASE + 'dashboard', { waitUntil: 'networkidle0' })
      await page.waitForSelector('[data-testid=subs-table] tbody tr', { timeout: 20000 })
      await (await page.$$('[data-testid=subs-table] tbody tr'))[0].click()
      await openSensors(page)
      await page.waitForSelector('[data-testid=fusion-section] .rd-fz-trail', { timeout: 15000 }); await sleep(1200)
      const t = await page.$eval('[data-testid=fusion-section]', (e) => e.innerText.replace(/\s+/g, ' '))
      check('the case file shows "inconsistent", the jump in words and a dashed jump line', /inconsistent/.test(t) && /GPS jump, phone still/.test(t) && (await page.$('.rd-fz-jump')) !== null, t.slice(0, 220))
      await page.evaluate(() => document.querySelector('[data-testid=fusion-section]').scrollIntoView({ block: 'start' })); await sleep(300)
      await page.screenshot({ path: `${process.env.E2E_SHOTS ?? '/tmp'}/fusion-teleport.png` })
    } })
  },
  async fusion_notarrived() {
    // The worker taps "I've reached the site" while the GPS puts them 500 m away: arrival not confirmed, in red, sent for review (never blocked).
    const API = process.env.E2E_API ?? 'http://127.0.0.1:8001'
    await putSite(API)
    await session('good', { fn: async (page) => {
      await fusionPage(page, { start: at(-500, 0) })
      await page.waitForSelector('[data-testid=visit-panel] .cap-visit__live', { timeout: 15000 })
      await motionKind(page, 'still')
      await stay(page, [-500, 0], 32)
      await submitThroughTheUi(page)
      const vs = await vsum(page)
      const ar = vs.find((l) => /Arrival at site/i.test(l.text))
      check('verdict: "Arrival at site" is red and says the GPS places the worker about 500 m away', ar && /red/.test(ar.cls) && /(49|5\d)\d m from the site/.test(ar.text) && /not confirmed/.test(ar.text), JSON.stringify(ar))
      const full = await latest(API)
      check('server: flagged gps_outside_site (evidence for the reviewer), the submission was stored, nothing was blocked', full.quality_flags.includes('gps_outside_site') && full.id > 0, full.quality_flags.join(','))
      await shot(page, 'fusion-notarrived')
    } })
  },
  async fusion_optout() {
    // The worker has not agreed to the recording: nothing is recorded, nothing is sent, the submission works and is "not enough data", not flagged.
    const API = process.env.E2E_API ?? 'http://127.0.0.1:8001'
    await session('good', { fn: async (page) => {
      await fusionPage(page, { consent: false })
      check('without consent the panel shows the consent text and a start button, and nothing is recording', (await page.$('[data-testid=visit-panel] .cap-visit__live')) === null && /Start recording my visit/.test(await page.$eval('[data-testid=visit-panel]', (e) => e.innerText)) && /recorded|records/i.test(await page.$eval('[data-testid=visit-panel]', (e) => e.innerText)))
      await submitThroughTheUi(page)
      const payload = JSON.parse(await page.evaluate(() => window.__payload))
      check('no trail and no visit id were sent', payload.trail === null && payload.visit_id === null, JSON.stringify([payload.trail, payload.visit_id]))
      const full = await latest(API)
      check('server: not suspicious: the info flag, a GPS-only site check (inside the site: 0.9), accepted', full.quality_flags.includes('fusion_insufficient_evidence') && full.fusion.motion.sensor_used === false && full.motion_score >= 0.85 && full.status === 'accepted', `${full.quality_flags.join(',')} ${full.motion_score} ${full.status}`)
      check('the case file says the check was GPS only and that there was not enough sensor data', await (async () => {
        await page.goto(BASE + 'dashboard', { waitUntil: 'networkidle0' }); await page.waitForSelector('[data-testid=subs-table] tbody tr', { timeout: 20000 }); await (await page.$$('[data-testid=subs-table] tbody tr'))[0].click()
        await openSensors(page)
        await page.waitForSelector('[data-testid=fusion-section] .rd-fz-score', { timeout: 15000 }); await sleep(900)
        const t = await page.$eval('[data-testid=fusion-section]', (e) => e.innerText.replace(/\s+/g, ' ')); return /GPS only \(no motion data\)/.test(t) && /Not enough sensor data/i.test(t) && !/inconsistent/.test(t)
      })())
    } })
  },
  async fusion_denied() {
    // Consent given but the browser denies location: the panel says so, the submission still goes through as "not enough data".
    const API = process.env.E2E_API ?? 'http://127.0.0.1:8001'
    await session('good', { fn: async (page) => {
      await fusionPage(page, { geo: false })
      await page.waitForFunction(() => /Location access was denied/.test(document.querySelector('[data-testid=visit-panel]')?.innerText ?? ''), { timeout: 15000 })
      check('the worker is told location was denied, in words', true)
      await motionKind(page, 'still'); await sleep(8000)
      await submitThroughTheUi(page)
      const payload = JSON.parse(await page.evaluate(() => window.__payload))
      check('the trail records that location was denied (not a fake position)', payload.trail?.sensors?.geo === 'denied' && payload.trail.fixes.length === 0, JSON.stringify(payload.trail?.sensors))
      const full = await latest(API)
      check('server: unknown, accepted, no accusation', full.motion_known === false && full.status === 'accepted' && !full.quality_flags.some((f) => /^(gps_|flat_|arrival_)/.test(f)), full.quality_flags.join(','))
    } })
  },
  async fusion_demo() {
    // The judges' demo on the laptop (npm run demo:laptop: a visible Chrome; npm run e2e fusion_demo: headless with checks).
    // Same real page / recorder / server as the scenarios above; only the GPS and motion are scripted. 1) register the spot from
    // the page, 2) genuine walk -> Verified, 3) GPS teleport with a still phone -> Flagged, 4) the dashboard case file stays open.
    const API = process.env.E2E_API ?? 'http://127.0.0.1:8001'
    const pause = (ms) => sleep(HEADFUL ? ms : 0)
    await session('good', { width: 1280, height: 860, keepOpen: true, fn: async (page) => {
      await page.browserContext().overridePermissions(new URL(BASE).origin, ['geolocation'])
      await page.evaluateOnNewDocument(() => {
        try { if (!sessionStorage.getItem('demo.started')) { localStorage.clear(); sessionStorage.setItem('demo.started', '1') } localStorage.setItem('fusion.consent.v1', '1') } catch {}
        if (typeof DeviceMotionEvent !== 'undefined') DeviceMotionEvent.requestPermission = async () => 'granted'
      })
      await page.setGeolocation(at(0, 0))
      await page.goto(BASE + '?demo=1', { waitUntil: 'networkidle0' })
      await page.waitForSelector('[data-testid=demo-tools] button', { timeout: 15000 })
      await page.setGeolocation(at(0, 0)) // headless Chrome applies the scripted position only to calls made after the page loaded
      console.log('   1. register this spot as the site')
      const prior = await fetch(`${API}/sites/site_demo_1`).then((r) => (r.ok ? r.json() : null)) // in a full run an earlier scenario registered it
      await page.click('[data-testid=demo-tools] button')
      const reg = await page.waitForFunction(() => /is now site_demo_1/.test(document.querySelector('[data-testid=demo-tools]')?.innerText ?? ''), { timeout: 20000 }).then(() => true, () => false)
      check('demo: "Register this spot as the site" stores the page\'s location as site_demo_1 and keeps an existing site\'s radius and country', reg && await (async () => { const j = await (await fetch(`${API}/sites/site_demo_1`)).json(); return j.radius_m === (prior?.radius_m ?? 80) && (j.country ?? null) === (prior ? (prior.country ?? null) : null) })(), await page.$eval('[data-testid=demo-tools]', (e) => e.innerText.replace(/\s+/g, ' ')))
      await pause(2500)

      console.log('   2. genuine arrival: go 60 m away, start recording, walk to the spot, stand there, photo, submit')
      // On stage: register at the spot, walk away, then start the recording (a fresh visit) and walk back.
      if (await page.$('[data-testid=visit-panel] .cap-visit__live')) await page.click('[data-testid=visit-panel] .cap-visit__row .cap-btn--sm')
      await page.setGeolocation(at(-60, 0))
      await page.waitForFunction(() => /Start recording my visit/.test(document.querySelector('[data-testid=visit-panel]')?.innerText ?? ''), { timeout: 10000 })
      await sleep(1500)
      await page.$$eval('[data-testid=visit-panel] button', (bs) => bs.find((b) => /Start recording/.test(b.innerText))?.click())
      await page.waitForSelector('[data-testid=visit-panel] .cap-visit__live', { timeout: 15000 })
      await page.evaluate(() => document.querySelector('[data-testid=sensor-feed]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
      await motionKind(page, 'walk')
      await walkTo(page, [-60, 0], [0, 0], 40)
      await motionKind(page, 'still')
      await stay(page, [0, 0], 22)
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }))
      await submitThroughTheUi(page)
      const g = await latest(API)
      check('demo: the genuine walk is accepted with consistent movement', g.status === 'accepted' && g.motion_score >= 0.85, `${g.status} ${g.motion_score} ${g.quality_flags.join(',')} | ${g.top_reason}`)
      await page.evaluate(() => document.querySelector('[data-testid=fusion-verdict]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
      await pause(6000)

      console.log('   3. fake location: the GPS sits 14 km away, then jumps onto the site; the phone stays on the table')
      await page.setGeolocation(at(-14000, 0))
      await motionKind(page, 'still')
      await (await page.$('.btn--block')).click() // New submission (the recording restarts by itself: consent was given)
      await page.waitForSelector('[data-testid=visit-panel] .cap-visit__live', { timeout: 15000 })
      await stay(page, [-14000, 0], 30)
      await stay(page, [0, 0], 30)
      await submitThroughTheUi(page)
      const f = await latest(API)
      check('demo: the teleport is flagged with the jump in words', f.status === 'flagged' && f.quality_flags.includes('gps_jump_flat_motion') && /jumped/.test(f.top_reason), `${f.status} ${f.top_reason}`)
      await page.evaluate(() => document.querySelector('[data-testid=fusion-verdict]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
      await pause(6000)

      console.log('   4. the dashboard case file of the flagged visit')
      await page.goto(BASE + 'dashboard', { waitUntil: 'networkidle0' })
      await page.waitForSelector('[data-testid=subs-table] tbody tr', { timeout: 20000 })
      await (await page.$$('[data-testid=subs-table] tbody tr'))[0].click()
      await openSensors(page)
      await page.waitForSelector('[data-testid=fusion-section] .rd-fz-trail', { timeout: 15000 }); await sleep(1200)
      await page.evaluate(() => document.querySelector('[data-testid=fusion-section]').scrollIntoView({ block: 'start', behavior: 'smooth' })); await sleep(600)
      check('demo: the case file shows the dashed jump', (await page.$('.rd-fz-jump')) !== null)
      await shot(page, 'fusion-demo-casefile')
    } })
  },
  async casefile() {
    // The dashboard case file shows the live-check evidence for submissions made by `fullstack` (isolated backend).
    await session('good', { fn: async (page) => {
      await page.goto(BASE + 'dashboard', { waitUntil: 'networkidle0' })
      await page.waitForSelector('[data-testid=subs-table] tbody tr', { timeout: 20000 })
      const rowsText = await page.$$eval('[data-testid=subs-table] tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')))
      const idx = rowsText.findIndex((t) => /liveness/i.test(t))
      check('the feed lists submissions with liveness flags', idx >= 0, `${rowsText.length} rows`)
      const trs = await page.$$('[data-testid=subs-table] tbody tr'); await trs[Math.max(0, idx)].click()
      await openPhoto(page)
      await page.waitForSelector('[data-testid=liveness-section]', { timeout: 10000 })
      const t = await page.$eval('[data-testid=liveness-section]', (e) => e.innerText.replace(/\s+/g, ' '))
      check('the case file has a Live check section with the result, the challenges and the nonce state', /live check/i.test(t) && /result/i.test(t) && /nonce/i.test(t), t.slice(0, 220))
      check('a rejected one says why', /rejected because/i.test(t) || /passed/i.test(t), t.slice(0, 120))
      await sleep(1200) // the drawer slides in
      await page.evaluate(() => document.querySelector('[data-testid=liveness-section]').scrollIntoView({ block: 'center' })); await sleep(300)
      await page.screenshot({ path: `${process.env.E2E_SHOTS ?? '/tmp'}/casefile-liveness.png` })
    } })
  },
  async liveoffline() {
    // Phase 8d: the challenge request fails -> an explicit message (no silent local fallback), the shutter stays locked,
    // and when the server is reachable again the check starts by itself. Exactly ONE nonce is requested per attempt.
    await session('face', { fn: async (page) => {
      await withMock(page)
      // The page's fetch is wrapped (puppeteer request interception breaks module loading here): while __block is set the
      // challenge request fails like an offline phone; otherwise it goes through to the isolated backend.
      await page.evaluateOnNewDocument(() => { window.__block = true; window.__reqs = []; const f = window.fetch; window.fetch = (u, o) => { if (String(u).includes('/liveness/challenge')) { window.__reqs.push(window.__block ? 'blocked' : 'sent'); if (window.__block) return Promise.reject(new TypeError('Failed to fetch')) } return f(u, o) } })
      await open(page, { task: 'Selfie check-in', motion: [3, 0.1] })
      check('server unreachable: the worker is told, in words', await waitLive(page, 'offline', 25000), JSON.stringify(await livenessState(page)))
      const st = await livenessState(page)
      check('the message says it cannot reach the server', /can.?t reach the server/i.test(st?.text ?? ''), st?.text)
      check('the shutter stays locked while there is no live check', (await shutterOk(page)).disabled)
      await page.evaluate(() => { window.__block = false })
      check('the server comes back: the live check starts by itself (no reload)', await waitLive(page, 'run', 20000), JSON.stringify(await livenessState(page)))
      const reqs = await page.evaluate(() => window.__reqs); const sent = reqs.filter((x) => x === 'sent').length
      check('exactly one real challenge request was made for this attempt (one nonce)', sent === 1, `sent ${sent}, blocked ${reqs.filter((x) => x === 'blocked').length}`)
    } })
  },
  async review() {
    // Phase 8e: a flagged case shows up in the Review queue; a reviewer records a decision with a reason; the queue, the
    // feed and the case file show it. Self-contained: it creates its own blocked submission through the isolated API.
    const API = process.env.E2E_API ?? 'http://127.0.0.1:8001'
    const { createCanvas } = await import('@napi-rs/canvas')
    const c = createCanvas(900, 700); const x = c.getContext('2d'); x.fillStyle = '#050505'; x.fillRect(0, 0, 900, 700) // a black frame: blocked by the server
    const f = new FormData(); f.append('payload', JSON.stringify({ worker_id: 'worker_review_e2e', task_id: 'task_demo_1', site_id: 'site_review_e2e', photo_quality_pass: false, capture_source: 'file' }))
    f.append('photo', new Blob([c.toBuffer('image/jpeg', 90)], { type: 'image/jpeg' }), 'black.jpg')
    const made = await (await fetch(`${API}/submissions`, { method: 'POST', body: f })).json()
    check('setup: the server blocked the black photo and put it in the review queue', made.photo_verdict === 'block' && made.needs_review === true, `${made.photo_verdict} ${made.needs_review}`)
    await session('good', { fn: async (page) => {
      await page.goto(BASE + 'dashboard', { waitUntil: 'networkidle0' })
      await page.waitForSelector('[data-testid=review-queue]', { timeout: 20000 })
      await page.waitForFunction(() => Number(document.querySelector('[data-testid=review-count]')?.innerText) >= 1, { timeout: 15000 })
      const before = Number(await page.$eval('[data-testid=review-count]', (e) => e.innerText))
      check('the Review queue lists the blocked photo with its reason', await page.$$eval('[data-testid=queue-row]', (r) => r.some((x) => x.innerText.includes('worker_review_e2e') && /blocked/i.test(x.innerText))), `queue ${before}`)
      await page.$$eval('[data-testid=queue-row]', (r) => { (r.find((x) => x.innerText.includes('worker_review_e2e')) ?? r[0]).click() })
      await page.waitForSelector('[data-testid=review-section]', { timeout: 10000 })
      await sleep(900) // the drawer slides in
      await page.type('[data-testid=review-name]', 'Reviewer E2E')
      await page.click('[data-testid=review-choice-reject]'); await page.click('[data-testid=review-submit]')
      check('a reject without a reason is refused in plain words', /why/i.test(await page.$eval('[data-testid=review-error]', (e) => e.innerText).catch(() => '')))
      await page.type('[data-testid=review-reason]', 'black frame, nothing to verify')
      await page.click('[data-testid=review-submit]')
      await page.waitForSelector('[data-testid=review-current]', { timeout: 10000 })
      const cur = await page.$eval('[data-testid=review-current]', (e) => e.innerText)
      check('the case file shows the decision, the reviewer and the reason', /Reject/.test(cur) && /Reviewer E2E/.test(cur) && /black frame/.test(cur), cur)
      await page.screenshot({ path: `${process.env.E2E_SHOTS ?? '/tmp'}/review-casefile.png` })
      await page.waitForFunction((b) => Number(document.querySelector('[data-testid=review-count]')?.innerText) < b, { timeout: 15000 }, before)
      check('the case left the queue', true)
      const stored = await (await fetch(`${API}/submissions/${made.id}`)).json()
      check('stored with the reviewer and a timestamp (a REAL label)', stored.review?.decision === 'reject' && stored.review.reviewer === 'Reviewer E2E' && !!stored.review.at, JSON.stringify(stored.review))
    } })
  },
  async layout() {
    // 7b: three viewports. phone = immersive full-viewport camera, tablet = stage with the HUD under it, desktop = stage with the HUD beside it.
    for (const [w, h, layout] of [[390, 844, 'overlay'], [768, 1024, 'under'], [1440, 900, 'side']]) {
      await session('good', { width: w, height: h, fn: async (page) => {
        await open(page); await sleep(2200)
        check(`${w}px: layout is "${layout}"`, (await page.$eval('.cap-stage[data-layout]', (e) => e.dataset.layout)) === layout)
        const geo = await page.evaluate(() => {
          const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, w: b.width, h: b.height } }
          const sh = document.querySelector('.cap-shutter'); const sr = sh.getBoundingClientRect(); const hit = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2)
          const v = document.querySelector('.cap-stage__video')
          return { stage: r('.cap-stage'), hud: r('.cap-hud'), hint: r('.cap-hint'), shutter: r('.cap-shutter'), hitShutter: !!hit?.closest('.cap-shutter'), vw: v.videoWidth, vh: v.videoHeight, iw: innerWidth, ih: innerHeight, scrollH: document.documentElement.scrollHeight,
            topHit: !!document.elementFromPoint(10, 10)?.closest('.cap-stage[data-layout]'), snapshotTop: r('.cap-topbar') }
        })
        const overlap = (a, b) => a.t < b.b && b.t < a.b && a.l < b.r && b.l < a.r
        check(`${w}px: shutter is inside the viewport without scrolling`, geo.shutter.t >= 0 && geo.shutter.b <= geo.ih, `shutter ${geo.shutter.t.toFixed(0)}-${geo.shutter.b.toFixed(0)} of ${geo.ih}`)
        check(`${w}px: shutter is the element at its own centre (clickable)`, geo.hitShutter)
        check(`${w}px: hint does not overlap the shutter`, !overlap(geo.hint, geo.shutter))
        check(`${w}px: panel does not overlap the shutter or the hint`, !overlap(geo.hud, geo.shutter) && !overlap(geo.hud, geo.hint))
        if (layout === 'overlay') {
          check(`${w}px: the camera is at least 90% of the viewport width`, geo.stage.w >= 0.9 * geo.iw, `${geo.stage.w.toFixed(0)} of ${geo.iw}`)
          check(`${w}px: immersive: the camera fills the visible viewport and covers the page header`, Math.abs(geo.stage.h - geo.ih) <= 1 && geo.topHit, `${geo.stage.h.toFixed(0)} of ${geo.ih}`)
          check(`${w}px: the page behind does not scroll while the camera is open`, await page.evaluate(() => getComputedStyle(document.documentElement).overflow === 'hidden'))
          check(`${w}px: panel stays inside the camera and <= 45% of its height`, geo.hud.t >= geo.stage.t - 1 && geo.hud.h <= 0.45 * geo.stage.h + 1, `${geo.hud.h.toFixed(0)} of ${geo.stage.h.toFixed(0)}`)
          check(`${w}px: starts compact, with the chips`, (await page.$eval('.cap-hud', (e) => e.dataset.mode)) === 'compact' && (await page.$('.cap-chips')) !== null)
          await page.screenshot({ path: `${process.env.E2E_SHOTS ?? '/tmp'}/layout-${w}x${h}.png` })
          await page.click('.cap-stage__close'); await sleep(400)
          check(`${w}px: the close button leaves immersive mode and stops the camera`, (await page.$('.cap-start')) !== null && (await page.$eval('.cap-stage[data-layout]', (e) => e.dataset.immersive)) === '0' && (await page.evaluate(() => !document.querySelector('.cap-stage__video').srcObject?.active)))
        } else {
          const ar = geo.vw / geo.vh
          check(`${w}px: the stage has the camera's own aspect ratio (no black bars)`, Math.abs(geo.stage.w / geo.stage.h - ar) / ar < 0.02, `stage ${(geo.stage.w / geo.stage.h).toFixed(3)} vs camera ${ar.toFixed(3)}`)
          check(`${w}px: expanded by default`, (await page.$eval('.cap-hud', (e) => e.dataset.mode)) === 'expanded')
          check(`${w}px: no chips when expanded`, (await page.$('.cap-chips')) === null)
          if (layout === 'side') {
            check(`${w}px: the panel sits beside the preview, not over it`, geo.hud.l >= geo.stage.r - 1, `hud ${geo.hud.l.toFixed(0)} stage right ${geo.stage.r.toFixed(0)}`)
            check(`${w}px: the stage is large (>= 60% of the viewport width)`, geo.stage.w >= 0.6 * geo.iw, `${geo.stage.w.toFixed(0)} of ${geo.iw}`)
          } else {
            check(`${w}px: the panel sits under the preview`, geo.hud.t >= geo.stage.b - 1)
            check(`${w}px: the stage fills the page width (>= 90%)`, geo.stage.w >= 0.9 * geo.iw, `${geo.stage.w.toFixed(0)} of ${geo.iw}`)
          }
        }
        if (layout !== 'overlay') await page.screenshot({ path: `${process.env.E2E_SHOTS ?? '/tmp'}/layout-${w}x${h}.png` })
      } })
    }
    // the file-picker fallback keeps a sensible size, never a tiny box
    for (const [w, h] of [[390, 844], [1440, 900]]) await session('good', { width: w, height: h, fn: async (page) => {
      await page.goto(BASE, { waitUntil: 'networkidle0' }); await page.evaluate(() => { try { localStorage.clear() } catch {} })
      await page.click('.cap-link'); await sleep(400)
      const vf = await page.$eval('.cap-picker', (e) => { const b = e.getBoundingClientRect(); return { w: b.width, h: b.height } })
      check(`${w}px: the photo-picker viewfinder is not a tiny box (>= 55% of the width, ratio >= 4:3 on desktop)`, vf.w >= 0.55 * w && (w < 700 || vf.w / vf.h >= 1.3), `${vf.w.toFixed(0)}x${vf.h.toFixed(0)}`)
    } })
  },
  async segments() {
    const lit = (page, id) => page.$eval(`[data-metric=${id}] .cap-meter`, (e) => ({ n: e.querySelectorAll('.cap-meter__cell').length, lit: +e.dataset.lit, at: e.dataset.at == null ? null : +e.dataset.at, now: +e.getAttribute('aria-valuenow'), min: e.getAttribute('aria-valuemin'), max: e.getAttribute('aria-valuemax'), role: e.getAttribute('role'), cls: e.className, text: e.getAttribute('aria-valuetext') }))
    const ats = []
    for (const [stream, expect] of [['dark', 'fail'], ['dim', 'warn'], ['good', 'pass']]) await session(stream, { fn: async (page) => {
      await open(page); await sleep(2500)
      const ids = await page.$$eval('.cap-hud__row', (r) => r.map((x) => x.dataset.metric))
      const all = await Promise.all(ids.map((id) => lit(page, id)))
      check(`${stream}: every metric renders exactly 10 segments as a role=meter`, all.length === 8 && all.every((m) => m.n === 10 && m.role === 'meter' && m.min === '0' && m.max === '100'), JSON.stringify(all.map((m) => m.n)))
      check(`${stream}: the overall meter has 20 segments`, (await page.$$eval('.cap-hud > .cap-meter--20 .cap-meter__cell', (c) => c.length)) === 20)
      const b = await lit(page, 'brightness'); ats.push(b.at)
      const shown = num(await page.$eval('[data-metric=brightness] .cap-hud__value', (e) => e.innerText))
      check(`${stream}: brightness aria-valuenow matches the number shown (+-1)`, Math.abs(b.now - shown) <= 1, `${b.now} vs ${shown}`)
      check(`${stream}: brightness shows ONE lit position segment at floor(value/10)`, b.lit === 1 && b.at === Math.min(9, Math.floor(shown / 10)), `at ${b.at}, value ${shown}`)
      check(`${stream}: brightness meter is coloured ${expect}`, b.cls.includes(`cap-meter--${expect}`), b.cls)
      const f = await lit(page, 'focus')
      check(`${stream}: focus lit segments = round(aria-valuenow / 10)`, f.lit === Math.round(f.now / 10), `${f.lit} vs ${f.now}`)
      const st = await rows(page)
      const bad = await page.$$eval('.cap-hud__row', (r) => r.filter((x) => x.dataset.status !== 'pass').every((x) => x.querySelector('.cap-meter').className.includes(`cap-meter--${x.dataset.status}`)))
      check(`${stream}: every warn/fail row's meter is amber/red, never green`, bad, JSON.stringify(Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v.status]))))
    } })
    check('a dark -> dim -> good ramp moves the brightness segment monotonically to the right', ats[0] <= ats[1] && ats[1] < ats[2] && ats[0] < ats[2], ats.join(' -> '))
    await session('good', { fn: async (page) => {
      await open(page); await sleep(1500)
      const on = await page.$eval('.cap-meter__cell', (e) => getComputedStyle(e).transitionDuration)
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); await sleep(200)
      const off = await page.$eval('.cap-meter__cell', (e) => getComputedStyle(e).transitionDuration)
      check('cells fade over ~120 ms normally and not at all (under 1 ms) with prefers-reduced-motion', /0\.12s/.test(on) && parseFloat(off) < 0.001, `${on} / ${off}`)
    } })
  },
  async toggle() {
    await session('good', { width: 1440, fn: async (page) => {
      await open(page); await sleep(1500)
      check('wide: expanded by default', (await page.$eval('.cap-hud', (e) => e.dataset.mode)) === 'expanded')
      await page.click('.cap-hud__toggle'); await sleep(300)
      check('toggle collapses to compact', (await page.$eval('.cap-hud', (e) => e.dataset.mode)) === 'compact')
      await page.goto(BASE, { waitUntil: 'networkidle0' }); await page.click('.cap-start'); await page.waitForSelector('.cap-shutter')
      check('the choice survives a reload', (await page.$eval('.cap-hud', (e) => e.dataset.mode)) === 'compact')
      check('the shutter still works with the HUD on screen', await (async () => { await page.click('.cap-shutter'); try { await page.waitForSelector('.cap-result', { timeout: 30000 }); return true } catch { return false } })())
      check('the result checklist shows values like the HUD ("Focus NN%", "Brightness NN%")', await page.$$eval('.cap-check__val', (v) => v.some((x) => /^Focus \d+%$/.test(x.innerText)) && v.some((x) => /^Brightness \d+%$/.test(x.innerText))))
    } })
    // storage that throws must not break the HUD
    await session('good', { width: 1440, fn: async (page) => {
      await page.evaluateOnNewDocument(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked') } }) })
      await open(page, { clear: false }); await sleep(800)
      check('works with localStorage blocked', (await page.$('.cap-hud')) !== null)
    } })
  },
  async sharpcapture() {
    // Phase 8b/8c: a sharp capture must not be refused, a blurry one must be, and the refusal must say why in numbers.
    const sharp = Object.keys(meta).filter((k) => /^sharp\d$/.test(k))
    if (!sharp.length) console.log('   (no samples/good photos: the REAL-photo part is skipped)')
    for (const st of sharp) await session(st, { fn: async (page) => {
      await open(page, { query: '?debug=checks' }); await sleep(1500)
      await page.click('.cap-shutter'); await page.waitForSelector('.cap-result', { timeout: 30000 })
      const t = await page.$eval('[data-testid=result-title]', (e) => e.innerText)
      // since the sensor-fusion iteration the next step after a verified photo is "I've reached the site" (the submit); older builds said "Submit"
      const canSubmit = (await page.$('[data-testid=arrived-btn]')) !== null || await page.$$eval('.cap-result .cap-btn', (b) => b.some((x) => /^Submit/.test(x.innerText.trim())))
      check(`${st} (real photo, not enlarged): the capture is NOT refused and can be submitted`, !/retake/i.test(t) && canSubmit, t)
      check(`${st}: no "Why this photo can't be submitted" box`, (await page.$('.cap-why')) === null)
    } })
    await session('blurry', { fn: async (page) => {
      await open(page, { query: '?debug=checks' }); await sleep(1500)
      await page.click('.cap-shutter'); await page.waitForSelector('.cap-result', { timeout: 30000 })
      const why = await page.$eval('.cap-why', (e) => e.innerText).catch(() => '')
      // since the sensor-fusion iteration the next step after a verified photo is "I've reached the site" (the submit); older builds said "Submit"
      const canSubmit = (await page.$('[data-testid=arrived-btn]')) !== null || await page.$$eval('.cap-result .cap-btn', (b) => b.some((x) => /^Submit/.test(x.innerText.trim())))
      check('blurry capture is still refused (no Submit button)', !canSubmit)
      check('the refusal names the check and the number vs the limit ("Focus NN% — needs at least NN%")', /Focus/.test(why) && /Focus \d+% — needs at least \d+%/.test(why), why.replace(/\s+/g, ' '))
      check('the debug panel (?debug=checks) shows the numbers', (await page.$('[data-testid=checks-debug]')) !== null)
    } })
  },
  async timing() {
    await session('good', { fn: async (page) => {
      await open(page, { query: '?hud=raw', motion: [3, 0.1] }); await sleep(8000)
      const t = await page.evaluate(() => window.__liveTickMs ?? [])
      const lat = await page.evaluate(() => window.__liveTickLatency ?? [])
      const warm = t.slice(5); const warmL = lat.slice(5)
      console.log(`   UI-thread cost per tick over ${warm.length} ticks: p50 ${pctile(warm, 0.5).toFixed(1)} ms, p95 ${pctile(warm, 0.95).toFixed(1)} ms, max ${Math.max(...warm).toFixed(1)} ms`)
      console.log(`   tick latency (frame read -> numbers ready, includes the worker): p50 ${pctile(warmL, 0.5).toFixed(1)} ms, p95 ${pctile(warmL, 0.95).toFixed(1)} ms`)
      check('UI-thread p95 per tick <= 50 ms (budget)', pctile(warm, 0.95) <= 50, `${pctile(warm, 0.95).toFixed(1)} ms`)
      const at = await page.evaluate(() => window.__liveTickAt ?? []); const late = at.slice(Math.floor(at.length / 2)); const gaps = late.slice(1).map((v, i) => v - late[i])
      console.log(`   steady-state tick gaps: p50 ${pctile(gaps, 0.5).toFixed(0)} ms, p95 ${pctile(gaps, 0.95).toFixed(0)} ms (target 200); first tick at ${(at[0] - at[0]).toFixed(0)}, ${at.length} ticks total`)
      check('steady-state rate is about 5 Hz (median gap <= 260 ms)', pctile(gaps, 0.5) <= 260, `${pctile(gaps, 0.5).toFixed(0)} ms`)
      check('raw numbers are shown with ?hud=raw', (await page.$$eval('.cap-hud__raw', (e) => e.length)) === 8)
    } })
  },
  async burst() {
    let hits = 0; const runs = 6
    for (let i = 0; i < runs; i++) await session('alternating', { fn: async (page) => {
      const bursts = []; page.on('console', (m) => { if (m.text().startsWith('[burst]')) bursts.push(JSON.parse(m.text().slice(8))) })
      await open(page); await sleep(1200); await page.click('.cap-shutter'); await page.waitForSelector('.cap-result', { timeout: 30000 })
      const b = bursts[0]; if (b && b.frames[b.picked].s > 0.4) hits++
    } })
    check(`the burst still picks the sharp frame (>= 5 of ${runs})`, hits >= 5, `${hits}/${runs}`)
  },
  async netsection() {
    // E2/E6: REAL IP lookups. Needs the DB-IP files in backend/data/geoip and the isolated backend started with TRUSTED_PROXY_HEADER=x-forwarded-for
    // (run: TRUSTED_PROXY_HEADER=x-forwarded-for npm run e2e netsection). The page and the engine are real; the ADDRESSES are real public
    // addresses sent in the proxy header because a laptop cannot be on a foreign network. The classifier is trained on SIMULATED data.
    const API = process.env.E2E_API ?? 'http://127.0.0.1:8001'
    const HOME = { lat: 12.9259481, lng: 77.6722586, radius_m: 100, country: 'IN', label: 'Home (test)' }
    const put = await fetch(`${API}/sites/site_demo_1`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(HOME) })
    check('the demo house is registered in the ISOLATED database', put.ok)
    const post = async (worker, n, ip) => {
      const fd = new FormData()
      fd.set('payload', JSON.stringify({ worker_id: worker, task_id: 'net_check', site_id: 'site_demo_1', photo_quality_pass: true, network_info: { effectiveType: '4g', downlink: 10, rtt: 50 } }))
      fd.set('photo', new Blob([fs.readFileSync(new URL(`../../../edge-validator/samples/good/000${n}.png`, import.meta.url))], { type: 'image/png' }), `p${n}.png`)
      const r = await fetch(`${API}/submissions`, { method: 'POST', headers: { 'X-Forwarded-For': ip }, body: fd })
      return r.ok ? r.json() : { error: r.status }
    }
    const health = await (await fetch(`${API}/health`)).json()
    check('the backend sees the REAL DB-IP files', health.ip_database?.installed === true && health.ip_database.has_city && health.ip_database.has_asn, JSON.stringify({ date: health.ip_database?.date, age: health.ip_database?.age_days }))
    const CASES = [
      ['home', 'at home: a Bengaluru broadband address near the site', '106.51.0.1', 1, (r) => r.fusion.environment.score >= 0.9 && r.status === 'accepted'],
      ['us', 'a US address (Google, Mountain View)', '8.8.8.8', 2, (r) => r.status === 'flagged' && /US/.test(r.top_reason) && r.fusion.flags.includes('ip_country_mismatch')],
      ['vpnnl', 'a foreign VPN / hosting exit (DigitalOcean, Singapore)', '159.65.0.1', 3, (r) => r.status === 'flagged' && r.fusion.flags.includes('anonymizing_network') && r.fusion.flags.includes('ip_country_mismatch')],
      ['vpnin', 'an honest same-country VPN / cloud exit (Amazon, Mumbai)', '13.126.0.1', 1, (r) => r.status === 'accepted' && r.fusion.flags.includes('anonymizing_network') && !r.fusion.flags.includes('ip_country_mismatch')],
      ['gateway', 'a carrier gateway far away in the same country (Navi Mumbai, no ASN record)', '49.44.0.1', 2, (r) => r.status === 'accepted' && r.fusion.flags.includes('ip_region_mismatch')],
    ]
    const results = {}
    for (const [id, label, ip, n, ok] of CASES) {
      const r = await post(`net_${id}`, n, ip)
      results[id] = r
      check(`${label}: ${r.status} (P ${r.fraud_probability?.toFixed?.(2)}, environment ${r.fusion?.environment?.score}, ${(r.fusion?.flags ?? []).join(' ') || 'no flags'})`, !r.error && ok(r), r.top_reason)
    }
    check('no raw IP is in any response (only the shortened address)', JSON.stringify(results).match(/\b(106\.51\.0\.1|8\.8\.8\.8|159\.65\.0\.1|13\.126\.0\.1|49\.44\.0\.1)\b/) === null)
    check('status is the classifier\'s: every status matches P > 0.5', Object.values(results).every((r) => r.status === (r.fraud_probability > 0.5 ? 'flagged' : 'accepted')))
    for (const [w, h] of [[1280, 900], [390, 844]]) {
      await session('good', { width: w, height: h, fn: async (page) => {
        if (w < 500) await page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
        await page.goto(BASE + 'dashboard', { waitUntil: 'networkidle0' })
        await page.waitForSelector('[data-testid=dbip-credit]', { timeout: 20000 })
        check(`(${w}px) the DB-IP credit is text with a link in the footer`, await page.$eval('[data-testid=dbip-credit] a', (a) => a.href === 'https://db-ip.com/' && /DB-IP/.test(a.innerText)))
        check(`(${w}px) no "IP database not installed" chip while the database is installed`, (await page.$('[data-testid=ipdb-chip]')) === null)
        await page.addStyleTag({ content: '.topbar{position:static !important}' })
        for (const id of ['us', 'vpnin']) {
          await page.goto(BASE + 'dashboard', { waitUntil: 'networkidle0' })
          await page.evaluate((sid) => { const rows = [...document.querySelectorAll('tr, li, button, div')].filter((e) => e.innerText?.includes('net_' + sid)); (rows.find((e) => e.tagName === 'TR' || e.tagName === 'BUTTON') ?? rows[rows.length - 1])?.click() }, id)
          await openSensors(page).catch(() => {})
          await page.waitForSelector('[data-testid=fusion-section]', { timeout: 15000 }).catch(() => {})
          const t = await page.$eval('[data-testid=fusion-section]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
          check(`(${w}px) case file "${id}": the Network section names the provider, the IP data date and the site's learned visits`, /Network/i.test(t) && /DB-IP lite · data from 20\d\d-\d\d-\d\d/.test(t) && /Site network/i.test(t), t.slice(t.indexOf('Network'), t.indexOf('Network') + 220))
          check(`(${w}px) case file "${id}": the DB-IP credit link is next to the IP line`, (await page.$('[data-testid=dbip-credit-case]')) !== null)
          const el = await page.$('[data-testid=fusion-section]')
          if (el) { await el.evaluate((e) => e.scrollIntoView({ block: 'start' })); await sleep(250); await el.screenshot({ path: `${process.env.E2E_SHOTS ?? '/tmp'}/net-${id}-${w}.png` }) }
          const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
          check(`(${w}px) case file "${id}" has no sideways scroll`, ov <= 0, `overflow ${ov}px`)
          await page.keyboard.press('Escape')
        }
      } })
    }
  },
  async ipchip() {
    // E6: with NO IP database installed the top bar says so and no DB-IP credit is shown (no DB-IP data is on screen).
    // Run: GEOIP_DIR=<an empty folder> npm run e2e ipchip
    const API = process.env.E2E_API ?? 'http://127.0.0.1:8001'
    const h = await (await fetch(`${API}/health`)).json()
    if (h.ip_database?.installed) { console.log('   (skipped: this backend has the IP database installed; run it as GEOIP_DIR=<an empty folder> npm run e2e ipchip)'); return }
    check('this backend really has no IP database', h.ip_database?.installed === false, JSON.stringify(h.ip_database))
    for (const [w, ht] of [[1280, 800], [390, 844]]) {
      await session('good', { width: w, height: ht, fn: async (page) => {
        if (w < 500) await page.setViewport({ width: w, height: ht, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
        await page.goto(BASE + 'dashboard', { waitUntil: 'networkidle0' })
        await page.waitForSelector('[data-testid=ipdb-chip]', { timeout: 20000 })
        const t = await page.$eval('[data-testid=ipdb-chip]', (e) => e.innerText)
        check(`(${w}px) the top bar chip says "IP database not installed"`, /IP database not installed/.test(t), t)
        check(`(${w}px) no DB-IP credit is shown when no DB-IP data is shown`, (await page.$('[data-testid=dbip-credit]')) === null)
        const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
        check(`(${w}px) the top bar still fits`, ov <= 0, `overflow ${ov}px`)
        await page.screenshot({ path: `${process.env.E2E_SHOTS ?? '/tmp'}/ipchip-${w}.png`, clip: { x: 0, y: 0, width: w, height: w < 500 ? 220 : 90 } })
      } })
    }
  },
  // ======================================================================================================================================
  // P7: REHEARSAL against the SINGLE-ORIGIN, PUBLIC-MODE build (npm run e2e:public). Real page, real recorder, real server in PUBLIC_MODE=1 serving
  // client/dist on one address, real DB-IP lookups. Scripted: the GPS, the motion events and the forwarded address (a real public address put in
  // X-Forwarded-For, as a tunnel would): it is NOT a real VPN or a real foreign network, that is what the phone test is for. The classifier is SYNTHETIC.
  // ======================================================================================================================================
  async pub_basics() {
    const API = process.env.E2E_API, TOKEN = process.env.E2E_TOKEN
    const origin = new URL(BASE).origin
    const get = (p, h = {}) => fetch(`${origin}${p}`, { headers: h })
    const auth = { Authorization: `Bearer ${TOKEN}` }
    const h = await (await get('/api/health')).json()
    check('the server runs in PUBLIC MODE with the real IP database', h.public_mode === true && h.ip_database?.installed === true, JSON.stringify({ pm: h.public_mode, db: h.ip_database?.date }))
    check('/docs, /redoc and /openapi.json are closed', (await Promise.all(['/docs', '/redoc', '/openapi.json'].map((p) => get(p)))).every((r) => r.status === 404))
    check('the dashboard data, photos and sites need the token (401 without it, 200 with it)', (await Promise.all(['/api/submissions', '/api/sites', '/api/reviews/queue'].map((p) => get(p)))).every((r) => r.status === 401) && (await get('/api/submissions', auth)).status === 200)
    check('a wrong token is refused', (await get('/api/submissions', { Authorization: 'Bearer wrong-wrong-wrong' })).status === 401)
    const idx = await get('/')
    check('the app is served from the same origin with the security headers', idx.status === 200 && /nosniff/.test(idx.headers.get('x-content-type-options') ?? '') && /geolocation=\(self\)/.test(idx.headers.get('permissions-policy') ?? '') && idx.headers.get('cache-control') === 'no-cache', idx.headers.get('permissions-policy'))
    const mf = await get('/manifest.webmanifest')
    check('the manifest and icons are served', mf.status === 200 && (await get('/icons/icon-512.png')).headers.get('content-type') === 'image/png' && (await get('/icons/icon-maskable-512.png')).status === 200, mf.headers.get('content-type'))
    const al = await get('/.well-known/assetlinks.json')
    check('assetlinks.json is served as JSON (still the placeholder until N3)', al.status === 200 && /json/.test(al.headers.get('content-type') ?? ''))
    check('a missing file is a 404, not a page of HTML', (await get('/assets/nope.js')).status === 404 && (await get('/api/nope')).status === 404)
    await session('good', { width: 1280, height: 860, fn: async (page) => {
      const urls = []
      page.on('request', (r) => urls.push(r.url()))
      await page.goto(BASE, { waitUntil: 'networkidle0' })
      check('the Capture page loads from the single origin', /Trust Layer/.test(await page.title()) && (await page.$('.cap-start, .cap-shutter, [data-testid=visit-panel]')) !== null)
      await page.goto(BASE + 'dashboard', { waitUntil: 'networkidle0' }) // a hard load of a client route
      check('a hard refresh on /dashboard works and, without the token, asks for it', (await page.$('input[name=token]')) !== null)
      await page.type('input[name=token]', TOKEN); await page.keyboard.press('Enter')
      await page.waitForFunction(() => !document.querySelector('input[name=token]'), { timeout: 15000 })
      check('with the token the dashboard loads its data', (await page.$('[data-testid=review-queue]')) !== null)
      await page.reload({ waitUntil: 'networkidle0' })
      check('refreshing the dashboard keeps working with the token (same tab)', (await page.$('input[name=token]')) === null)
      await page.evaluate(() => sessionStorage.clear()); await page.reload({ waitUntil: 'networkidle0' })
      check('and asks again once the token is gone', (await page.$('input[name=token]')) !== null)
      const foreign = urls.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'))
      check('NO third-party request was made by the page or the dashboard', foreign.length === 0, foreign.slice(0, 3).join(' '))
    } })
  },
  async pub_cases() {
    const API = process.env.E2E_API, TOKEN = process.env.E2E_TOKEN
    const A = { Authorization: `Bearer ${TOKEN}` }
    const jget = async (p) => (await fetch(`${API}${p}`, { headers: A })).json()
    const lastSub = async () => { const l = await jget('/submissions'); return jget(`/submissions/${l[0].id}`) }
    const REAL = { home: '106.51.0.1', us: '8.8.8.8', vpn_sg: '159.65.0.1', vpn_in: '13.126.0.1', gateway: '49.44.0.1' }
    // one visit through the REAL page: kind 'walk' (a genuine 65 s approach), 'short' (photo after a few seconds), 'teleport' (the headline spoof)
    const flow = async (ip, kind) => {
      let sub
      await session('good', { width: 1280, height: 860, fn: async (page) => {
        if (ip) await page.setExtraHTTPHeaders({ 'X-Forwarded-For': ip })
        await fusionPage(page, { start: kind === 'teleport' ? at(-14000, 0) : at(-60, 0) })
        await page.waitForSelector('[data-testid=visit-panel] .cap-visit__live', { timeout: 20000 })
        if (kind === 'walk') {
          await motionKind(page, 'walk'); await walkTo(page, [-60, 0], [-30, 0], 20); await walkTo(page, [-30, 0], [0, 0], 20)
          await motionKind(page, 'still'); await stay(page, [0, 0], 25)
        } else if (kind === 'teleport') {
          await motionKind(page, 'still'); await stay(page, [-14000, 0], 32); await stay(page, [0, 0], 32)
        } else { await motionKind(page, 'still'); await sleep(3000) }
        await submitThroughTheUi(page)
        sub = await lastSub()
      } })
      return sub
    }
    const flags = (s) => s.fusion?.flags ?? s.quality_flags ?? []
    const line = (s) => `${s.status} P ${s.fraud_probability?.toFixed(2)} env ${s.fusion?.environment?.score} [${flags(s).filter((f) => !/^fusion_insufficient/.test(f)).join(' ')}] "${s.top_reason}"`
    const results = {}

    console.log('   1. NO site registered yet (the case file must say so; unknown is never flagged)')
    const s0 = await flow(REAL.home, 'short')
    results.unregistered = s0
    check('unregistered site: accepted, never flagged for what could not be compared', s0.status === 'accepted', line(s0))
    check('unregistered site: the case file says "no site registered for this task"', (s0.fusion?.notes ?? []).some((n) => /No site is registered for this task/.test(n)) && s0.fusion?.site === null)
    const put = await fetch(`${API}/sites/site_demo_1`, { method: 'PUT', headers: { ...A, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...SITE, radius_m: 60, country: 'IN', label: 'rehearsal site (isolated DB)' }) })
    check('the rehearsal site is registered through the API with the token (country IN)', put.ok)

    console.log('   2. unknown: a private address (no forwarded header) with a genuine walk')
    const s1 = await flow(null, 'walk'); results.unknown = s1
    check('unknown network + genuine walk: accepted, environment unknown, no network flag', s1.status === 'accepted' && s1.env_known === false && !flags(s1).some((f) => /ip_|anonymizing/.test(f)), line(s1))

    console.log('   3. genuine at the site on a REAL Bengaluru broadband address (near)')
    const s2 = await flow(REAL.home, 'walk'); results.near = s2
    check('near-site genuine: accepted with environment >= 0.9 (env known) and no flags', s2.status === 'accepted' && s2.env_known === true && s2.fusion.environment.score >= 0.9 && flags(s2).filter((f) => !/^fusion_/.test(f)).length === 0, line(s2))

    console.log('   4. foreign country (a real US address) with a genuine walk')
    const s3 = await flow(REAL.us, 'walk'); results.us = s3
    check('foreign country: FLAGGED, the sentence names both countries, and only the classifier decided', s3.status === 'flagged' && /US/.test(s3.top_reason) && /IN/.test(s3.top_reason) && flags(s3).includes('ip_country_mismatch') && s3.status === (s3.fraud_probability > 0.5 ? 'flagged' : 'accepted'), line(s3))

    console.log('   5. foreign VPN / hosting exit (a real DigitalOcean Singapore address) with a genuine walk')
    const s4 = await flow(REAL.vpn_sg, 'walk'); results.vpn = s4
    check('foreign VPN exit: FLAGGED with the country sentence and the hosting flag', s4.status === 'flagged' && flags(s4).includes('anonymizing_network') && flags(s4).includes('ip_country_mismatch') && /SG/.test(s4.top_reason), line(s4))

    console.log('   6. honest VPN that exits in the SAME country (a real Amazon Mumbai address)')
    const s5 = await flow(REAL.vpn_in, 'walk'); results.vpn_in = s5
    check('honest same-country VPN: NOT flagged by the VPN alone', s5.status === 'accepted' && flags(s5).includes('anonymizing_network') && !flags(s5).includes('ip_country_mismatch'), line(s5))

    console.log('   7. carrier gateway far away in the same country (a real Navi Mumbai address, no ASN record)')
    const s6 = await flow(REAL.gateway, 'walk'); results.gateway = s6
    check('carrier gateway far: NOT flagged (weak sign only)', s6.status === 'accepted' && flags(s6).includes('ip_region_mismatch'), line(s6))

    console.log('   8. the headline spoof: the GPS jumps onto the site while the phone never moves (private address)')
    const s7 = await flow(null, 'teleport'); results.teleport = s7
    check('GPS teleport with flat motion: flagged by the MOTION signal', s7.status === 'flagged' && flags(s7).includes('gps_jump_flat_motion') && s7.motion_score < 0.4, line(s7))

    check('no raw IP appears in any stored report or response', !JSON.stringify(results).match(/\b(106\.51\.0\.1|8\.8\.8\.8|159\.65\.0\.1|13\.126\.0\.1|49\.44\.0\.1)\b/))
    console.log('\n   REHEARSAL RESULTS (REAL page + REAL DB-IP lookups; SYNTHETIC classifier; addresses forwarded, not a real VPN):')
    for (const [k, s] of Object.entries(results)) console.log(`     ${k.padEnd(12)} ${line(s)}`)
    fs.writeFileSync(`${process.env.E2E_SHOTS ?? '/tmp'}/pub-results.json`, JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, s]) => [k, { status: s.status, p: s.fraud_probability, env: s.fusion?.environment?.score, env_known: s.env_known, motion: s.motion_score, flags: flags(s), reason: s.top_reason }])), null, 1))
  },
  async pub_screens() {
    // Screenshots of the capture flow and the case file at desktop and phone widths, from the SAME single-origin public build.
    const API = process.env.E2E_API, TOKEN = process.env.E2E_TOKEN
    const l = await (await fetch(`${API}/submissions`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
    check('there are rehearsal submissions to look at', l.length >= 2, String(l.length))
    for (const [w, h] of [[1280, 860], [390, 844]]) {
      await session('good', { width: w, height: h, fn: async (page) => {
        if (w < 500) await page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
        await page.evaluateOnNewDocument((t) => { try { sessionStorage.setItem('tl.dashboard.token', t); localStorage.setItem('fusion.consent.v1', '1') } catch {} }, TOKEN)
        await page.goto(BASE, { waitUntil: 'networkidle0' }); await sleep(800)
        await shot(page, `pub-capture-${w}`)
        const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
        check(`(${w}px) the capture page has no sideways scroll`, ov <= 0, `overflow ${ov}px`)
        await page.goto(BASE + 'dashboard', { waitUntil: 'networkidle0' }); await page.waitForSelector('[data-testid=subs-table] tbody tr', { timeout: 20000 })
        await page.addStyleTag({ content: '.topbar{position:static !important}' })
        for (const [i, name] of [[0, 'teleport'], [4, 'us']]) {
          await page.goto(BASE + 'dashboard', { waitUntil: 'networkidle0' }); await page.waitForSelector('[data-testid=subs-table] tbody tr', { timeout: 20000 })
          await page.evaluate((n) => document.querySelectorAll('[data-testid=subs-table] tbody tr')[n]?.click(), i)
          await openSensors(page).catch(() => {})
          await page.waitForSelector('[data-testid=fusion-section]', { timeout: 15000 }).catch(() => {})
          const el = await page.$('[data-testid=fusion-section]')
          if (el) { await el.evaluate((e) => e.scrollIntoView({ block: 'start' })); await sleep(300); await el.screenshot({ path: `${process.env.E2E_SHOTS ?? '/tmp'}/pub-case-${name}-${w}.png` }) }
          check(`(${w}px) the ${name} case file opens with its Sensor fusion section`, el !== null)
        }
      } })
    }
  },
  async sitepanel() {
    // E4: the dashboard's "Site location" panel against the REAL isolated backend. HOME is the demo house (the values the user gave);
    // VENUE is a TEST value for the isolated database only (nothing here touches the user's real database or port 8000).
    const API = process.env.E2E_API ?? 'http://127.0.0.1:8001'
    const HOME = { lat: 12.9259481, lng: 77.6722586, radius_m: 100, country: 'IN', label: 'Home (test)' }
    const VENUE = { latitude: 13.0827, longitude: 80.2707 }
    const photo = async (n) => new Blob([fs.readFileSync(new URL(`../../../edge-validator/samples/good/000${n}.png`, import.meta.url))], { type: 'image/png' })
    const post = async (worker, n) => {
      const fd = new FormData()
      fd.set('payload', JSON.stringify({ worker_id: worker, task_id: 'site_check', site_id: 'site_demo_1', photo_quality_pass: true, network_info: { effectiveType: '4g', downlink: 10, rtt: 50 } }))
      fd.set('photo', await photo(n), `p${n}.png`)
      const r = await fetch(`${API}/submissions`, { method: 'POST', body: fd })
      return r.ok ? r.json() : { error: r.status + ' ' + (await r.text()).slice(0, 120) }
    }
    // A visit whose movement is VERIFIED: a server visit session plus a recorded walk (GPS fixes + walking-rhythm windows) that ends at the house.
    const trusted = async (worker, n) => {
      const v = await (await fetch(`${API}/visits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worker_id: worker, task_id: 'site_check', site_id: 'site_demo_1' }) })).json()
      const t0 = Date.now() - 115000
      const DEG = 111320
      const fixes = []; const wins = []
      for (let i = 0; i <= 21; i++) {
        const f = i / 21
        const e = -150 * (1 - f) + (Math.random() - 0.5) * 4
        fixes.push({ t: t0 + i * 5000, lat: HOME.lat + (Math.random() - 0.5) * 3e-5, lng: HOME.lng + e / (DEG * Math.cos(HOME.lat * Math.PI / 180)), acc: 8, speed: null, heading: null, alt: null })
        if (i < 21) wins.push({ t0: t0 + i * 5000, t1: t0 + (i + 1) * 5000, n: 250, hz: 50, acc_rms: 1.8, acc_peak: 4.5, gyro_rms: 40, cad_hz: 1.9, cad_pw: 0.7 })
      }
      const trail = { v: 1, fixes, windows: wins, sensors: { geo: 'granted', motion: 'granted' }, env: { tz_offset_min: 330 }, started_at: t0, ended_at: t0 + 105000, time_origin: null }
      const fd = new FormData()
      fd.set('payload', JSON.stringify({ worker_id: worker, task_id: 'site_check', site_id: 'site_demo_1', visit_id: v.visit_id, trail, photo_quality_pass: true, network_info: { effectiveType: '4g', downlink: 10, rtt: 50 } }))
      fd.set('photo', await photo(n), `t${n}.png`)
      const r = await fetch(`${API}/submissions`, { method: 'POST', body: fd })
      return r.ok ? r.json() : { error: r.status + ' ' + (await r.text()).slice(0, 160) }
    }
    const typeInto = async (page, id, v) => { const sel = `[data-testid=${id}]`; await page.focus(sel); await page.$eval(sel, (e) => e.select()); await page.keyboard.press('Backspace'); if (v !== '') await page.type(sel, String(v)) }
    const txt = (page, id) => page.$eval(`[data-testid=${id}]`, (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => null)
    const val = (page, id) => page.$eval(`[data-testid=${id}]`, (e) => e.value)
    const panelShot = async (page, name) => { await page.addStyleTag({ content: '.topbar{position:static !important}' }); const el = await page.$('[data-testid=site-location-panel]'); await el.evaluate((e) => e.scrollIntoView({ block: 'start' })); await sleep(300); await el.screenshot({ path: `${process.env.E2E_SHOTS ?? '/tmp'}/${name}.png` }) }
    const logRows = (page) => page.$$eval('[data-testid=log-row]', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')))

    let before = await fetch(`${API}/sites/site_demo_1`)
    const created = before.status === 404
    if (!created) {
      // In a full run earlier scenarios have registered the site and taught its network. Start from a known different state (isolated DB only).
      await fetch(`${API}/sites/site_demo_1`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: 12.9, lng: 77.6, radius_m: 80, country: 'IN', label: 'earlier scenario' }) })
      await fetch(`${API}/sites/site_demo_1/reset-fingerprint`, { method: 'POST' })
    }
    console.log(`   starting state: ${created ? 'no site registered (create path)' : 'a site already exists (edit path)'}`)

    await session('good', { width: 1280, height: 900, fn: async (page) => {
      await page.browserContext().overridePermissions(new URL(BASE).origin, ['geolocation'])
      await page.setGeolocation({ ...VENUE, accuracy: 80 })
      await page.goto(BASE + 'dashboard?view=settings', { waitUntil: 'networkidle0' })
      await page.waitForSelector('[data-testid=site-location-panel]', { timeout: 20000 })
      await page.waitForFunction(() => !/Loading/.test(document.querySelector('[data-testid=site-location-panel]').innerText), { timeout: 15000 })
      check('the Site location panel is on the dashboard and names the site', /site_demo_1/i.test(await txt(page, 'site-location-panel')))

      console.log('   1. register the house')
      if (created) {
        check('with no site, the panel says so and offers to create it', /No site is registered/.test((await txt(page, 'site-none')) ?? ''))
        check('a new site has no "forget the learned network" tick (nothing learned yet)', (await page.$('[data-testid=f-reset]')) === null)
        check('Review is disabled until the form is valid', await page.$eval('[data-testid=review]', (b) => b.disabled))
      }
      await typeInto(page, 'f-lat', HOME.lat); await typeInto(page, 'f-lng', HOME.lng); await typeInto(page, 'f-radius', HOME.radius_m); await typeInto(page, 'f-country', HOME.country); await typeInto(page, 'f-label', HOME.label)
      await typeInto(page, 'f-radius', '4')
      check('a radius of 4 m is refused in words before anything is sent', /Radius must be between 5 and 5000/.test((await txt(page, 'validation')) ?? '') && await page.$eval('[data-testid=review]', (b) => b.disabled))
      await typeInto(page, 'f-radius', HOME.radius_m)
      check('valid values enable Review', await page.$eval('[data-testid=review]', (b) => !b.disabled),
        JSON.stringify({ v: await txt(page, 'validation'), lat: await val(page, 'f-lat'), lng: await val(page, 'f-lng'), r: await val(page, 'f-radius'), c: await val(page, 'f-country') }))
      await page.click('[data-testid=review]'); await page.waitForSelector('[data-testid=confirm]')
      const c1 = await txt(page, 'confirm')
      check('the confirm step shows old and new values', /12\.925948/.test(c1) && /77\.672259/.test(c1) && /Home \(test\)/.test(c1), c1.slice(0, 120))
      await panelShot(page, 'site-panel-confirm-desktop')
      await page.click('[data-testid=confirm-save]')
      // done = the confirm step is gone again (the panel reloads after the save); an existing site already shows its log and current values
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=log-row]').length >= 1 && document.querySelector('[data-testid=site-current]') && !document.querySelector('[data-testid=confirm]'), { timeout: 15000 })
      const s1 = await (await fetch(`${API}/sites/site_demo_1`)).json()
      check('saving stores exactly the typed values (the API says so)', s1.lat === HOME.lat && s1.lng === HOME.lng && s1.radius_m === 100 && s1.country === 'IN' && s1.label === 'Home (test)', JSON.stringify(s1))
      check('the change log has a line for it', (await logRows(page)).length >= 1 && /Registered|moved|radius|label/.test((await logRows(page))[0]), (await logRows(page))[0])
      await panelShot(page, 'site-panel-saved-desktop')

      console.log('   2. sensor-less visits teach nothing (E5); three verified visits teach the network, and the panel shows exactly what was stored')
      for (const [w, n] of [['ns1', 1], ['ns2', 2]]) { const r = await post(w, n); check(`sensor-less visit ${w} is accepted`, r.status === 'accepted', r.error ?? `${r.status}`) }
      await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('[data-testid=learned]')
      check('after sensor-less visits the panel says nothing is learned yet', /Nothing learned yet/.test(await txt(page, 'learned-headline')), await txt(page, 'learned-headline'))
      for (const [w, n] of [['sp1', 1], ['sp2', 2], ['sp3', 3]]) { const r = await trusted(w, n); check(`verified visit ${w} accepted, movement verified (motion ${r.motion_score})`, r.status === 'accepted' && r.motion_score >= 0.8 && r.fusion?.motion?.sensor_used === true, r.error ?? `${r.status} p=${r.fraud_probability?.toFixed?.(2)}`) }
      await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('[data-testid=learned-table]', { timeout: 15000 })
      check('the panel says the network is learned from 3 accepted visits', (await txt(page, 'learned-headline')) === 'Learned from 3 accepted visits.', await txt(page, 'learned-headline'))
      const lt = await txt(page, 'learned-table')
      check('the table lists the stored speed class with its visit count and no IP address', /Network speed class 4g\|\d\|<\d+ 4g, about [\d-]+ Mbps, round trip under \d+ ms 3 /.test(lt) && !/\d+\.\d+\.\d+\.\d+/.test(lt), lt.slice(0, 160))
      const prof = await (await fetch(`${API}/sites/site_demo_1/profile`)).json()
      check('what the panel shows is what the API stores', prof.visits === 3 && prof.known === true && Object.values(prof.kinds).flat().every((r) => r.count === 3), JSON.stringify(prof.kinds))
      await panelShot(page, 'site-panel-learned-desktop')
      await page.click('[data-testid=forget-now]'); await page.waitForSelector('[data-testid=forget-confirm]')
      check('"Forget the learned network" asks first and says how many rows go', /forgets all \d+ rows/.test(await txt(page, 'forget-confirm')), await txt(page, 'forget-confirm'))
      await page.click('[data-testid=forget-yes]')
      await page.waitForFunction(() => /Nothing learned yet/.test(document.querySelector('[data-testid=learned-headline]')?.innerText ?? ''), { timeout: 15000 })
      check('forgetting empties the stored fingerprint (the API agrees)', (await (await fetch(`${API}/sites/site_demo_1/profile`)).json()).rows === 0)
      for (const [w, n] of [['sp4', 1], ['sp5', 2], ['sp6', 3]]) await trusted(w, n) // teach it again so the move below has something to forget
      const old = await post('sp7', 1)
      check('a submission records the site it was scored with', old.fusion?.site?.lat === HOME.lat && old.fusion.site.radius_m === 100, JSON.stringify(old.fusion?.site))

      console.log('   3. move to the venue: use my current location (poor fix, then good fix)')
      await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('[data-testid=site-current]')
      await page.setGeolocation({ ...VENUE, accuracy: 80 })
      await page.click('[data-testid=use-location]')
      await page.waitForFunction(() => document.querySelector('[data-testid=fix-note]'), { timeout: 20000 })
      const note = await txt(page, 'fix-note')
      check('a fix worse than 50 m warns with the number', /±80 m/.test(note) && /worse than 50 m/.test(note), note)
      check('the fix fills latitude and longitude', (await val(page, 'f-lat')) === '13.082700' && (await val(page, 'f-lng')) === '80.270700')
      const mv = await txt(page, 'move-line')
      check('the distance sanity line says how far the site moves', /^This moves the site 2\d\d km\.$/.test(mv), mv)
      check('"Forget the learned network" is ticked by default for a move over 1 km', await page.$eval('[data-testid=f-reset]', (c) => c.checked))
      await page.setGeolocation({ ...VENUE, accuracy: 12 })
      await page.click('[data-testid=use-location]'); await sleep(900)
      check('a good fix (±12 m) is confirmed without a warning', /±12 m/.test(await txt(page, 'fix-note')) && !/worse/.test(await txt(page, 'fix-note')))
      await typeInto(page, 'f-label', 'Hackathon venue (test)'); await typeInto(page, 'f-radius', 120)
      await page.click('[data-testid=f-reset]'); await page.click('[data-testid=f-reset]')
      check('the tick can be toggled by the person and then stays as chosen', await page.$eval('[data-testid=f-reset]', (c) => c.checked))
      await page.click('[data-testid=review]'); await page.waitForSelector('[data-testid=confirm]')
      const c2 = await txt(page, 'confirm')
      check('the confirm step shows old to new, the distance and what happens to the learned network', /12\.925948/.test(c2) && /13\.082700/.test(c2) && /Hackathon venue/.test(c2) && /moves the site 2\d\d km/.test(c2) && /will be forgotten/.test(c2), c2.slice(0, 200))
      await panelShot(page, 'site-panel-move-confirm-desktop')

      console.log('   4. a backend refusal is shown in its own words and nothing is saved')
      await page.evaluate(() => { const f = window.fetch; window.__f = f; window.fetch = async (u, o) => (o?.method === 'PUT' ? new Response(JSON.stringify({ detail: 'radius_m must be between 5 and 5000' }), { status: 422, headers: { 'Content-Type': 'application/json' } }) : f(u, o)) })
      await page.click('[data-testid=confirm-save]'); await page.waitForSelector('[data-testid=save-error]', { timeout: 10000 })
      check('the backend message is shown', (await txt(page, 'save-error')) === 'radius_m must be between 5 and 5000', await txt(page, 'save-error'))
      check('and the stored site is unchanged', (await (await fetch(`${API}/sites/site_demo_1`)).json()).lat === HOME.lat)
      await page.evaluate(() => { window.fetch = window.__f })

      console.log('   5. confirm the move')
      await page.click('[data-testid=review]'); await page.waitForSelector('[data-testid=confirm]')
      await page.click('[data-testid=confirm-save]')
      await page.waitForFunction((n) => document.querySelectorAll('[data-testid=log-row]').length >= n, { timeout: 15000 }, 2)
      const s2 = await (await fetch(`${API}/sites/site_demo_1`)).json()
      check('the site is now at the venue', s2.lat === 13.0827 && s2.lng === 80.2707 && s2.radius_m === 120 && s2.label === 'Hackathon venue (test)', JSON.stringify(s2))
      const ch = await (await fetch(`${API}/sites/site_demo_1/changes`)).json()
      check('the change log records old to new, the distance and that the learned network was forgotten (rows > 0)', ch[0].old?.lat === HOME.lat && ch[0].new.lat === 13.0827 && ch[0].moved_m > 280000 && ch[0].network_reset === true && ch[0].profile_rows_cleared > 0, JSON.stringify({ moved: ch[0].moved_m, reset: ch[0].network_reset, rows: ch[0].profile_rows_cleared }))
      const rowsNow = await logRows(page)
      check('the panel lists it, newest first', /moved 2\d\d km/.test(rowsNow[0]) && /forgotten/.test(rowsNow[0]), rowsNow[0])
      await panelShot(page, 'site-panel-moved-desktop')

      console.log('   6. old submissions keep the place they were scored at')
      const oldNow = await (await fetch(`${API}/submissions/${old.id}`)).json()
      check('the earlier submission still says it was scored at the house', oldNow.fusion.site.lat === HOME.lat && oldNow.fusion.site.radius_m === 100)
      const fresh = await post('sp9', 3)
      check('a new submission is scored at the venue', fresh.fusion?.site?.lat === 13.0827 && fresh.fusion.site.radius_m === 120, JSON.stringify(fresh.fusion?.site))
    } })

    console.log('   7. the same panel on a phone-sized screen')
    await session('good', { width: 390, height: 844, fn: async (page) => {
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
      await page.goto(BASE + 'dashboard?view=settings', { waitUntil: 'networkidle0' })
      await page.waitForSelector('[data-testid=site-current]', { timeout: 20000 })
      const m = await page.evaluate(() => {
        const root = document.querySelector('[data-testid=site-location-panel]')
        const boxes = [...root.querySelectorAll('input:not([type=checkbox]), button')].map((e) => ({ tag: e.tagName, h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width), fs: parseFloat(getComputedStyle(e).fontSize), t: (e.getAttribute('aria-label') ?? e.innerText).slice(0, 24) }))
        return { overflow: document.documentElement.scrollWidth - innerWidth, panelW: Math.round(root.getBoundingClientRect().width), boxes }
      })
      check('no sideways scrolling at 390 px', m.overflow <= 0, `overflow ${m.overflow}px`)
      check('inputs are 44 px tall and 16 px text (no zoom on focus)', m.boxes.filter((b) => b.tag === 'INPUT').every((b) => b.h >= 44 && b.fs >= 16), JSON.stringify(m.boxes.filter((b) => b.tag === 'INPUT').map((b) => [b.h, b.fs])))
      check('buttons are at least 34 px tall', m.boxes.filter((b) => b.tag === 'BUTTON').every((b) => b.h >= 34), JSON.stringify(m.boxes.filter((b) => b.tag === 'BUTTON').map((b) => [b.t, b.h])))
      await panelShot(page, 'site-panel-edit-phone')
      check('with every field equal to the saved site there is nothing to review', await page.$eval('[data-testid=review]', (b) => b.disabled))
      await typeInto(page, 'f-radius', '130')
      check('changing only the radius is a real change and enables Review', await page.$eval('[data-testid=review]', (b) => !b.disabled))
      // a person scrolls the button into view before tapping it; the fixed bottom tab bar must not sit on top of it once there
      await page.$eval('[data-testid=review]', (b) => b.scrollIntoView({ block: 'center' }))
      await page.click('[data-testid=review]'); await page.waitForSelector('[data-testid=confirm]')
      const o2 = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      check('the confirm step also fits the phone', o2 <= 0, `overflow ${o2}px`)
      await panelShot(page, 'site-panel-confirm-phone')
    } })
  },
}
// `npm run e2e a,b` runs several scenarios in one database, in file order
for (const [name, fn] of Object.entries(scenarios)) { if (!only && name.startsWith('pub_')) continue; /* the public-mode rehearsal needs its own runner: npm run e2e:public */ if (only && !only.split(',').includes(name) && !(only === 'fusion' && name.startsWith('fusion_') && name !== 'fusion_demo') && !(only === 'pub' && name.startsWith('pub_'))) continue; console.log(`\n=== ${name}`); await fn() }
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
