import assert from 'node:assert/strict'
import test from 'node:test'
import { DAY, caseTitle, dayBuckets, deltaPct, filterSubmissions, importanceAverage, lensRows, mapMarkers, needsRows, nextSort, qualitySummary, severity, sortRows, statsOf, statusOf, topSources } from './model.js'

const NOW = new Date('2026-10-09T12:00:00Z').getTime()
const row = (o = {}) => ({ id: 1, worker_id: 'worker_demo_1', task_id: 'task_demo_1', site_id: 'site_a', timestamp: new Date(NOW - 3600_000).toISOString(), status: 'accepted', fraud_probability: 0.1, quality_flags: [], review: null, needs_review: false, review_reasons: [], photo_verdict: 'pass', feature_importances: { photo_quality: 0.2, motion_consistency: 0.5, ambient_fingerprint: 0.3 }, ...o })

test('severity follows the fraud probability: >= 0.8 critical, 0.6 high, 0.4 medium, below that low', () => {
  assert.deepEqual([0.95, 0.8, 0.79, 0.6, 0.59, 0.4, 0.39, 0].map((p) => severity(p).key), ['critical', 'critical', 'high', 'high', 'medium', 'medium', 'low', 'low'])
})

test('status: a reviewed case is Resolved, a case needing a decision is Open, the rest Accepted', () => {
  assert.equal(statusOf(row({ review: { decision: 'approve' }, status: 'flagged' })).key, 'resolved')
  assert.equal(statusOf(row({ needs_review: true })).key, 'open')
  assert.equal(statusOf(row({ status: 'flagged', needs_review: true })).key, 'open')
  assert.equal(statusOf(row()).key, 'accepted')
})

test('KPI lenses filter the same rows the table and the map show', () => {
  const rows = [row({ id: 1, status: 'flagged', fraud_probability: 0.9, site_id: 'a' }), row({ id: 2, fraud_probability: 0.1, site_id: 'a' }), row({ id: 3, fraud_probability: 0.05, site_id: 'b' }), row({ id: 4, fraud_probability: 0.2, site_id: 'b' })]
  assert.deepEqual(lensRows(rows, 'flagged').map((r) => r.id), [1])
  assert.deepEqual(lensRows(rows, 'accepted').map((r) => r.id), [2, 3, 4])
  assert.deepEqual(lensRows(rows, 'avg').map((r) => r.id), [1]) // avg 0.3125: only 0.9 is at or above it
  assert.deepEqual(lensRows(rows, 'rate').map((r) => r.id), [1, 2]) // site a flags 50%, above the 25% overall rate
  assert.equal(statsOf(rows).rate, 0.25)
})

test('actionable first: open before resolved before accepted, then severity, then newest; a header click sorts that column', () => {
  const rows = [row({ id: 1 }), row({ id: 2, needs_review: true, fraud_probability: 0.5 }), row({ id: 3, needs_review: true, fraud_probability: 0.9 }), row({ id: 4, review: { decision: 'approve' } })]
  assert.deepEqual(sortRows(rows, { key: null }).map((r) => r.id), [3, 2, 4, 1])
  assert.deepEqual(sortRows(rows, { key: 'severity', dir: 'asc' }).map((r) => r.id), [1, 4, 2, 3])
  assert.deepEqual(sortRows(rows, { key: 'id', dir: 'desc' }).map((r) => r.id), [4, 3, 2, 1])
})

test('header click cycles desc -> asc -> default, a new column starts at its natural direction', () => {
  assert.deepEqual(nextSort({ key: null, dir: 'desc' }, 'severity'), { key: 'severity', dir: 'desc' })
  assert.deepEqual(nextSort({ key: 'severity', dir: 'desc' }, 'severity'), { key: 'severity', dir: 'asc' })
  assert.deepEqual(nextSort({ key: 'severity', dir: 'asc' }, 'severity', 'time'), { key: 'time', dir: 'desc' })
  assert.deepEqual(nextSort({ key: 'time', dir: 'desc' }, 'worker'), { key: 'worker', dir: 'asc' })
})

test('Needs review: real cases with no decision, flagged and most severe first; demo cases never appear', () => {
  const rows = [row({ id: 1, needs_review: true, fraud_probability: 0.5 }), row({ id: 2, needs_review: true, status: 'flagged', fraud_probability: 0.9 }), row({ id: 3, needs_review: true, review: { decision: 'approve' } }), row({ id: 'demo-1', needs_review: true, status: 'flagged' })]
  assert.deepEqual(needsRows(rows).map((r) => r.id), [2, 1])
})

