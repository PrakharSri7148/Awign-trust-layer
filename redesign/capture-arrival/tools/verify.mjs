// node tools/verify.mjs   (the redesign server must run:  cd redesign && PORT=5181 node serve.mjs)
// 1. loads every frozen preset at 1280 / 820 / 390 (dark) and records which inventory ids (data-inv) are in the DOM,
// 2. checks no horizontal overflow, no page errors, phone touch targets >= 44px, in both themes at 390,
// 3. measures text contrast on the REAL rendered backgrounds (tinted tiles, pills, notice) in both themes (WCAG AA 4.5:1),
// 4. runs the timed flows: the 3-second sequence, independent tiles, the 0.5 s pause, the AI scan move, the error path.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.resolve(here, '../../../client/package.json'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.CAP_BASE ?? 'http://localhost:5181/capture-arrival/app.html'
const root = path.resolve(here, '..')
const load = (f) => new Function('window', fs.readFileSync(path.join(root, f), 'utf8') + '; return window')({})
const COVER = load('js/arrival-coverage-data.js').CAP_ARR_COVERAGE
const ADDS = load('js/arrival-coverage-data.js').CAP_ARR_ADDITIONS
const SIZES = [[1280, 900, 'desktop'], [820, 1100, 'tablet'], [390, 844, 'phone']]
const problems = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const found = Object.fromEntries([...COVER, ...ADDS].map((c) => [c[0], new Set()]))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
page.on('pageerror', (e) => problems.push(`PAGE ERROR ${e.message}`))
await page.goto(BASE, { waitUntil: 'load' })
const presets = await page.evaluate(() => window.__arr.A.presets.map((p) => ({ id: p.id, play: p.play || null })))
const frozen = presets.filter((p) => !p.play).map((p) => p.id)
const allIds = presets.map((p) => p.id)
console.log(`${frozen.length} frozen presets x ${SIZES.length} widths (+ ${allIds.length - frozen.length} play presets in the flows)`)

for (const theme of ['dark', 'light']) {
  for (const [w, h, label] of SIZES) {
    if (theme === 'light' && w !== 390) continue
    await page.setViewport({ width: w, height: h, isMobile: w <= 720, hasTouch: w <= 720 })
    for (const id of frozen) {
      await page.goto(`${BASE}?state=${id}&theme=${theme}`, { waitUntil: 'load' })
      const r = await page.evaluate((w) => {
        const out = { inv: [], overflow: document.documentElement.scrollWidth - innerWidth, small: [], clip: [] }
        document.querySelectorAll('[data-inv]').forEach((e) => e.dataset.inv.split(' ').forEach((i) => out.inv.push(i)))
        if (w <= 720) document.querySelectorAll('.cap button, .cap a[href], .cap input, .cap select').forEach((e) => {
          const b = e.getBoundingClientRect(); const cs = getComputedStyle(e)
          if (!b.width || cs.visibility === 'hidden' || cs.display === 'none') return
          if (e.matches('.cap-skip-link, .cap-link, .cap-nav__tab')) return
          if (b.height < 43.5 || b.width < 43.5) out.small.push(`${e.className.toString().slice(0, 40)} ${Math.round(b.width)}x${Math.round(b.height)}`)
        })
        document.querySelectorAll('.cap-sensor, .cap-card').forEach((e) => { if (e.scrollWidth - e.clientWidth > 1) out.clip.push(e.className.toString().slice(0, 30)) })
        return out
      }, w)
      if (theme === 'dark') r.inv.forEach((i) => found[i]?.add(id))
      if (r.overflow > 1) problems.push(`${theme} ${label} ${id}: horizontal overflow ${r.overflow}px`)
      if (r.small.length) problems.push(`${theme} ${label} ${id}: touch targets < 44px: ${[...new Set(r.small)].slice(0, 4).join(' | ')}`)
      if (r.clip.length) problems.push(`${theme} ${label} ${id}: content wider than its box: ${[...new Set(r.clip)].join(', ')}`)
    }
  }
}

