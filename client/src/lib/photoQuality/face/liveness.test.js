import assert from 'node:assert/strict'
import { test } from 'node:test'
import { THRESHOLDS } from '../config.js'
import { CHALLENGE_TYPES, createChallengeRun, createLivenessSession, pickChallenges } from './liveness.js'

const L = THRESHOLDS.liveness
const base = { face: true, blink: 0.05, smile: 0.05, jaw: 0.02, yaw: 0 }
// A scripted timeline: one sample every `dt` ms, `fn(t)` overrides the neutral face.
const line = (fn, from = 0, to = 6000, dt = 100) => {
  const out = []
  for (let t = from; t <= to; t += dt) out.push({ t, ...base, ...fn(t) })
  return out
}
const play = (ids, samples) => {
  const r = createChallengeRun(ids, { startT: 0 })
  let snap = r.snapshot(0)
  for (const s of samples) snap = r.push(s)
  return { snap, run: r }
}
// signal windows: [from, to) -> value
const window = (key, from, to, value) => (t) => (t >= from && t < to ? { [key]: value } : {})
const merge = (...fns) => (t) => Object.assign({}, ...fns.map((f) => f(t)))

test('a blink then a smile, in order, passes within a few seconds', () => {
  const fn = merge(window('blink', 700, 900, 0.85), window('smile', 2000, 2700, 0.8))
  const { snap, run } = play(['blink', 'smile'], line(fn, 0, 4000))
  assert.equal(snap.phase, 'passed')
  assert.deepEqual(snap.results.map((r) => [r.id, r.status]), [['blink', 'pass'], ['smile', 'pass']])
  assert.ok(snap.results[1].t1 < 4000)
  const ev = run.evidence()
  assert.equal(ev.status, 'passed')
  assert.deepEqual(ev.challenges, ['blink', 'smile'])
  assert.ok(ev.timeline.length > 20 && ev.timeline.every((x) => x.length === 6))
})

test('no movement at all: the first challenge times out and the attempt fails', () => {
  const { snap } = play(['blink', 'smile'], line(() => ({}), 0, 5000))
  assert.equal(snap.phase, 'failed')
  assert.equal(snap.results.length, 1)
  assert.equal(snap.results[0].status, 'timeout')
  assert.match(snap.reason, /blink/)
})

test('a photo: a static smiling face (never neutral) cannot pass a smile challenge', () => {
  const { snap } = play(['smile'], line(() => ({ smile: 0.9 }), 0, 5000))
  assert.equal(snap.phase, 'failed')
  assert.equal(snap.results[0].status, 'timeout')
})

test('eyes held open never blink; eyes held closed never become neutral', () => {
  assert.equal(play(['blink'], line(() => ({ blink: 0.05 }), 0, 5000)).snap.phase, 'failed')
  assert.equal(play(['blink'], line(() => ({ blink: 0.9 }), 0, 5000)).snap.phase, 'failed')
})

test('closing the eyes for longer than a blink does not count, even when they reopen', () => {
  const fn = window('blink', 600, 2400, 0.9) // 1.8 s shut
  const { snap } = play(['blink'], line(fn, 0, 3800))
  assert.notEqual(snap.results[0]?.status, 'pass')
})

test('wrong order: smiling during the blink window does not count, and a smile held from before is not neutral -> active', () => {
  // challenges [blink, smile]; the person smiles first and keeps smiling, blinks at 1.2 s
  const fn = merge(window('smile', 0, 6000, 0.85), window('blink', 1200, 1400, 0.9))
  const { snap } = play(['blink', 'smile'], line(fn, 0, 6000))
  assert.equal(snap.results[0].status, 'pass') // the blink is honoured
  assert.equal(snap.results[1].status, 'timeout') // but the smile was never neutral -> active
  assert.equal(snap.phase, 'failed')
})

test('doing the SECOND action first does not skip the first', () => {
  const fn = merge(window('smile', 300, 1500, 0.9)) // smile now, no blink
  const { snap } = play(['blink', 'smile'], line(fn, 0, 5000))
  assert.equal(snap.phase, 'failed')
  assert.equal(snap.results[0].id, 'blink')
})

test('open mouth needs the jaw open for the hold time, a flicker is not enough', () => {
  assert.equal(play(['open_mouth'], line(window('jaw', 800, 950, 0.7), 0, 3500)).snap.phase, 'running') // 150 ms < hold
  assert.equal(play(['open_mouth'], line(window('jaw', 800, 1500, 0.7), 0, 3500)).snap.phase, 'passed')
})

test('turn challenges are directional and need a neutral start', () => {
  const left = window('yaw', 800, 1500, 32) // positive = user\'s left
  assert.equal(play(['turn_left'], line(left, 0, 3500)).snap.phase, 'passed')
  assert.equal(play(['turn_right'], line(left, 0, 5000)).snap.phase, 'failed') // wrong way
  assert.equal(play(['turn_right'], line(window('yaw', 800, 1500, -32), 0, 3500)).snap.phase, 'passed')
  assert.equal(play(['turn_left'], line(() => ({ yaw: 35 }), 0, 5000)).snap.phase, 'failed') // already turned
})

