import assert from 'node:assert/strict'
import test from 'node:test'
import { DBIP_CREDIT, describeIpDatabase } from './ipDatabase.js'

test('nothing known yet is not a warning', () => {
  for (const v of [null, undefined, 'x', 3]) assert.deepEqual(describeIpDatabase(v), { state: 'unknown', label: null, detail: null, credit: false })
})

test('a missing database says so and shows no credit (no DB-IP data is shown)', () => {
  const d = describeIpDatabase({ installed: false })
  assert.equal(d.state, 'missing')
  assert.equal(d.label, 'IP database not installed')
  assert.equal(d.credit, false)
  assert.match(d.detail, /fetch_geoip/)
})

test('a fresh database shows the credit and its data date', () => {
  const d = describeIpDatabase({ installed: true, date: '2026-10-01', age_days: 7, stale: false })
  assert.equal(d.state, 'ok')
  assert.equal(d.credit, true)
  assert.match(d.detail, /2026-10-01, 7 days old/)
})

test('an old database warns and still shows the credit', () => {
  const d = describeIpDatabase({ installed: true, date: '2026-01-01', age_days: 99, stale: true })
  assert.equal(d.state, 'stale')
  assert.match(d.detail, /99 days old/)
  assert.equal(d.credit, true)
})

test('the credit is text with a plain link to DB-IP', () => {
  assert.deepEqual(DBIP_CREDIT, { text: 'IP Geolocation by DB-IP', url: 'https://db-ip.com' })
})
