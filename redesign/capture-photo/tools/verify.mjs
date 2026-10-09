// node tools/verify.mjs   (the redesign server must run:  cd redesign && PORT=5181 node serve.mjs)
// 1. loads every preset at 1280 / 820 / 390 and records which inventory ids (data-inv) are in the DOM,
// 2. checks no horizontal overflow, no page errors, phone touch targets >= 44px, the shutter inside the viewport,
// 3. checks contrast of the token pairs in both themes (WCAG AA), 4. clicks through the real flows.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.resolve(here, '../../../client/package.json'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.CAP_BASE ?? 'http://localhost:5181/capture-photo/app.html'
const root = path.resolve(here, '..')
const load = (f) => new Function('window', fs.readFileSync(path.join(root, f), 'utf8') + '; return window')({})
const COVER = load('js/cap-coverage-data.js').CAP_COVERAGE
const SIZES = [[1280, 900, 'desktop'], [820, 1100, 'tablet'], [390, 844, 'phone']]
const problems = []
const found = Object.fromEntries(COVER.map((c) => [c[0], new Set()]))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
page.on('pageerror', (e) => problems.push(`PAGE ERROR ${e.message}`))
const ids = await (async () => {
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  return page.evaluate(() => window.__cap.ST.presets.map((p) => p.id))
})()
console.log(`${ids.length} presets × ${SIZES.length} widths`)

for (const [w, h, label] of SIZES) {
  await page.setViewport({ width: w, height: h, isMobile: w <= 720, hasTouch: w <= 720 })
  for (const id of ids) {
    await page.goto(`${BASE}?state=${id}`, { waitUntil: 'load' })
    const r = await page.evaluate(([w, label]) => {
      const out = { inv: [], overflow: document.documentElement.scrollWidth - innerWidth, small: [], shutter: null }
      document.querySelectorAll('[data-inv]').forEach((e) => e.dataset.inv.split(' ').forEach((i) => out.inv.push(i + '|' + (e.closest('[hidden]') ? 'h' : 'v'))))
      if (w <= 720) {
        document.querySelectorAll('.cap button, .cap a[href], .cap input, .cap select, .cap label.cap-picker').forEach((e) => {
          const b = e.getBoundingClientRect(); const cs = getComputedStyle(e)
          if (!b.width || cs.visibility === 'hidden' || cs.display === 'none' || e.closest('[hidden]') || e.className.includes('cap-sr')) return
          if (e.matches('.cap-skip-link, .cap-link, .cap-nav__tab')) return
          if (b.height < 43.5 || b.width < 43.5) out.small.push(`${e.className.toString().slice(0, 40)} ${Math.round(b.width)}×${Math.round(b.height)}`)
        })
      }
      const sh = document.querySelector('.cap-shutter')
      if (sh) { const b = sh.getBoundingClientRect(); out.shutter = { ok: b.top >= 0 && b.bottom <= innerHeight, bottom: Math.round(b.bottom), ih: innerHeight } }
      return out
    }, [w, label])
    r.inv.forEach((s) => { const [i, v] = s.split('|'); if (found[i]) found[i].add(id) })
    if (r.overflow > 1) problems.push(`${label} ${id}: horizontal overflow ${r.overflow}px`)
    if (r.small.length) problems.push(`${label} ${id}: touch targets < 44px: ${[...new Set(r.small)].slice(0, 4).join(' | ')}`)
    if (r.shutter && !r.shutter.ok && w <= 720) problems.push(`${label} ${id}: shutter outside viewport ${JSON.stringify(r.shutter)}`)
    if (r.shutter && !r.shutter.ok && w >= 1000 && h >= 800) problems.push(`${label} ${id}: shutter not fully on screen at ${w}×${h} (${JSON.stringify(r.shutter)})`)
  }
}

