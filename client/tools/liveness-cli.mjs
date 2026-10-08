// Replays scripted timelines through the JS challenge state machine and prints the results as JSON.
// Used by backend/tests/test_liveness_server.py to pin the Python port to this implementation.
//   node tools/liveness-cli.mjs <file.json>   ([{ name, challenges, samples: [{t, face, blink, smile, jaw, yaw}] }])
import fs from 'node:fs'
import { createChallengeRun } from '../src/lib/photoQuality/face/liveness.js'

const out = {}
for (const c of JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))) {
  const run = createChallengeRun(c.challenges, { startT: 0 })
  for (const s of c.samples) run.push(s)
  const snap = run.snapshot()
  out[c.name] = { phase: snap.phase, results: snap.results }
}
process.stdout.write(JSON.stringify(out))