/* ---- contrast on the real rendered backgrounds ---- */
const contrast = []
const SEL = '.cap-arr__lead, .cap-eyebrow, .cap-card__title, .cap-progress__count, .cap-sensor__title, .cap-sensor__value, .cap-sensor .cap-pill, .cap-progress .cap-pill, .cap-notice, .cap-notice li, .cap-legend span, .cap-ring__num, .cap-stubnote'
for (const theme of ['dark', 'light']) {
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  for (const id of ['wait', 'acq-all', 'mid', 'done', 'na-all', 'net-slow']) {
    await page.goto(`${BASE}?state=${id}&theme=${theme}`, { waitUntil: 'load' })
    const rows = await page.evaluate((SEL) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true })
      const rgba = (s) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
      // canvas premultiplies an alpha colour over transparent: read it via a white and a black backdrop to recover rgb + alpha
      const parse = (s) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillRect(0, 0, 1, 1); cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const k = cx.getImageData(0, 0, 1, 1).data; cx.fillStyle = '#fff'; cx.fillRect(0, 0, 1, 1); cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const wv = cx.getImageData(0, 0, 1, 1).data; const a = 1 - ((wv[0] - k[0]) / 255 + (wv[1] - k[1]) / 255 + (wv[2] - k[2]) / 255) / 3; const A = Math.max(0.0001, Math.min(1, a)); return [k[0] / A, k[1] / A, k[2] / A, A] }
      const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); return [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a) }
      const bgOf = (el) => { let c = [0, 0, 0, 0]; const chain = []; for (let e = el; e; e = e.parentElement) chain.push(e); for (const e of chain) { const b = parse(getComputedStyle(e).backgroundColor); if (b[3] > 0) c = over(c, b); if (c[3] >= 0.999) break } return c }
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
      const out = []
      document.querySelectorAll(SEL).forEach((el) => {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (!own) return
        const fg = parse(getComputedStyle(el).color), bg = bgOf(el); if (bg[3] < 0.99) return
        const f = over(fg, bg), l1 = lum(f), l2 = lum(bg), r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
        out.push({ t: el.textContent.trim().slice(0, 28), cls: el.className.toString().slice(0, 28), r: +r.toFixed(2) })
      })
      return out
    }, SEL)
    for (const x of rows) { contrast.push({ theme, id, ...x }); if (x.r < 4.5) problems.push(`contrast ${theme} ${id}: "${x.t}" (${x.cls}) ${x.r} < 4.5`) }
  }
}
const minC = contrast.length ? Math.min(...contrast.map((c) => c.r)) : null