test('losing the face for a while resets the action to neutral', () => {
  // smile starts, face disappears for 1.4 s, comes back still smiling: must go neutral again first
  const fn = (t) => (t >= 500 && t < 800 ? { smile: 0.9 } : t >= 800 && t < 2200 ? { face: false } : t >= 2200 ? { smile: 0.9 } : {})
  const { snap } = play(['smile'], line(fn, 0, 5000))
  assert.equal(snap.phase, 'failed')
})

test('the snapshot drives the on-screen prompt and countdown', () => {
  const { snap } = play(['blink', 'smile'], line(() => ({}), 0, 1000))
  assert.equal(snap.phase, 'running')
  assert.equal(snap.current.prompt, 'Blink your eyes')
  assert.ok(snap.current.remainingMs > 2900 && snap.current.remainingMs <= 3100)
  assert.equal(snap.total, 2)
  assert.equal(snap.index, 0)
})

test('the evidence timeline is capped', () => {
  const r = createChallengeRun(['blink'], { startT: 0, L: { ...L, evidence: { maxSamples: 20 }, timeoutMs: 60000 } })
  for (const s of line(() => ({}), 0, 10000, 50)) r.push(s)
  assert.equal(r.evidence().timeline.length, 20)
})

test('pickChallenges: distinct kinds, deterministic for a seed, never blink+blink or turn_left+turn_right', () => {
  let x = 7
  const seeded = () => (x = (x * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 200; i++) {
    const [a, b] = pickChallenges(seeded)
    assert.notEqual(CHALLENGE_TYPES[a].group, CHALLENGE_TYPES[b].group)
  }
  const mk = () => { let y = 3; return () => (y = (y * 16807) % 2147483647) / 2147483647 }
  assert.deepEqual(pickChallenges(mk()), pickChallenges(mk()))
  const seen = new Set()
  for (let i = 0; i < 300; i++) pickChallenges(seeded).forEach((c) => seen.add(c))
  assert.equal(seen.size, 5) // every challenge can be drawn
})

test('session: a pass is valid for a limited time; failures count towards "send for review"', () => {
  let clock = 1000
  const s = createLivenessSession({ now: () => clock, random: () => 0.1 })
  s.start({ challenges: ['smile'], nonce: 'n1', startT: 0 })
  let snap
  for (const x of line(window('smile', 800, 1500, 0.9), 0, 2500)) { clock = x.t; snap = s.push(x) }
  assert.equal(snap.phase, 'passed')
  assert.equal(s.state().valid, true)
  assert.equal(s.state().evidence.nonce, 'n1')
  clock += L.validForMs + 1
  assert.equal(s.state().valid, false) // the photo must be taken soon after the challenge

  // three failed attempts exhaust the retries
  const f = createLivenessSession({ now: () => clock })
  f.start({ challenges: ['blink'], startT: 0 })
  for (let a = 1; a <= L.maxAttempts; a++) {
    for (const x of line(() => ({}), 0, 5000)) f.push({ ...x, t: x.t })
    assert.equal(f.attempts(), a)
    if (a < L.maxAttempts) { assert.equal(f.canRetry(), true); f.retry({ challenges: ['blink'], startT: 0 }) }
  }
  assert.equal(f.canRetry(), false)
  f.requestReview()
  assert.equal(f.state().reviewRequested, true)
  assert.equal(f.state().evidence.status, 'failed')
})

// ---- Phase 8d: say WHY an attempt failed -----------------------------------------------------------------
import { createChallengeRun as _run } from './liveness.js'
const NEUT = { face: true, blink: 0.05, smile: 0.05, jaw: 0.02, yaw: 0 }
const feed = (run, from, to, s, step = 70) => { for (let t = from; t <= to; t += step) run.push({ t, ...s }) }

test('failure reason: a face that left the frame says so', () => {
  const run = _run(['smile', 'blink'], { startT: 0 })
  feed(run, 0, 500, NEUT)
  feed(run, 570, 4200, { ...NEUT, face: false })
  assert.match(run.snapshot().reason, /face left the frame/)
})

test('failure reason: never relaxed (held smile) asks for a relaxed face first', () => {
  const run = _run(['smile', 'blink'], { startT: 0 })
  feed(run, 0, 4200, { ...NEUT, smile: 0.9 })
  assert.match(run.snapshot().reason, /relaxed face first/)
})

test('failure reason: too little movement asks for a bigger action', () => {
  const run = _run(['smile', 'blink'], { startT: 0 })
  feed(run, 0, 4200, { ...NEUT, smile: 0.3 }) // above neutral level? stays in a grey zone
  const r = run.snapshot().reason
  assert.ok(/too little movement|relaxed face first/.test(r), r)
})