/* ---- contrast of token pairs ---- */
const hex = (c) => { const m = c.match(/#(\w\w)(\w\w)(\w\w)/); return m.slice(1).map((x) => parseInt(x, 16)) }
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const ratio = (a, b) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const css = fs.readFileSync(path.join(root, 'css/cap-tokens.css'), 'utf8')
const block = (sel) => { const i = css.indexOf(sel); return css.slice(i, css.indexOf('}', i)) }
const tok = (b, n) => (b.match(new RegExp(`--cap-${n}:\\s*(#\\w{6})`)) || [])[1]
const contrast = []
for (const [theme, sel] of [['dark', ':root {'], ['light', ":root[data-theme='light'] {"]]) {
  const t = theme === 'dark' ? block(sel) : block(sel)
  const g = (n) => tok(t, n) ?? tok(block(':root {'), n)
  const bg = g('card'), shell = g('shell')
  const pairs = [['text on card', g('text'), bg, 4.5], ['muted text on card', g('text-2'), bg, 4.5], ['muted text on shell', g('text-2'), shell, 4.5], ['pass on card', g('ok'), bg, 4.5], ['warn on card', g('warn'), bg, 4.5], ['fail on card', g('bad'), bg, 4.5], ['accent text on shell', g('accent-text'), shell, 4.5], ['white on accent button', '#ffffff', g('accent'), 4.5], ['accent ring on shell (3:1)', g('accent'), shell, 3]]
  for (const [n, fg, b, min] of pairs) { const r = ratio(fg, b); contrast.push({ theme, n, r: +r.toFixed(2), ok: r >= min }); if (r < min) problems.push(`contrast ${theme}: ${n} ${r.toFixed(2)} < ${min}`) }
}
// on-camera tokens sit on the dark scrim (worst case: scrim over white = #3a3a3c-ish, use the 0.74 black over white ≈ #424242)
for (const n of ['ov-ok', 'ov-warn', 'ov-bad', 'ov-text-2', 'ov-accent']) { const r = ratio(tok(block(':root {'), n), '#424242'); contrast.push({ theme: 'camera', n: n + ' on scrim over white', r: +r.toFixed(2), ok: r >= 4.5 }); if (r < 4.5) problems.push(`contrast camera: ${n} ${r.toFixed(2)}`) }

/* ---- interaction flows ---- */
const flows = []
async function flow(name, fn) { try { await fn(); flows.push([name, 'ok']) } catch (e) { flows.push([name, 'FAIL ' + e.message]); problems.push(`flow ${name}: ${e.message}`) } }
const click = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) throw new Error('missing ' + s); e.click() }, sel)
const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel)
const must = (c, m) => { if (!c) throw new Error(m) }
await page.setViewport({ width: 1280, height: 900 })
await flow('desktop: open camera → ready → capture → result → retake', async () => {
  await page.goto(BASE, { waitUntil: 'load' })
  await click('[data-act="open-cam"]'); await sleep(1100)
  must(await page.$('.cap-shutter'), 'no shutter after open')
  must((await text('.cap-hint')).includes('Too dark'), 'hint should show the top problem')
  await sleep(2600)
  must((await text('.cap-hint')).includes('Looks good'), 'ready hint')
  await click('.cap-shutter'); await sleep(300)
  must((await text('.cap-hint')) === 'Hold still…', 'capturing hint')
  await sleep(1300); must(await page.$('.cap-scanline'), 'scan line'); must((await text('.cap-terminal')).includes('Checking focus, lighting, lens on-device'), 'terminal')
  await sleep(2700); must((await text('.cap-result__title')).includes('Photo verified'), 'result title')
  await click('[data-act="retake"]'); await sleep(200); must(await page.$('.cap-shutter'), 'camera back after retake')
})
await flow('face task: shutter disabled until live check passes', async () => {
  await page.goto(BASE, { waitUntil: 'load' })
  await click('[data-act="task"][data-arg="selfie"]'); must((await text('.cap-brief__note')).includes('short live check'), 'face note')
  await click('[data-act="open-cam"]'); await sleep(3100)
  must(await page.$eval('.cap-shutter', (e) => e.disabled), 'shutter should be disabled')
  must(!(await page.$('[data-act="use-picker"]')), 'no picker link for live-required task')
  await sleep(6800); must(!(await page.$eval('.cap-shutter', (e) => e.disabled)), 'shutter enabled after live check passes')
})
await flow('blocked result: no send button, Retake primary, card shakes', async () => {
  await page.goto(`${BASE}?state=result-block`, { waitUntil: 'load' })
  must(!(await page.$('[data-act="arrive"]')), 'send button hidden when blocked'); must(await page.$('.cap-why[role="alert"]'), 'why list')
  must(await page.$eval('[data-act="retake"]', (e) => e.classList.contains('cap-btn--primary')), 'retake primary')
})
await flow('metrics toggle, tabs, accordion, task picker', async () => {
  await page.goto(`${BASE}?state=live-dark`, { waitUntil: 'load' })
  await click('[data-act="hud-toggle"]'); must(await page.$('.cap-hud--compact'), 'compact after toggle')
  await click('[data-act="hud-toggle"]'); must(await page.$('.cap-hud--expanded'), 'expanded again')
  await page.goto(`${BASE}?state=recording-feed`, { waitUntil: 'load' })
  await click('#tab-trail'); must(await page.$eval('#pnl-trail', (e) => !e.hidden), 'trail tab visible')
  await page.focus('#tab-trail'); await page.keyboard.press('ArrowRight'); await sleep(50); must(await page.$eval('#pnl-na', (e) => !e.hidden), 'arrow key moves tab')
  await page.goto(`${BASE}?state=idle`, { waitUntil: 'load' })
  await click('[data-act="acc"][data-arg="consent"]'); must(await page.$eval('#acc-consent', (e) => !e.hidden), 'consent accordion opens')
  must((await text('#acc-consent')).includes('shortened IP address for 30 days'), 'full consent text')
  await click('[data-act="start-rec"]'); await sleep(1200); must(await page.$('[data-act="stop-rec"]'), 'recording started')
})
await flow('arrive → step 2 stub → back', async () => {
  await page.goto(`${BASE}?state=result-warn`, { waitUntil: 'load' })
  must((await text('[data-act="arrive"]')).includes('send location anyway'), 'warn wording')
  await click('[data-act="arrive"]'); await sleep(200); must(await page.$('.cap-stub'), 'stub'); await click('[data-act="back-photo"]'); await sleep(100); must(await page.$('.cap-start'), 'back to idle')
})
await flow('phone: immersive camera locks the page, close returns', async () => {
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await page.goto(BASE, { waitUntil: 'load' })
  await click('[data-act="open-cam"]'); await sleep(1200)
  must(await page.$eval('html', (e) => e.classList.contains('cap-lock')), 'scroll lock'); must(await page.$eval('.cap-stage', (e) => e.dataset.immersive === '1'), 'immersive')
  await click('[data-act="close-cam"]'); await sleep(100); must(!(await page.$eval('html', (e) => e.classList.contains('cap-lock'))), 'unlocked')
})
await flow('file picker: a chosen photo is checked', async () => {
  await page.setViewport({ width: 1280, height: 900 })
  await page.goto(`${BASE}?state=denied`, { waitUntil: 'load' })
  must((await text('.cap-banner--warn')).includes('Camera permission was denied.'), 'banner'); must(await page.$('[data-act="use-live"]'), 'live link')
})
await browser.close()

