import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchLivenessChallenge, startVisit } from './api.js'

const reply = (body, ok = true) => async () => ({ ok, json: async () => body })

test('two callers asking for the same worker + task at once share ONE request (one nonce per attempt)', async () => {
  let calls = 0
  const fetchFn = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return { ok: true, json: async () => ({ id: 'n1', challenges: ['blink', 'smile'] }) } }
  const [a, b] = await Promise.all([
    fetchLivenessChallenge({ workerId: 'w', taskId: 't', fetchFn, base: 'http://x' }),
    fetchLivenessChallenge({ workerId: 'w', taskId: 't', fetchFn, base: 'http://x' }),
  ])
  assert.equal(calls, 1)
  assert.equal(a.id, 'n1')
  assert.equal(b, a)
})

test('after the first request settles, the next attempt asks again (a fresh nonce)', async () => {
  let calls = 0
  const fetchFn = async () => { calls++; return { ok: true, json: async () => ({ id: `n${calls}` }) } }
  const first = await fetchLivenessChallenge({ workerId: 'w', taskId: 't', fetchFn, base: 'http://y' })
  const second = await fetchLivenessChallenge({ workerId: 'w', taskId: 't', fetchFn, base: 'http://y' })
  assert.deepEqual([first.id, second.id], ['n1', 'n2'])
})

test('different workers or tasks never share a request', async () => {
  let calls = 0
  const fetchFn = async () => { calls++; return { ok: true, json: async () => ({ id: String(calls) }) } }
  await Promise.all([
    fetchLivenessChallenge({ workerId: 'w1', taskId: 't', fetchFn, base: 'http://z' }),
    fetchLivenessChallenge({ workerId: 'w2', taskId: 't', fetchFn, base: 'http://z' }),
  ])
  assert.equal(calls, 2)
})

test('an unreachable server resolves to null (the camera then says so) and an error status too', async () => {
  const down = async () => { throw new Error('offline') }
  assert.equal(await fetchLivenessChallenge({ workerId: 'w', taskId: 't', fetchFn: down, base: 'http://d' }), null)
  assert.equal(await fetchLivenessChallenge({ workerId: 'w', taskId: 't', fetchFn: reply({}, false), base: 'http://d' }), null)
})

test('the request times out instead of hanging', async () => {
  const hang = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))))
  assert.equal(await fetchLivenessChallenge({ workerId: 'w', taskId: 't', fetchFn: hang, base: 'http://h', timeoutMs: 30 }), null)
})

test('startVisit returns the visit id and the server-minus-device clock offset', async () => {
  let t = 1_000_000
  const fetchFn = async (url, opts) => {
    assert.match(url, /\/visits$/)
    assert.deepEqual(JSON.parse(opts.body), { worker_id: 'w', task_id: 't', site_id: 's' })
    t += 200 // the round trip takes 200 ms; the server stamped its clock in the middle of it
    return { ok: true, json: async () => ({ visit_id: 'v1', server_time_ms: 1_000_000 + 100 + 90_000 }) }
  }
  const v = await startVisit({ workerId: 'w', taskId: 't', siteId: 's', fetchFn, base: 'http://x', now: () => t })
  assert.deepEqual(v, { visitId: 'v1', offsetMs: 90_000 })
})

test('startVisit gives null (not an exception) when the server is down, refuses, or answers nonsense', async () => {
  const args = { workerId: 'w', taskId: 't', siteId: 's', base: 'http://x' }
  assert.equal(await startVisit({ ...args, fetchFn: async () => { throw new Error('offline') } }), null)
  assert.equal(await startVisit({ ...args, fetchFn: async () => ({ ok: false }) }), null)
  assert.equal(await startVisit({ ...args, fetchFn: async () => ({ ok: true, json: async () => ({}) }) }), null)
  assert.equal(await startVisit({ ...args, timeoutMs: 10, fetchFn: (_u, o) => new Promise((_r, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))) }), null)
})
