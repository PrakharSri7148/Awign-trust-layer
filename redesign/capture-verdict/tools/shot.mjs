// Screenshot helper: node tools/shot.mjs <state> <width> <height> [theme] [out] [extra query]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.resolve(here, '../../../client/package.json'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.CAP_BASE ?? 'http://localhost:5181/capture-verdict/app.html'
const [state = 'accepted-full', w = '1280', h = '900', theme = 'dark', out, extra = 'static=1'] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('console', m.type(), m.text()) })
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1, isMobile: +w <= 720, hasTouch: +w <= 720 })
await page.goto(`${BASE}?state=${state}&theme=${theme}${extra ? '&' + extra : ''}`, { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 300))
const file = out ?? path.resolve(here, `../shots/${state}-${w}-${theme}.png`)
await page.screenshot({ path: file, fullPage: +w > 720 ? true : false })
console.log(file)
await browser.close()
