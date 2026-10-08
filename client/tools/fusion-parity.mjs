// Runs the same scripted sensor signals through the JS window features (client/src/lib/sensorFusion/windows.js) and the Python
// port (backend/fusion/windows.py) and reports where they disagree.   node tools/fusion-parity.mjs
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { activity, windowFeatures } from '../src/lib/sensorFusion/windows.js'
import { scriptedCases } from '../src/lib/sensorFusion/testing/signals.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cases = scriptedCases()
const py = JSON.parse(
  execFileSync(path.join(root, 'backend/.venv/bin/python'), ['-m', 'fusion.cli', 'windows'], {
    cwd: path.join(root, 'backend'),
    input: JSON.stringify({ cases }),
    maxBuffer: 1 << 28,
  }),
)

const TOL = { n: 0, hz: 1e-6, acc_rms: 1e-6, acc_peak: 1e-6, gyro_rms: 1e-6, cad_hz: 1e-6, cad_pw: 1e-6 }
let bad = 0
let compared = 0
for (const [name, samples] of Object.entries(cases)) {
  const js = windowFeatures(samples)
  js.activity = activity(js)
  const p = py[name]
  const diffs = []
  for (const k of [...Object.keys(TOL), 'activity']) {
    compared++
    const a = js[k]
    const b = p[k]
    const same = k === 'activity' ? a === b : a == null || b == null ? a == b : Math.abs(a - b) <= TOL[k] * Math.max(1, Math.abs(a))
    if (!same) diffs.push(`${k}: js ${a} vs py ${b}`)
  }
  bad += diffs.length ? 1 : 0
  console.log(`${diffs.length ? 'DIFF' : 'ok  '}  ${name.padEnd(28)} activity ${js.activity.padEnd(8)} cad ${js.cad_hz == null ? '-' : js.cad_hz.toFixed(2)} pw ${js.cad_pw == null ? '-' : js.cad_pw.toFixed(2)}${diffs.length ? '   ' + diffs.join('; ') : ''}`)
}
console.log(`\n${Object.keys(cases).length - bad}/${Object.keys(cases).length} cases agree (${compared} values compared)`)
process.exit(bad ? 1 : 0)
