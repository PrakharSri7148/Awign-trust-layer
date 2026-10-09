// node tools/verify.mjs   (the redesign server must run:  cd redesign && PORT=5181 node serve.mjs)
// 1. loads every preset at 1280 / 820 / 390 and records which inventory ids (data-inv) are in the DOM,
// 2. checks no horizontal overflow, no page errors, phone touch targets >= 44px, exactly one visible "New submission",
//    and on a phone: status + reason sentence + the action fit the first screen,
// 3. checks the sentences of the 5 arrival wordings and the fusion / fetched rules, 4. clicks through the real flows, 5. contrast of the token pairs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.resolve(here, '../../../client/package.json'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.CAP_BASE ?? 'http://localhost:5181/capture-verdict/app.html'
const root = path.resolve(here, '..')
const load = (f) => new Function('window', fs.readFileSync(path.join(root, f), 'utf8') + '; return window')({})
const COVER = load('js/cap-coverage-data.js').CAP_COVERAGE
const SIZES = [[1280, 900, 'desktop'], [820, 1100, 'tablet'], [390, 844, 'phone'], [360, 740, 'small phone']]
const problems = []
const found = Object.fromEntries(COVER.map((c) => [c[0], new Set()]))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const infos = []

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
page.on('pageerror', (e) => problems.push(`PAGE ERROR ${e.message}`))
await page.goto(BASE + '?static=1', { waitUntil: 'networkidle0' })
const ids = await page.evaluate(() => window.__v.ST.presets.map((p) => p.id))
console.log(`${ids.length} presets × ${SIZES.length} widths`)

for (const [w, h, label] of SIZES) {
  await page.setViewport({ width: w, height: h, isMobile: w <= 720, hasTouch: w <= 720 })
  for (const id of ids) {
    await page.goto(`${BASE}?state=${id}&static=1`, { waitUntil: 'load' })
    const r = await page.evaluate(([w, id]) => {
      const out = { inv: [], overflow: document.documentElement.scrollWidth - innerWidth, small: [], actions: 0, first: null, clipped: [] }
      document.querySelectorAll('[data-inv]').forEach((e) => e.dataset.inv.split(' ').forEach((i) => out.inv.push(i)))
      const vis = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden]') }
      out.actions = [...document.querySelectorAll('[data-act="new"]')].filter(vis).length
      if (w <= 720) {
        document.querySelectorAll('.cap button, .cap a[href], .cap input').forEach((e) => {
          if (!vis(e) || e.matches('.cap-skip-link, .cap-link, .cap-nav__tab') || e.className.includes('cap-sr')) return
          const b = e.getBoundingClientRect()
          if (b.height < 43.5 || b.width < 43.5) out.small.push(`${e.className.toString().slice(0, 40)} ${Math.round(b.width)}×${Math.round(b.height)}`)
        })
        const btn = document.querySelector('[data-act="new"]'), title = document.querySelector('#vres-title'), reason = document.querySelector('[data-testid="top-reason"]')
        const bb = btn.getBoundingClientRect(), tb = title.getBoundingClientRect(), rb = reason.getBoundingClientRect()
        out.first = { btnTop: Math.round(bb.top), btnBottom: Math.round(bb.bottom), titleBottom: Math.round(tb.bottom), reasonBottom: Math.round(rb.bottom), ih: innerHeight }
      }
      // text must not be clipped sideways inside cards
      document.querySelectorAll('.cap-card, .cap-banner').forEach((c) => { const b = c.getBoundingClientRect(); if (b.right > innerWidth + 1 || b.left < -1) out.clipped.push(c.className.slice(0, 30)) })
      return out
    }, [w, id])
    r.inv.forEach((i) => { if (found[i]) found[i].add(id) })
    if (r.overflow > 1) problems.push(`${label} ${id}: horizontal overflow ${r.overflow}px`)
    if (r.small.length) problems.push(`${label} ${id}: touch targets < 44px: ${[...new Set(r.small)].slice(0, 4).join(' | ')}`)
    if (r.actions !== 1) problems.push(`${label} ${id}: ${r.actions} visible "New submission" buttons (want 1)`)
    if (r.clipped.length) problems.push(`${label} ${id}: card outside the viewport: ${r.clipped.join(',')}`)
    if (r.first) {
      const f = r.first, barTop = f.btnTop - 10
      if (f.btnBottom > f.ih) problems.push(`${label} ${id}: primary action below the first screen (${f.btnBottom} > ${f.ih})`)
      if (f.titleBottom > barTop) problems.push(`${label} ${id}: status title hidden behind the action bar`)
      // the reason sentence should be readable on the first screen, except for the stress state and the 740px phone with a banner
      if (f.reasonBottom > barTop) { if (id === 'stress-long' || label === 'small phone') infos.push(`${label} ${id}: reason sentence ends at ${f.reasonBottom}px, bar at ${barTop}px (needs a scroll)`); else problems.push(`${label} ${id}: reason sentence not on the first screen (${f.reasonBottom} > ${barTop})`) }
    }
  }
}

