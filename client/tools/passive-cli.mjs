// Reads a JSON file of gray images [{ name, w, h, gray: [numbers] }] and prints the JS passive metrics for each as JSON.
// Used by backend/tests/test_passive.py to pin the Python port to this implementation.
//   node tools/passive-cli.mjs <file.json>
import fs from 'node:fs'
import { bezelMetrics } from '../src/lib/photoQuality/passive/bezel.js'
import { moireMetrics } from '../src/lib/photoQuality/passive/moire.js'

const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const out = {}
for (const it of items) {
  const g = Float32Array.from(it.gray)
  const m = moireMetrics(g, it.w, it.h)
  const b = bezelMetrics(g, it.w, it.h)
  out[it.name] = { moire: { score: m.score, peaks: m.peaks, n: m.n }, bezel: { score: b.score, consistent: b.consistent, sides: b.sides } }
}
process.stdout.write(JSON.stringify(out))
