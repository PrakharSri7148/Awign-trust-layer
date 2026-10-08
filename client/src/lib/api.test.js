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

// ---------------------------------------------------------------- where the backend is (H1: the APK has no Vite proxy)
import { API_KEY, checkServer, normalizeBase, resolveApiBase, setApiBase } from './api.js'

const memStore = (init = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }
}

test('?api= wins, is normalised and is saved for the next page load', () => {
  const storage = memStore()
  const r = resolveApiBase({ search: '?api=http://192.168.1.20:8000/', storage, envUrl: 'http://build:8000', location: { protocol: 'http:', hostname: 'localhost' } })
  assert.deepEqual(r, { base: 'http://192.168.1.20:8000', source: 'url' })
  assert.equal(storage.m.get(API_KEY), 'http://192.168.1.20:8000')
  assert.deepEqual(resolveApiBase({ search: '', storage, envUrl: 'http://build:8000' }), { base: 'http://192.168.1.20:8000', source: 'saved' })
})

test('?api=reset forgets the saved address; then the build setting, then the page-host default apply', () => {
  const storage = memStore({ [API_KEY]: 'http://old:8000' })
  assert.deepEqual(resolveApiBase({ search: '?api=reset', storage, envUrl: 'http://build:8000' }), { base: 'http://build:8000', source: 'build' })
  assert.equal(storage.m.has(API_KEY), false)
  assert.equal(resolveApiBase({ storage, location: { protocol: 'http:', hostname: '10.0.0.5' } }).base, 'http://10.0.0.5:8000')
  assert.equal(resolveApiBase({ storage, location: { protocol: 'https:', hostname: '10.0.0.5' } }).base, '/api')
  assert.equal(resolveApiBase({}).base, 'http://localhost:8000')
})

test('a junk ?api= or saved value is ignored, never used as an address', () => {
  const storage = memStore({ [API_KEY]: 'javascript:alert(1)' })
  const r = resolveApiBase({ search: '?api=ftp://x', storage, location: { protocol: 'http:', hostname: 'localhost' } })
  assert.deepEqual(r, { base: 'http://localhost:8000', source: 'default' })
  assert.equal(normalizeBase('  https://a.trycloudflare.com/// '), 'https://a.trycloudflare.com')
  assert.equal(normalizeBase('/api/'), '/api')
  assert.equal(normalizeBase(''), null)
})

test('blocked storage does not break address resolution', () => {
  const storage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  assert.equal(resolveApiBase({ search: '?api=http://x:8000', storage }).base, 'http://x:8000')
  assert.equal(resolveApiBase({ storage, envUrl: 'http://b' }).base, 'http://b')
})

test('setApiBase validates and can forget', () => {
  const storage = memStore()
  assert.equal(setApiBase('not a url', storage).ok, false)
  assert.deepEqual(setApiBase('http://192.168.0.9:8000/', storage), { ok: true, base: 'http://192.168.0.9:8000' })
  assert.equal(storage.m.get(API_KEY), 'http://192.168.0.9:8000')
  setApiBase(null, storage)
  assert.equal(storage.m.has(API_KEY), false)
})

test('checkServer: ok with timing, a wrong service, an HTTP error and an unreachable host', async () => {
  let t = 0
  const now = () => (t += 25)
  assert.deepEqual(await checkServer('http://x', { fetchFn: reply({ status: 'ok' }), now }), { ok: true, ms: 25 })
  assert.equal((await checkServer('http://x', { fetchFn: reply({ hello: 1 }) })).ok, false)
  assert.match((await checkServer('http://x', { fetchFn: async () => ({ ok: false, status: 502 }) })).error, /502/)
  assert.match((await checkServer('http://x', { fetchFn: async () => { throw new TypeError('fail') } })).error, /Could not reach/)
})
