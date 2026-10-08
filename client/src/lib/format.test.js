import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FLAG_META, VERDICT_META, flagMeta, matchesPhoto, pct } from './format.js'
import { seedMock } from './mock.js'
import { CHECK_IDS } from './photoQuality/schema.js'
import thresholds from './photoQuality/thresholds.json' with { type: 'json' }

test('every photo check id has a plain-language flag the dashboard can show', () => {
  for (const id of CHECK_IDS) assert.ok(FLAG_META[id], `no flag text for check "${id}"`)
})

test('unknown and parametrised flags still get readable text', () => {
  assert.equal(flagMeta('client_missed_blur').label, 'Device missed: blur')
  assert.equal(flagMeta('client_missed_blur').kind, 'integrity')
  assert.equal(flagMeta('some_new_flag').label, 'some new flag')
  assert.equal(flagMeta('some_new_flag').kind, 'info')
})

test('integrity concerns are distinguished from photo problems and plain context', () => {
  assert.equal(flagMeta('blur').kind, 'quality')
  assert.equal(flagMeta('duplicate_photo').kind, 'integrity')
  assert.equal(flagMeta('not_live_capture').kind, 'integrity')
  assert.equal(flagMeta('no_exif').kind, 'info')
})

test('verdicts map to a label and a tone', () => {
  assert.deepEqual(Object.keys(VERDICT_META), ['pass', 'warn', 'block', 'unverified'])
  assert.equal(VERDICT_META.block.tone, 'red')
})

test('photo filter: all / any issue / unverified / a specific flag', () => {
  const ok = { photo_verdict: 'pass', quality_flags: [] }
  const blurry = { photo_verdict: 'block', quality_flags: ['blur', 'no_exif'] }
  const dup = { photo_verdict: 'pass', quality_flags: ['duplicate_photo'] }
  const none = { photo_verdict: 'unverified', quality_flags: ['photo_missing'] }
  const legacy = { photo_verdict: 'pass' } // rows from before the feature
  const rows = [ok, blurry, dup, none, legacy]
  const pick = (f) => rows.filter((r) => matchesPhoto(r, f))
  assert.equal(pick('all').length, 5)
  assert.deepEqual(pick('any'), [blurry, dup, none])
  assert.deepEqual(pick('unverified'), [none])
  assert.deepEqual(pick('blur'), [blurry])
  assert.deepEqual(pick('duplicate_photo'), [dup])
})

test('demo rows carry the same photo fields the server sends', () => {
  const rows = seedMock(60)
  for (const r of rows) {
    assert.ok(r.photo_verdict in VERDICT_META)
    assert.ok(Array.isArray(r.quality_flags))
    assert.ok(r.photo_quality_score >= 0 && r.photo_quality_score <= 1)
    for (const f of r.quality_flags) assert.ok(FLAG_META[f] || /^client_/.test(f), `unmapped demo flag ${f}`)
  }
  assert.ok(rows.some((r) => r.photo_verdict !== 'pass'), 'demo data should show some photo problems')
})

test('every threshold group the dashboard/calibration relies on exists', () => {
  for (const g of ['blur', 'exposure', 'resolution', 'noise', 'glare', 'shake', 'obstruction', 'face', 'live'])
    assert.ok(thresholds.thresholds[g], g)
  assert.equal(pct(0.1234), '12.3%')
})

// ---- formatMetric: the post-capture checklist uses the HUD's words --------------------------
import { formatMetric } from './format.js'

const chk = (value, details = {}, status = 'pass') => ({ status, value, details })

test('formatMetric reads each check from the field it actually lives in', () => {
  assert.equal(formatMetric('blur', chk(0.45)), 'Focus 100%')
  assert.equal(formatMetric('blur', chk(0.2125)), 'Focus 46%') // same ramp as the live bar: (0.2125-0.05)/0.35 = 46.4%
  assert.equal(formatMetric('blur', chk(null)), 'Focus —') // flat scene
  assert.equal(formatMetric('exposure', chk(127.5, { clippedFrac: 0 })), 'Brightness 50%')
  assert.equal(formatMetric('resolution', chk(2.07, { width: 1920, height: 1080 })), '1920×1080') // value is megapixels
  assert.equal(formatMetric('noise', chk(2.14)), 'σ 2.1')
  assert.equal(formatMetric('obstruction', chk(0.01, { fullCover: false })), 'Lens clear')
  assert.equal(formatMetric('obstruction', chk(0.18, { fullCover: false })), 'Lens partly 18%')
  assert.equal(formatMetric('obstruction', chk(0.9, { fullCover: true })), 'Lens covered')
  assert.equal(formatMetric('glare', chk(0.004)), 'Glare 0.4%')
  assert.equal(formatMetric('shake', chk(1.1, { sensor: { rotRms: 5.2 } })), '5°/s')
  assert.equal(formatMetric('shake', chk(1.1, {})), 'no sensor') // a picked file has no sensor
  assert.equal(formatMetric('face', chk(0.21, { count: 1, score: 0.92, heightFrac: 0.21 })), '92% · 21%')
  assert.equal(formatMetric('face', chk(0, { count: 0 })), 'not found')
  assert.equal(formatMetric('face', chk(null, { unchecked: true })), 'unchecked')
})

test('formatMetric has nothing to say about skipped or unknown checks', () => {
  assert.equal(formatMetric('blur', { status: 'skip', details: {} }), null)
  assert.equal(formatMetric('blur', undefined), null)
  assert.equal(formatMetric('nope', chk(1)), null)
})
