import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activity, cadence, roundWindow, windowFeatures } from './windows.js'
import { scriptedCases, signal } from './testing/signals.js'

test('a 1.9 Hz walk is found: cadence, strength, energy and the walking label', () => {
  const f = windowFeatures(signal({ f: 1.9, amp: 2, noise: 0.2, gyro: 30 }))
  assert.ok(Math.abs(f.cad_hz - 1.9) < 0.2, `cad ${f.cad_hz}`)
  assert.ok(f.cad_pw > 0.5 && f.acc_rms > 1 && Math.abs(f.hz - 50) < 1)
  assert.equal(activity(f), 'walking')
})

test('the rhythm does not depend on how the phone is held (energy on any axis)', () => {
  const rot = (s) => s.map((p) => ({ ...p, x: p.z, y: p.x, z: p.y }))
  const a = windowFeatures(signal({ f: 1.9, amp: 2, noise: 0.1 }))
  const b = windowFeatures(rot(signal({ f: 1.9, amp: 2, noise: 0.1 })))
  assert.ok(Math.abs(a.cad_hz - b.cad_hz) < 1e-9 && Math.abs(a.cad_pw - b.cad_pw) < 1e-9)
})

test('a flat signal is still with no cadence; hand tremor is still; vehicle vibration is moving, not walking', () => {
  const flat = windowFeatures(signal({ noise: 0, gyro: 0 }))
  assert.equal(flat.cad_hz, null)
  assert.equal(activity(flat), 'still')
  assert.equal(activity(windowFeatures(signal({ noise: 0.04, gyro: 2 }))), 'still')
  assert.equal(activity(windowFeatures(signal({ noise: 0.3, gyro: 4 }))), 'moving')
})

test('a low sensor rate cannot judge rhythm but the energy still counts (not "still")', () => {
  const f = windowFeatures(signal({ f: 1.9, amp: 2, hz: 10 }))
  assert.equal(f.cad_hz, null)
  assert.equal(activity(f), 'moving')
})

test('no sensor is unknown, never still: all-null events, empty input, and gyro-only', () => {
  const nul = windowFeatures(signal({ nulls: true }))
  assert.equal(nul.n, 0)
  assert.equal(nul.acc_rms, null)
  assert.equal(activity(nul), 'unknown')
  assert.equal(activity(windowFeatures([])), 'unknown')
  const gyroOnly = windowFeatures(signal({ f: 1.9, amp: 2, gyro: 40 }).map((s) => ({ ...s, x: null, y: null, z: null })))
  assert.equal(gyroOnly.acc_rms, null)
  assert.equal(activity(gyroOnly), 'moving')
})

test('a window shorter than 3 s has no cadence', () => {
  assert.equal(windowFeatures(signal({ f: 1.9, amp: 2, secs: 2 })).cad_hz, null)
  assert.deepEqual(cadence([], [[], [], []], null), [null, null])
})

test('malformed samples are skipped instead of throwing', () => {
  const f = windowFeatures([null, undefined, {}, { t: 'x' }, { t: 1, x: NaN, y: 0, z: 0 }, { t: 2, x: 1, y: 0, z: 0 }, { t: 3, x: 1, y: 0, z: 0 }])
  assert.equal(f.n, 2)
  assert.ok(Math.abs(f.acc_rms - 1) < 1e-9)
})

test('activity thresholds sit where fusion.json says (boundaries)', () => {
  assert.equal(activity({ acc_rms: 0.149, gyro_rms: 7.9 }), 'still')
  assert.equal(activity({ acc_rms: 0.15, gyro_rms: 1 }), 'moving')
  assert.equal(activity({ acc_rms: 0.05, gyro_rms: 8 }), 'moving')
  assert.equal(activity({ acc_rms: 0.7, gyro_rms: 10, cad_pw: 0.35, cad_hz: 1.2 }), 'walking')
  assert.equal(activity({ acc_rms: 0.7, gyro_rms: 10, cad_pw: 0.34, cad_hz: 1.9 }), 'moving')
  assert.equal(activity({ acc_rms: 0.5, gyro_rms: 10, cad_pw: 0.9, cad_hz: 1.9 }), 'moving') // too little energy to be a step
  assert.equal(activity({ acc_rms: 2, gyro_rms: 10, cad_pw: 0.9, cad_hz: 3.0 }), 'moving') // outside the walking band
})

test('every scripted case is deterministic and wire-safe after rounding', () => {
  for (const [name, s] of Object.entries(scriptedCases())) {
    const a = windowFeatures(s)
    assert.deepEqual(a, windowFeatures(s), name)
    const w = roundWindow(1, 2, a)
    assert.ok(Object.values(w).every((v) => v === null || Number.isFinite(v)), name)
  }
})