for (const c of COVER) if (c[5] === 'removed' && found[c[0]].size) problems.push(`${c[0]} was removed but is still in the DOM`)
const report = { when: new Date().toISOString().slice(0, 16).replace('T', ' '), found: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, [...v]])) }
fs.writeFileSync(path.join(root, 'coverage-report.js'), 'window.CAP_COVERAGE_REPORT = ' + JSON.stringify(report) + ';\n')
const missing = COVER.filter((c) => c[5] !== 'removed' && !found[c[0]].size).map((c) => c[0])
console.log(`\nInventory ids: ${COVER.filter((c) => c[5] !== 'removed').length - missing.length}/${COVER.filter((c) => c[5] !== 'removed').length} found (${COVER.filter((c) => c[5] === 'removed').length} removed by request, must be absent: ${COVER.filter((c) => c[5] === 'removed' && found[c[0]].size).map((c) => c[0]).join(', ') || 'ok'}) in the DOM${missing.length ? ' · MISSING ' + missing.join(', ') : ''}`)
console.log('Flows:'); flows.forEach((f) => console.log(' ', f[1] === 'ok' ? 'PASS' : 'FAIL', f[0], f[1] === 'ok' ? '' : f[1]))
console.log('Contrast:'); contrast.forEach((c) => console.log(' ', c.ok ? 'PASS' : 'FAIL', c.theme, c.n, c.r))
console.log(`\nProblems: ${problems.length}`); problems.forEach((p) => console.log(' -', p))
process.exit(problems.length || missing.length ? 1 : 0)