/* ---- timed flows ---- */
const flows = []
async function flow(name, fn) { try { await fn(); flows.push([name, 'ok']) } catch (e) { flows.push([name, 'FAIL ' + e.message]); problems.push(`flow ${name}: ${e.message}`) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const states = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-tile]')].map((e) => [e.dataset.tile, e.dataset.st])))
const cur = () => page.evaluate(() => document.querySelector('.cap-stepper__item--active .cap-stepper__label')?.textContent)
await page.setViewport({ width: 1280, height: 900 })
await flow('play-ok: Waiting -> Acquiring -> tiles resolve independently -> pause -> AI scan', async () => {
  await page.goto(`${BASE}?state=play-ok`, { waitUntil: 'load' }); await sleep(60)
  const s0 = await states(); must(Object.values(s0).every((v) => v === 'wait'), 'starts Waiting ' + JSON.stringify(s0))
  await sleep(500); const s1 = await states(); must(s1.motion === 'acq' && s1.gps === 'acq' && s1.net === 'ok', 'at 0.5 s: motion+gps acquiring, network already locked ' + JSON.stringify(s1))
  await sleep(1300); const s2 = await states(); must(s2.gps === 'ok' && s2.motion === 'acq', 'at 1.8 s: GPS locked while Motion still acquiring ' + JSON.stringify(s2))
  const ring = await page.$eval('[data-bind="ring-num"]', (e) => parseFloat(e.textContent)); must(ring > 0.5 && ring < 2.2, 'ring counting down, now ' + ring)
  const w1 = await page.$eval('[data-wave]', (e) => e.getAttribute('d')); await sleep(300); const w2 = await page.$eval('[data-wave]', (e) => e.getAttribute('d')); must(w1 !== w2, 'waveform moves')
  must(await page.$eval('.cap-progress__count', (e) => e.textContent.startsWith('3 of 4')), '3 of 4 readings done at 1.8 s')
  await sleep(1400); const s3 = await states(); must(Object.values(s3).every((v) => v === 'ok'), 'all locked at ~3.4 s ' + JSON.stringify(s3))
  must(await page.$('.cap-progress .cap-pill--info'), '"Continuing…" pill visible'); must((await page.$eval('.cap-progress .cap-pill--info', (e) => e.textContent)).includes('Continuing…'), 'pill wording')
  must(await page.$$eval('.cap-card button, .cap-card [data-act]', (e) => e.length) === 0, 'no buttons on the Arrival card')
  await sleep(1100); must((await cur()) === 'AI scan', 'moved to AI scan, active step = ' + (await cur()))
  must((await page.$$eval('.cap-stepper__item--done', (e) => e.length)) === 2, 'Photo and Arrival are done')
})
await flow('play-desktop: GPS denied, no motion, no network, no recording: notes appear', async () => {
  await page.goto(`${BASE}?state=play-desktop`, { waitUntil: 'load' }); await sleep(1700)
  const s = await states(); must(s.gps === 'na' && s.net === 'na' && s.trail === 'na' && s.motion === 'acq', 'at 1.7 s ' + JSON.stringify(s))
  const flat = await page.$eval('[data-wave]', (e) => e.getAttribute('d')); must(flat.length > 10, 'wave drawn')
  must((await page.$eval('.cap-notice', (e) => e.textContent)).includes('GPS unavailable or denied'), 'GPS note shows as soon as it resolves')
  await sleep(1900); const t = (await page.$eval('.cap-notice', (e) => e.textContent))
  for (const n of ['GPS unavailable or denied', 'no motion samples (sensor unavailable or denied)', 'network info unavailable in this browser']) must(t.includes(n), 'note: ' + n)
  must(await page.$eval('.cap-progress .cap-meter', (e) => e.classList.contains('cap-meter--warn')), 'meter is amber when something is unavailable')
})
await flow('error path: slides back, Photo active, Arrival pending, role=alert banner', async () => {
  await page.goto(`${BASE}?state=err-back`, { waitUntil: 'load' }); await sleep(300)
  must(await page.$('.cap-arr'), 'starts on Arrival'); await sleep(1300)
  must((await cur()) === 'Photo', 'active = ' + (await cur()))
  must(await page.$eval('.cap-banner--error', (e) => e.getAttribute('role') === 'alert' && e.textContent.startsWith('Submission failed: ')), 'error banner with role=alert')
  must((await page.$$eval('.cap-stepper__item--pending', (e) => e.length)) === 3, 'Arrival back to pending')
  await page.click('[data-act="replay"]'); await sleep(200); must(await page.$('.cap-arr'), 'replay returns to Arrival')
})
await flow('reduced motion: no slide, sequence still completes', async () => {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.goto(`${BASE}?state=to-scan`, { waitUntil: 'load' }); await sleep(900)
  must((await cur()) === 'AI scan', 'moved on under reduced motion'); await page.emulateMediaFeatures([])
})
await flow('tab order and focus ring on the shell', async () => {
  await page.goto(`${BASE}?state=mid`, { waitUntil: 'load' }); await page.keyboard.press('Tab')
  must(await page.$eval(':focus', (e) => e.classList.contains('cap-skip-link')), 'first tab stop is the skip link')
})
await browser.close()

const report = { when: new Date().toISOString().slice(0, 16).replace('T', ' '), found: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, [...v]])) }
fs.writeFileSync(path.join(root, 'coverage-report.js'), `window.ARR_COVERAGE_REPORT = ${JSON.stringify(report)};\n`)
const missing = COVER.filter((c) => !found[c[0]].size).map((c) => c[0])
const lines = [`ids in the DOM: ${COVER.length - missing.length}/${COVER.length}${missing.length ? ' MISSING ' + missing.join(',') : ''}`, `additions measured: ${['Add.progress', 'Add.thumb'].map((a) => a + ' ' + found[a].size + ' states').join(', ')}`, `contrast checks: ${contrast.length} text samples on real backgrounds, minimum ${minC}:1`, ...flows.map((f) => `flow: ${f[0]} -> ${f[1]}`), problems.length ? 'PROBLEMS:\n  ' + problems.join('\n  ') : 'problems: 0']
if (missing.length) problems.push('missing ids ' + missing.join(','))
fs.writeFileSync(path.join(root, 'verify-output.txt'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
process.exit(problems.length ? 1 : 0)
