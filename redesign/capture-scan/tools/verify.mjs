// node tools/verify.mjs   (the redesign server must run:  cd redesign && PORT=5181 node serve.mjs)
// 1. every preset at 1280 / 820 / 390: inventory ids (data-inv) in the DOM, no horizontal overflow, no page errors, no text under 12px,
//    no controls inside the card (B7), reduced-motion presets really static, 2. contrast of the new token pairs (AA, both themes),
// 3. the live timeline: 650 ms cadence, 2.6 s floor, each announcement spoken once, slow line at 8 s, failure alert, 4. writes coverage-report.js.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.resolve(here, '../../../client/package.json'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.SCAN_BASE ?? 'http://localhost:5181/capture-scan/app.html'
const root = path.resolve(here, '..')
const load = (f) => new Function('window', fs.readFileSync(path.join(root, f), 'utf8') + '; return window')({})
const COVER = load('js/scan-coverage-data.js').SCAN_COVERAGE
const SIZES = [[1280, 900, 'desktop'], [820, 1000, 'tablet'], [390, 844, 'phone']]
const problems = []
const found = Object.fromEntries(COVER.map((c) => [c[0], new Set()]))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const must = (c, m) => { if (!c) throw new Error(m) }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
page.on('pageerror', (e) => problems.push(`PAGE ERROR ${e.message}`))
await page.goto(BASE, { waitUntil: 'networkidle0' })
const ids = await page.evaluate(() => window.__scan.ST.presets.map((p) => p.id))
console.log(`${ids.length} presets × ${SIZES.length} widths`)

for (const [w, h, label] of SIZES) {
  await page.setViewport({ width: w, height: h, isMobile: w <= 720, hasTouch: w <= 720 })
  for (const id of ids) {
    await page.goto(`${BASE}?state=${id}`, { waitUntil: 'load' })
    const r = await page.evaluate(() => {
      const out = { inv: [], overflow: document.documentElement.scrollWidth - innerWidth, tiny: [], controls: 0, cardBottom: 0, anim: {}, texts: [] }
      document.querySelectorAll('[data-inv]').forEach((e) => e.dataset.inv.split(' ').forEach((i) => out.inv.push(i)))
      document.querySelectorAll('.cap-card *').forEach((e) => {
        if (!e.childNodes.length) return
        const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
        if (own && parseFloat(getComputedStyle(e).fontSize) < 11.99) out.tiny.push(e.className + ':' + getComputedStyle(e).fontSize)
      })
      out.controls = document.querySelectorAll('#scan-card button, #scan-card a, #scan-card input, #scan-card select, #scan-card [tabindex]').length
      const c = document.getElementById('scan-card'); out.cardBottom = c ? Math.round(c.getBoundingClientRect().bottom) : 0
      const cs = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).animationName : null }
      out.anim = { arc: cs('.cap-scanmark__arc'), core: cs('.cap-scanmark__core'), cell: cs('.cap-meter--busy .cap-meter__cell'), spinHidden: !!document.querySelector('.cap-step--active .cap-step__spin') && getComputedStyle(document.querySelector('.cap-step--active .cap-step__spin')).display === 'none' }
      const live = document.getElementById('scan-live')
      out.live = { role: live.getAttribute('role'), polite: live.getAttribute('aria-live'), text: live.textContent }
      out.hasAlert = !!document.querySelector('[role="alert"]')
      out.ariaHidden = document.querySelector('.cap-scanmark')?.getAttribute('aria-hidden')
      out.banner = document.querySelector('.cap-banner--warn')?.textContent ?? null
      out.lines = [...document.querySelectorAll('.cap-steps li[data-inv^="B3"]')].map((e) => e.querySelector('.cap-step__text').textContent)
      return out
    })
    r.inv.forEach((i) => { if (found[i]) found[i].add(id) })
    const tag = `${label} ${id}`
    if (r.overflow > 1) problems.push(`${tag}: horizontal overflow ${r.overflow}px`)
    if (r.tiny.length) problems.push(`${tag}: text under 12px: ${[...new Set(r.tiny)].slice(0, 3).join(' | ')}`)
    if (r.controls) problems.push(`${tag}: ${r.controls} controls inside the card (B7: no user actions)`)
    if (r.live.role !== 'status' || r.live.polite !== 'polite') problems.push(`${tag}: live region is not role=status aria-live=polite`)
    if (r.ariaHidden !== 'true') problems.push(`${tag}: scan mark is not aria-hidden`)
    if (r.lines.length !== 5) problems.push(`${tag}: expected 5 lines, found ${r.lines.length}`)
    if (id.startsWith('fail') && !r.hasAlert) problems.push(`${tag}: failure has no role=alert`)
    if (id.startsWith('rm-')) {
      if (r.anim.arc !== 'none' || r.anim.core !== 'none' || r.anim.cell !== 'none') problems.push(`${tag}: reduced motion still animates ${JSON.stringify(r.anim)}`)
      if (id === 'rm-l3' && !r.anim.spinHidden) problems.push(`${tag}: spinner still shown in reduced motion`)
    } else if (!id.startsWith('fail')) {
      if (r.anim.arc === 'none' || r.anim.cell === 'none') problems.push(`${tag}: expected running animation, got ${JSON.stringify(r.anim)}`)
    }
    if (w <= 720 && !['slow-notes3', 'fail-net', 'notes3'].includes(id) && r.cardBottom > h - 60) problems.push(`${tag}: card ends below the bottom nav (${r.cardBottom} > ${h - 60})`)
  }
}

