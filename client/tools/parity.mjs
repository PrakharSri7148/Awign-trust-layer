// Runs the same photos through the JS engine (client) and the Python engine
// (backend recheck) and reports where they disagree.
//   node tools/parity.mjs [source-photo]
// Without an argument it uses edge-validator/samples/good/* if present, else a bundled fixture.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadImage } from '@napi-rs/canvas'
import { runPhotoQuality } from '../src/lib/photoQuality/index.js'
import { asFile, encodeImage, nodeEnv } from '../src/lib/photoQuality/testing/nodeEnv.js'
import { makeVariants } from './variants.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const goodDir = path.join(root, 'edge-validator/samples/good')
const pickGood = () => (fs.existsSync(goodDir) ? fs.readdirSync(goodDir).filter((f) => /\.(jpe?g|png)$/i.test(f)).map((f) => path.join(goodDir, f))[0] : null)
const source = process.argv[2] || pickGood() || path.join(here, '../src/lib/photoQuality/testing/fixtures/china.jpg')

const img = await loadImage(fs.readFileSync(source))
const W = Math.min(img.width, 1600)
const H = Math.round((img.height * W) / img.width)
console.log(`source ${path.basename(source)} -> variants at ${W}x${H}`)
const variants = await makeVariants(source, W, H)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'))
const files = []
const js = {}
for (const [name, v] of Object.entries(variants)) {
  const bytes = encodeImage(v.rgba, v.w, v.h, { type: 'jpeg', quality: v.q })
  const f = path.join(tmp, `${files.length}.jpg`)
  fs.writeFileSync(f, bytes)
  files.push([name, f])
  js[name] = await runPhotoQuality(asFile(bytes, 'image/jpeg'), { env: nodeEnv })
}
const py = JSON.parse(
  execFileSync(path.join(root, 'backend/.venv/bin/python'), ['-m', 'photo_quality.cli', ...files.map((f) => f[1])], {
    cwd: path.join(root, 'backend'),
    maxBuffer: 1 << 28,
  }),
)

const IDS = ['blur', 'resolution', 'exposure', 'obstruction', 'glare', 'shake', 'noise']
const agree = Object.fromEntries(IDS.map((id) => [id, 0]))
let verdictAgree = 0
const rows = []
const disagree = []
files.forEach(([name], i) => {
  const a = js[name]
  const b = py[i].report
  if (a.verdict === b.verdict) verdictAgree++
  else disagree.push(`${name}: verdict js=${a.verdict} py=${b.verdict}`)
  const cells = IDS.map((id) => {
    const x = a.checks[id]
    const y = b.checks[id]
    const same = x.status === y.status
    if (same) agree[id]++
    else disagree.push(`${name}: ${id} js=${x.status}(${x.value?.toFixed?.(3)}) py=${y.status}(${y.value?.toFixed?.(3)})`)
    const rel = x.value != null && y.value != null && x.value !== 0 ? Math.abs(y.value - x.value) / Math.abs(x.value) : null
    return { same, rel }
  })
  rows.push([name, cells])
})
const pct = (n) => `${((100 * n) / files.length).toFixed(0)}%`
console.log('\nstatus agreement per check:', IDS.map((id) => `${id} ${pct(agree[id])}`).join(' | '))
console.log(`verdict agreement: ${pct(verdictAgree)} (${verdictAgree}/${files.length})`)
const relOf = (id) => rows.map(([, c]) => c[IDS.indexOf(id)].rel).filter((v) => v != null).sort((p, q) => p - q)
console.log('metric relative difference (median / p90 / max):')
for (const id of IDS) {
  const r = relOf(id)
  if (!r.length) continue
  console.log(`  ${id.padEnd(12)} ${(r[Math.floor(r.length / 2)] * 100).toFixed(1)}% / ${(r[Math.floor(r.length * 0.9)] * 100).toFixed(1)}% / ${(r[r.length - 1] * 100).toFixed(1)}%`)
}
console.log(disagree.length ? `\ndisagreements (${disagree.length}):\n  ${disagree.join('\n  ')}` : '\nno disagreements')
fs.rmSync(tmp, { recursive: true })
