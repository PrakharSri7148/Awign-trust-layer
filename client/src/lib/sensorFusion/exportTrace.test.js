import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SCENARIOS, buildTraceDoc, recordModeOn, traceFileName } from './exportTrace.js'

test('the exported trace is the format the accuracy report reads, with no worker or photo', () => {
  const trail = { v: 1, fixes: [], windows: [] }
  const doc = buildTraceDoc({ scenario: 'walk_to_site', note: 'Pixel 7, Chrome', trail, networkInfo: { effectiveType: '4g' }, userAgent: 'UA', now: new Date('2026-10-08T05:00:00Z') })
  assert.deepEqual(Object.keys(doc).sort(), ['exported_at', 'format', 'network_info', 'note', 'scenario', 'trail', 'user_agent'])
  assert.equal(doc.trail, trail)
  assert.equal(doc.exported_at, '2026-10-08T05:00:00.000Z')
  assert.equal(traceFileName('walk_to_site', 5), 'walk_to_site-5.json')
})

test('the scenario folders match the ones the report looks in', async () => {
  const { execFileSync } = await import('node:child_process')
  const path = await import('node:path')
  const root = path.resolve(import.meta.dirname, '../../../..')
  const py = JSON.parse(execFileSync(path.join(root, 'backend/.venv/bin/python'), ['-c', 'import json; from tools.reportlib import fusion as f; print(json.dumps(list(f.GENUINE_FOLDERS + f.SPOOF_FOLDERS)))'], { cwd: path.join(root, 'backend') }).toString())
  assert.deepEqual(SCENARIOS.map((s) => s[0]), py)
})

test('record mode is only on with ?record=1', () => {
  assert.equal(recordModeOn('?record=1'), true)
  assert.equal(recordModeOn('?x=1&record=1'), true)
  assert.equal(recordModeOn('?record=0'), false)
  assert.equal(recordModeOn(''), false)
})