test('top sources count flagged cases per worker or per site', () => {
  const rows = [row({ status: 'flagged' }), row({ status: 'flagged' }), row({ status: 'flagged', worker_id: 'w2', site_id: 'b' }), row({ worker_id: 'w3' })]
  assert.deepEqual(topSources(rows, 'worker'), [{ key: 'worker_demo_1', count: 2 }, { key: 'w2', count: 1 }])
  assert.deepEqual(topSources(rows, 'site')[0], { key: 'site_a', count: 2 })
})

test('submission filters: status, date range, photo issue and search combine', () => {
  const rows = [row({ id: 10, needs_review: true }), row({ id: 11, timestamp: new Date(NOW - 3 * DAY).toISOString(), quality_flags: ['blur'] }), row({ id: 12, worker_id: 'worker_x', photo_verdict: 'unverified' })]
  assert.deepEqual(filterSubmissions(rows, { status: 'open' }, NOW).map((r) => r.id), [10])
  assert.deepEqual(filterSubmissions(rows, { range: '1' }, NOW).map((r) => r.id), [10, 12])
  assert.deepEqual(filterSubmissions(rows, { photo: 'blur' }, NOW).map((r) => r.id), [11])
  assert.deepEqual(filterSubmissions(rows, { photo: 'unverified' }, NOW).map((r) => r.id), [12])
  assert.deepEqual(filterSubmissions(rows, { search: '#11' }, NOW).map((r) => r.id), [11])
  assert.deepEqual(filterSubmissions(rows, { search: 'worker_x' }, NOW).map((r) => r.id), [12])
})

test('case title says why a case needs a human, preferring the specific reason over the generic one', () => {
  assert.equal(caseTitle(row({ review_reasons: ['fraud_model', 'gps_jump_flat_motion'] })).length > 0, true)
  assert.notEqual(caseTitle(row({ review_reasons: ['fraud_model', 'duplicate_photo'] })), 'Fraud model flagged it')
  assert.equal(caseTitle(row({ review_reasons: ['photo_blocked'] })), 'Photo blocked by the server check')
  assert.equal(caseTitle(row({ status: 'flagged' })), 'Flagged by the fraud model')
  assert.equal(caseTitle(row()), 'Routine check')
})

test('daily buckets and change against the previous period', () => {
  const rows = [row({ timestamp: new Date(NOW - 3600_000).toISOString() }), row({ timestamp: new Date(NOW - 2 * DAY - 3600_000).toISOString() })]
  const b = dayBuckets(rows, (r) => r.length, NOW)
  assert.equal(b.length, 7)
  assert.equal(b[6], 1)
  assert.equal(b[4], 1)
  assert.equal(deltaPct(40, 37), 8)
  assert.equal(deltaPct(5, 0), null)
})

test('chart numbers: signal importance average, photo quality verdicts and the most common flags', () => {
  const rows = [row({ quality_flags: ['blur', 'duplicate_photo'], photo_quality_score: 0.5, photo_verdict: 'warn' }), row({ quality_flags: ['blur'], photo_quality_score: 0.9, photo_override: true })]
  const q = qualitySummary(rows)
  assert.equal(q.flags[0].key, 'blur')
  assert.equal(q.flags[0].value, 2)
  assert.equal(q.dupes, 1)
  assert.equal(q.overrides, 1)
  assert.equal(Math.round(q.avgQuality * 100), 70)
  assert.equal(q.verdicts.find((v) => v.key === 'warn').value, 1)
  assert.equal(Math.round(importanceAverage(rows).find((f) => f.key === 'motion_consistency').value), 50)
})

test('map markers sit on the registered site; unknown sites and sites outside the view are counted, not drawn', () => {
  const sites = new Map([['site_a', { site_id: 'site_a', lat: 12.93, lng: 77.62 }], ['site_far', { site_id: 'site_far', lat: 51.5, lng: -0.1 }]])
  const rows = [row({ id: 1, fraud_probability: 0.9 }), row({ id: 2, fraud_probability: 0.1 }), row({ id: 3, site_id: 'site_far' }), row({ id: 4, site_id: 'nowhere' })]
  const m = mapMarkers(rows, sites, 'asia')
  assert.equal(m.markers.length, 2)
  assert.equal(m.outside, 1)
  assert.equal(m.unplaced, 1)
  assert.equal(m.markers[0].row.id, 1) // the most severe sits at the centre
  assert.equal(m.markers[0].dx, 0)
  assert.equal(mapMarkers(rows, sites, 'asia', new Set(['low'])).markers.length, 1) // legend chip hides low
  assert.equal(mapMarkers(rows, sites, 'world').outside, 0)
})