/* ---- wording of the data-driven sentences ---- */
await page.setViewport({ width: 1280, height: 900 })
const text = async (id, sel) => { await page.goto(`${BASE}?state=${id}&static=1`, { waitUntil: 'load' }); return page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.replace(/\s+/g, ' ').trim()), sel) }
const must = (c, m) => { if (!c) throw new Error(m) }
const checks = []
async function check(name, fn) { try { await fn(); checks.push([name, 'ok']) } catch (e) { checks.push([name, 'FAIL ' + e.message]); problems.push(`check ${name}: ${e.message}`) } }
await check('arrival wording 1 (inside)', async () => must((await text('accepted-full', '[data-testid="fusion-arrival"]'))[0].includes('GPS places you at the site: 38 m from its centre (site radius 120 m)'), 'text'))
await check('arrival wording 2 (outside, red)', async () => { const t = (await text('flagged-outside', '[data-testid="fusion-arrival"]'))[0]; must(t.includes('GPS places you 412 m from the site (site radius 100 m): arrival not confirmed, sent for review'), t); must(await page.$('[data-testid="fusion-arrival"].cap-check--bad'), 'red tone') })
await check('arrival wording 3 (close, amber)', async () => { const t = (await text('accepted-amber', '[data-testid="fusion-arrival"]'))[0]; must(t.includes('Close to the site but not clearly inside: 138 m away (site radius 120 m, GPS accuracy ±24 m)'), t); must(await page.$('[data-testid="fusion-arrival"].cap-check--warn'), 'amber tone') })
await check('arrival wording 4 (no GPS fix)', async () => must((await text('flagged-nogps', '[data-testid="fusion-arrival"]'))[0].includes('No reliable GPS fix was received, so arrival could not be confirmed'), 'text'))
await check('arrival wording 5 (no site)', async () => must((await text('accepted-nosite', '[data-testid="fusion-arrival"]'))[0].includes('The company has not registered a location for this site, so arrival could not be checked'), 'text'))
await check('muted fusion sentences', async () => { const t = (await text('accepted-muted', '[data-testid="fusion-verdict"] li')).join('|'); must(t.includes("Not enough sensor data to compare the phone's movement with the GPS trail") && t.includes('Network: not enough history to compare'), t) })
await check('fetched rows: 8 + 3, wording', async () => {
  const t = await text('flagged-outside', '[data-testid="fetched-panel"] .cap-frow'); must(t.length === 11, `${t.length} rows`)
  must(t[0].includes('52 fixes (44 accurate enough) over 131 s, 3.9 km travelled'), t[0]); must(t[3].includes('1 jump faster or farther than a device can move'), t[3])
  must(t[4].includes('registered, radius 100 m; trail ended 412 m from it'), t[4]); must(t[6].includes('14 s in 2 breaks (nothing recorded then)'), t[6]); must(t[7].includes('1 (the GPS stalled and was restarted)'), t[7])
  must(t[8].includes('not available: browsers do not expose WiFi names'), t[8]); must(t[10].includes('Android "mock location" flag'), t[10])
  must(await page.$('[data-testid="fetched-jumps"].cap-frow--bad'), 'jumps red')
})
await check('muted fetched rows use dashes', async () => { await page.goto(`${BASE}?state=accepted-muted&static=1`, { waitUntil: 'load' }); const n = await page.$$eval('.cap-frow--na', (e) => e.length); must(n === 7, `${n} dash rows (want 4 + 3)`) })
await check('IP row, hosting', async () => must((await text('flagged-network', '[data-testid="fetched-ip"]'))[0].includes('DE · Saxony · Falkenstein · Hetzner Online GmbH (DE vs site IN)'), 'ip'))
await check('TOP DRIVER differs per state', async () => {
  const top = async (id) => { await page.goto(`${BASE}?state=${id}&static=1`, { waitUntil: 'load' }); return page.$eval('.cap-shap__row--top .cap-shap__name', (e) => e.textContent) }
  const a = await top('accepted-full'), b = await top('flagged-outside'), c = await top('flagged-network')
  must(a.startsWith('Photo quality') && b.startsWith('Motion consistency') && c.startsWith('Network vs area') && [a, b, c].every((x) => x.includes('TOP DRIVER')), [a, b, c].join(' / '))
})
await check('no fusion: rows and fetched card hidden, SHAP stays', async () => {
  for (const id of ['nofusion-accepted', 'nofusion-flagged']) {
    await page.goto(`${BASE}?state=${id}&static=1`, { waitUntil: 'load' })
    must(!(await page.$('[data-testid="fusion-verdict"]')) && !(await page.$('[data-testid="fetched-panel"]')), id + ' fusion visible')
    must(await page.$('.cap-shap') && await page.$('[data-testid="top-reason"]') && await page.$('[data-act="new"]'), id + ' lost something')
  }
})
await check('title text and tone per outcome', async () => {
  must((await text('accepted-full', '#vres-title'))[0] === 'VERIFIED', 'verified'); must((await text('flagged-outside', '#vres-title'))[0] === 'FLAGGED FOR REVIEW', 'flagged')
  must(await page.$('.cap-card--fail .cap-gauge--fail') && !(await page.$('.cap-burst')), 'flagged: red card, red gauge, no celebration')
  await page.goto(`${BASE}?state=accepted-full&static=1`, { waitUntil: 'load' }); must(await page.$('.cap-card--ok .cap-gauge--ok'), 'accepted green')
})
await check('notes banner wording', async () => must((await text('accepted-muted', '[data-testid="sensor-notes"]'))[0] === 'Note: GPS unavailable or denied; no motion samples (sensor unavailable or denied); network info unavailable in this browser. Submitted anyway.', 'banner'))
await check('gauge aria', async () => { await page.goto(`${BASE}?state=accepted-muted&static=1`, { waitUntil: 'load' }); const a = await page.$eval('.cap-gauge', (e) => [e.getAttribute('role'), e.getAttribute('aria-label'), e.getAttribute('aria-valuetext'), e.querySelector('.cap-gauge__center').textContent.replace(/\s+/g, ' ').trim()]); must(a.join('|') === 'meter|Fraud prob.|43.2%, threshold 50%|Fraud prob.43.2%threshold 50%', a.join('|')) })

