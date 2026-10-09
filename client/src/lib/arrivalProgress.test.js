import assert from 'node:assert/strict'
import { test } from 'node:test'
import { arrivalProgress } from './arrivalProgress.js'

test('nothing resolved yet', () => {
  assert.deepEqual(arrivalProgress({ gps: 'acq', motion: 'acq', net: 'acq', trail: 'acq' }, 3000), { done: 0, pct: 0, all: false, anyNa: false })
})
test('mid-way: three locked, motion counting down adds part of its quarter, below 100', () => {
  const p = arrivalProgress({ gps: 'ok', motion: 'acq', net: 'ok', trail: 'ok' }, 1400)
  assert.equal(p.done, 3)
  assert.ok(p.pct > 75 && p.pct < 100, String(p.pct))
})
test('the bar never reaches 100 before the last reading, even at 0.0 s', () => {
  assert.ok(arrivalProgress({ gps: 'ok', motion: 'acq', net: 'ok', trail: 'ok' }, 0).pct < 100)
})
test('all four resolved: 100, and anyNa is true when one is unavailable', () => {
  assert.deepEqual(arrivalProgress({ gps: 'na', motion: 'ok', net: 'ok', trail: 'ok' }), { done: 4, pct: 100, all: true, anyNa: true })
  assert.equal(arrivalProgress({ gps: 'ok', motion: 'ok', net: 'ok', trail: 'ok' }).anyNa, false)
})