/* exact wording check against the React source */
const src = fs.readFileSync(path.resolve(here, '../../../client/src/components/capture/Analysis.jsx'), 'utf8')
const dataJs = load('js/scan-data.js').SCAN_DATA
for (const l of dataJs.LINES) if (!src.includes(l.replace(/'/g, "\\'")) && !src.includes(l)) problems.push(`line wording differs from Analysis.jsx: ${l}`)
const cap = fs.readFileSync(path.resolve(here, '../../../client/src/pages/Capture.jsx'), 'utf8')
for (const n of dataJs.NOTES) if (!cap.includes(n)) problems.push(`note wording differs from Capture.jsx: ${n}`)
for (const s of ['AI analysis', 'Neural scan in progress', 'Submitted anyway', 'Submission failed:']) if (!cap.includes(s)) problems.push(`string not in Capture.jsx: ${s}`)

/* ---- contrast of the new pairs (tints blended over the card) ---- */
const hex = (c) => c.match(/#(\w\w)(\w\w)(\w\w)/).slice(1).map((x) => parseInt(x, 16))
const mix = (fg, bg, a) => hex(fg).map((v, i) => Math.round(v * a + hex(bg)[i] * (1 - a)))
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const css = fs.readFileSync(path.resolve(here, '../../capture-photo/css/cap-tokens.css'), 'utf8')
const block = (sel) => { const i = css.indexOf(sel); return css.slice(i, css.indexOf('}', i)) }
const tok = (b, n) => (b.match(new RegExp(`--cap-${n}:\\s*(#\\w{6})`)) || [])[1]
const contrast = []
for (const [theme, sel] of [['dark', ':root {'], ['light', ":root[data-theme='light'] {"]]) {
  const t = block(sel), g = (n) => tok(t, n) ?? tok(block(':root {'), n)
  const card = g('card'), actBg = mix(g('accent'), card, 0.10), badBg = mix(g('bad'), card, 0.08), warnBg = mix(g('warn'), card, 0.07)
  const pairs = [
    ['muted text (done / pending rows) on card', hex(g('text-2')), hex(card), 4.5],
    ['text (active row) on active tint', hex(g('text')), actBg, 4.5],
    ['“Running” word (accent-text) on active tint', hex(g('accent-text')), actBg, 4.5],
    ['muted sub text on active tint', hex(g('text-2')), actBg, 4.5],
    ['“Done” check (ok) on card', hex(g('ok')), hex(card), 3],
    ['“Stopped” word (bad) on stopped tint', hex(g('bad')), badBg, 4.5],
    ['text on stopped tint', hex(g('text')), badBg, 4.5],
    ['text on warning banner', hex(g('text')), warnBg, 4.5]
  ]
  for (const [n, fg, b, min] of pairs) { const r = ratio(fg, b); contrast.push({ theme, n, r: +r.toFixed(2), ok: r >= min }); if (r < min) problems.push(`contrast ${theme}: ${n} ${r.toFixed(2)} < ${min}`) }
}

/* ---- the live timeline ---- */
const timeline = []
async function flow(name, fn) { try { const note = await fn(); timeline.push([name, 'ok', note || '']) } catch (e) { timeline.push([name, 'FAIL ' + e.message, '']); problems.push(`flow ${name}: ${e.message}`) } }
await page.setViewport({ width: 1280, height: 900 })
const observe = (opts) => page.evaluate((o) => new Promise((resolve) => {
  const live = document.getElementById('scan-live'), t0 = performance.now(), said = [], rows = []
  new MutationObserver(() => { const t = live.textContent; if (t && said[said.length - 1]?.t !== t) said.push({ t, at: Math.round(performance.now() - t0) }) }).observe(live, { childList: true, characterData: true, subtree: true })
  let lastSig = ''
  const poll = setInterval(() => {
    const act = document.querySelector('.cap-step--active, .cap-step--halt'); const sig = act ? [...act.parentNode.children].indexOf(act) + ':' + act.className.includes('halt') : 'none'
    if (sig !== lastSig) { rows.push({ sig, at: Math.round(performance.now() - t0) }); lastSig = sig }
    if (!document.getElementById('scan-card')) rows.push({ sig: 'verdict', at: Math.round(performance.now() - t0) })
  }, 20)
  window.__scan.ST.play(Object.assign({ onReturn: () => {} }, o.run))
  setTimeout(() => { clearInterval(poll); resolve({ said, rows, alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent), slow: !!document.querySelector('.cap-scan__note'), verdict: !document.getElementById('scan-card') }) }, o.ms)
}), opts)
await page.goto(`${BASE}?state=l1`, { waitUntil: 'load' })
await flow('650 ms cadence, one announcement per message, slow line at 8 s', async () => {
  const r = await observe({ run: { answerMs: 10000 }, ms: 10600 })
  const stepRows = r.rows.filter((x) => /^\d+:false$/.test(x.sig))
  must(stepRows.length >= 6, `expected 6 active-row positions (5 lines + finishing), saw ${stepRows.length}`)
  for (let i = 1; i < 5; i++) { const d = stepRows[i].at - stepRows[i - 1].at; must(Math.abs(d - 650) < 140, `line ${i} → ${i + 1} took ${d} ms, expected ≈650`) }
  const texts = r.said.map((s) => s.t)
  must(texts.length === new Set(texts).size, 'an announcement was repeated: ' + JSON.stringify(texts))
  must(texts.filter((t) => t.startsWith('Step ')).length === 5, `expected 5 “Step n of 5” announcements, got ${texts.length}`)
  must(texts.some((t) => t.startsWith('Finishing up')), 'no “Finishing up…” announcement')
  must(texts[texts.length - 1].startsWith('Still working'), 'slow line not announced last')
  const slowAt = r.said.find((s) => s.t.startsWith('Still working')).at; must(Math.abs(slowAt - 8000) < 300, `slow line at ${slowAt} ms, expected ≈8000`)
  return `${texts.length} announcements, each once; rows at ${stepRows.map((x) => x.at).join(', ')} ms; slow line at ${slowAt} ms`
})
await flow('2.6 s floor: a fast server still shows the scan until 2.6 s', async () => {
  const r = await observe({ run: { answerMs: 300 }, ms: 3000 })
  const v = r.rows.find((x) => x.sig === 'verdict'); must(v, 'never reached the verdict'); must(v.at >= 2550 && v.at < 2900, `verdict at ${v.at} ms, expected ≈2600`)
  return `verdict at ${v.at} ms`
})
await flow('stays until the server answers (no verdict before)', async () => {
  const r = await observe({ run: { answerMs: null }, ms: 5000 })
  must(!r.verdict, 'moved on without an answer'); return 'still on the scan after 5 s'
})
await flow('failure: alert with the exact message, scan stops, returns after the hold', async () => {
  const r = await observe({ run: { failAfterMs: 3000, holdMs: 100, error: 'Submission failed: Server responded 503: upstream unavailable' }, ms: 3600 })
  must(r.alerts.length === 1 && r.alerts[0].includes('Submission failed: Server responded 503'), 'alert: ' + JSON.stringify(r.alerts))
  const stopped = await page.evaluate(() => ({ card: document.getElementById('scan-card').classList.contains('cap-card--fail'), halt: !!document.querySelector('.cap-step--halt'), busy: document.getElementById('scan-card').hasAttribute('aria-busy'), arc: getComputedStyle(document.querySelector('.cap-scanmark__arc')).animationName }))
  must(stopped.card && !stopped.busy && stopped.arc === 'none', 'failure styling ' + JSON.stringify(stopped)); return 'alert shown once, scan stopped'
})
await browser.close()

const report = { when: new Date().toISOString().slice(0, 16).replace('T', ' '), states: ids.length, widths: SIZES.length, found: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, [...v]])) }
fs.writeFileSync(path.join(root, 'coverage-report.js'), 'window.SCAN_COVERAGE_REPORT = ' + JSON.stringify(report) + ';\n')
const needDom = COVER.filter((c) => c[5] !== 'beh' && c[5] !== 'add')
const missing = needDom.filter((c) => !found[c[0]].size).map((c) => c[0])
const addMissing = COVER.filter((c) => c[5] === 'add' && !found[c[0]].size).map((c) => c[0])
console.log(`\nInventory ids with DOM presence: ${needDom.length - missing.length}/${needDom.length} found${missing.length ? ' · MISSING ' + missing.join(', ') : ''}`)
console.log(`Additions with their own marker: ${COVER.filter((c) => c[5] === 'add').length - addMissing.length}/${COVER.filter((c) => c[5] === 'add').length}${addMissing.length ? ' · MISSING ' + addMissing.join(', ') : ''}`)
console.log('Timeline:'); timeline.forEach((f) => console.log(' ', f[1] === 'ok' ? 'PASS' : 'FAIL', f[0], f[1] === 'ok' ? '· ' + f[2] : f[1]))
console.log('Contrast:'); contrast.forEach((c) => console.log(' ', c.ok ? 'PASS' : 'FAIL', c.theme, c.n, c.r))
console.log(`\nProblems: ${problems.length}`); problems.forEach((p) => console.log(' -', p))
process.exit(problems.length || missing.length || addMissing.length ? 1 : 0)