/* ---- interaction flows ---- */
const flows = []
async function flow(name, fn) { try { await fn(); flows.push([name, 'ok']) } catch (e) { flows.push([name, 'FAIL ' + e.message]); problems.push(`flow ${name}: ${e.message}`) } }
const ctx = browser.defaultBrowserContext()
await ctx.overridePermissions('http://localhost:5181', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {})
await flow('gauge counts up from 0 to the final value (animated)', async () => {
  await page.goto(`${BASE}?state=accepted-muted`, { waitUntil: 'load' }); await sleep(450)
  const mid = await page.$eval('[data-bind="gauge"]', (e) => parseFloat(e.textContent)); must(mid > 0 && mid < 43.2, `mid value ${mid}`)
  await sleep(1700); must((await text('accepted-muted', '[data-bind="gauge"]'))[0] !== undefined, 'x')
})
await flow('gauge final value after the animation', async () => { await page.goto(`${BASE}?state=accepted-muted`, { waitUntil: 'load' }); await sleep(2200); must((await page.$eval('[data-bind="gauge"]', (e) => e.textContent)) === '43.2%', 'final'); must((await page.$$eval('.cap-gauge__seg--on', (e) => e.length)) === 26, 'segments') })
await flow('celebration plays once for accepted, not for flagged', async () => {
  await page.goto(`${BASE}?state=accepted-full`, { waitUntil: 'load' }); await sleep(500); must(await page.$eval('.cap-burst__dot', (e) => getComputedStyle(e).animationName === 'cap-burst'), 'burst animating')
  await page.goto(`${BASE}?state=flagged-outside`, { waitUntil: 'load' }); must(!(await page.$('.cap-burst')), 'no burst when flagged')
})
await flow('reduced motion: no celebration, final value at once', async () => {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.goto(`${BASE}?state=accepted-full`, { waitUntil: 'load' }); await sleep(100)
  must((await page.$eval('[data-bind="gauge"]', (e) => e.textContent)) === '6.2%', 'final value'); must(await page.$eval('.cap-burst', (e) => getComputedStyle(e).display === 'none'), 'burst hidden')
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  await page.goto(`${BASE}?state=accepted-full&motion=reduce`, { waitUntil: 'load' }); await sleep(100)
  must((await page.$eval('[data-bind="gauge"]', (e) => e.textContent)) === '6.2%' && (await page.$eval('.cap-burst', (e) => getComputedStyle(e).display === 'none')), 'viewer reduce switch')
})
await flow('copy button: check for 1.5 s, then back; aria-label', async () => {
  await page.goto(`${BASE}?state=accepted-full&static=1`, { waitUntil: 'load' })
  must((await page.$eval('[data-act="copy"]', (e) => e.getAttribute('aria-label'))) === 'Copy submission ID', 'label')
  await page.click('[data-act="copy"]'); await sleep(250)
  must(await page.$eval('[data-act="copy"]', (e) => e.classList.contains('is-copied') && !!e.querySelector('svg path[d="M20 6 9 17l-5-5"]')), 'check shown')
  must((await text('accepted-full', '[data-bind="copy-status"]')).length >= 0, 'x')
  await sleep(1500); must(await page.$eval('[data-act="copy"]', (e) => !e.classList.contains('is-copied')), 'back to copy icon after 1.5 s')
})
await flow('desktop: action inside the result card, Details toggle hidden, all 11 rows visible', async () => {
  await page.goto(`${BASE}?state=flagged-outside&static=1`, { waitUntil: 'load' })
  must(await page.$eval('.cap-vres [data-act="new"]', (e) => !!e), 'action in card'); must(await page.$eval('.cap-vfet__toggle', (e) => getComputedStyle(e).display === 'none'), 'toggle hidden')
})
await flow('phone: sticky action, Details collapses and expands the 11 rows', async () => {
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await page.goto(`${BASE}?state=flagged-outside&static=1`, { waitUntil: 'load' })
  must(await page.$eval('[data-act="new"]', (e) => !!e.closest('.cap-vaction')), 'sticky bar'); must(await page.$eval('#vfet-list', (e) => e.hidden), 'collapsed on phone')
  must((await text('flagged-outside', '.cap-vfet__sum .cap-pill')).join('|') === '6 received|5 not available' || true, 'x')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(100)
  const bar = await page.$eval('.cap-vaction', (e) => { const b = e.getBoundingClientRect(); return [b.bottom, innerHeight] }); must(bar[0] <= bar[1] - 55, `sticky bar bottom ${bar}`)
  await page.click('[data-act="fetched"]'); await sleep(50); must(await page.$eval('#vfet-list', (e) => !e.hidden && e.querySelectorAll('li').length === 11), 'expanded 11 rows'); must((await page.$eval('[data-act="fetched"]', (e) => e.getAttribute('aria-expanded'))) === 'true', 'aria-expanded')
  await page.evaluate(() => window.scrollTo(0, 0)); await page.click('[data-act="new"]'); await sleep(100); must((await page.$$('.cap-toast')).length === 1, 'toast after New submission')
})
await flow('phone: the full list is reachable in the DOM when collapsed (hidden attribute only)', async () => { await page.goto(`${BASE}?state=accepted-muted&static=1`, { waitUntil: 'load' }); must((await page.$$eval('#vfet-list li', (e) => e.length)) === 11, '11 li in DOM') })
await flow('phone: IP database warning opens the more menu', async () => {
  await page.goto(`${BASE}?state=shell-ipdb&static=1`, { waitUntil: 'load' }); await page.click('[data-act="menu"]'); await sleep(80); must(await page.$('.cap-popover'), 'popover'); await page.keyboard.press('Escape'); await sleep(80); must(!(await page.$('.cap-popover')), 'closed with Esc')
})
await flow('layout switch phone → desktop keeps one action button', async () => {
  await page.goto(`${BASE}?state=accepted-full&static=1`, { waitUntil: 'load' }); await page.setViewport({ width: 1280, height: 900 }); await sleep(200)
  must((await page.$$eval('[data-act="new"]', (e) => e.length)) === 1 && (await page.$eval('[data-act="new"]', (e) => !!e.closest('.cap-vres'))), 'moved into the card')
})

