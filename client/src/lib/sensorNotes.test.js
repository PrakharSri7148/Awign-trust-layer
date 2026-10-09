import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SENSOR_NOTE, sensorNotesFor } from './sensorNotes.js'

test('notes follow the unavailable readings, in the order GPS, Motion, Network', () => {
  assert.deepEqual(sensorNotesFor({ gps: 'na', motion: 'na', net: 'na' }), [SENSOR_NOTE.gps, SENSOR_NOTE.motion, SENSOR_NOTE.net])
  assert.deepEqual(sensorNotesFor({ gps: 'ok', motion: 'na', net: 'ok' }), ['no motion samples (sensor unavailable or denied)'])
  assert.deepEqual(sensorNotesFor({ gps: 'acq', motion: 'wait', net: 'ok' }), [])
})