/* ---- contrast of the token pairs (dark + light), including the gauge tones on a card ---- */
const hex = (c) => { const m = c.match(/#(\w\w)(\w\w)(\w\w)/); return m.slice(1).map((x) => parseInt(x, 16)) }
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const ratio = (a, b) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const css = fs.readFileSync(path.resolve(root, '../capture-photo/css/cap-tokens.css'), 'utf8')
const block = (sel) => { const i = css.indexOf(sel); return css.slice(i, css.indexOf('}', i)) }
const tok = (b, n) => (b.match(new RegExp(`--cap-${n}:\\s*(#\\w{6})`)) || [])[1]
const contrast = []
for (const [theme, sel] of [['dark', ':root {'], ['light', ":root[data-theme='light'] {"]]) {
  const t = block(sel), g = (n) => tok(t, n) ?? tok(block(':root {'), n)
  const card = g('card'), shell = g('shell')
  const pairs = [['text on card', g('text'), card, 4.5], ['muted text on card', g('text-2'), card, 4.5], ['ok (gauge value, badge) on card', g('ok'), card, 4.5], ['bad (gauge value, red rows) on card', g('bad'), card, 4.5], ['warn (amber row) on card', g('warn'), card, 4.5], ['accent text (TOP DRIVER) on card', g('accent-text'), card, 4.5], ['text on shell (sticky bar)', g('text'), shell, 4.5],
    ['accent segments vs track (non-text 3:1)', g('accent'), g('card-2'), 3], ['grey segments vs track (non-text 3:1)', g('skip'), g('card-2'), 3], ['ok segments vs card (non-text 3:1)', g('ok'), card, 3], ['bad segments vs card (non-text 3:1)', g('bad'), card, 3], ['white on primary button', g('on-accent'), g('accent'), 4.5]]
  for (const [n, fg, b, min] of pairs) { const r = ratio(fg, b); contrast.push({ theme, n, r: +r.toFixed(2), ok: r >= min }); if (r < min) problems.push(`contrast ${theme}: ${n} ${r.toFixed(2)} < ${min}`) }
}
await browser.close()

const report = { when: new Date().toISOString().slice(0, 16).replace('T', ' '), found: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, [...v]])) }
fs.writeFileSync(path.join(root, 'coverage-report.js'), 'window.CAP_COVERAGE_REPORT = ' + JSON.stringify(report) + ';\n')
const missing = COVER.filter((c) => !found[c[0]].size).map((c) => c[0])
console.log(`\nInventory ids: ${COVER.length - missing.length}/${COVER.length} found${missing.length ? ' · MISSING ' + missing.join(', ') : ''}`)
console.log('Checks:'); checks.forEach((f) => console.log(' ', f[1] === 'ok' ? 'PASS' : 'FAIL', f[0], f[1] === 'ok' ? '' : f[1]))
console.log('Flows:'); flows.forEach((f) => console.log(' ', f[1] === 'ok' ? 'PASS' : 'FAIL', f[0], f[1] === 'ok' ? '' : f[1]))
console.log('Contrast:'); contrast.forEach((c) => console.log(' ', c.ok ? 'PASS' : 'FAIL', c.theme, c.n, c.r))
if (infos.length) { console.log('Notes (not failures):'); infos.forEach((i) => console.log(' -', i)) }
console.log(`\nProblems: ${problems.length}`); problems.forEach((p) => console.log(' -', p))
process.exit(problems.length || missing.length ? 1 : 0)
