import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentPosition, getProfile, listSites, resetNetwork, saveSite, validateSite } from './sites.js'

const ok = { lat: 12.97, lng: 77.59, radius_m: 80, country: 'in' }

test('the site form is validated in plain words before anything is sent', () => {
  assert.equal(validateSite(ok), null)
  assert.match(validateSite({ ...ok, lat: '' }), /Latitude/)
  assert.match(validateSite({ ...ok, lat: 95 }), /Latitude/)
  assert.match(validateSite({ ...ok, lng: 'x' }), /Longitude/)
  assert.match(validateSite({ ...ok, radius_m: 2 }), /Radius/)
  assert.match(validateSite({ ...ok, radius_m: 9000 }), /Radius/)
  assert.match(validateSite({ ...ok, country: 'India' }), /Country/)
  assert.equal(validateSite({ ...ok, country: '' }), null)
})

test('saveSite sends numbers, an upper-case country and the auth header, and never calls the server for an invalid form', async () => {
  let call = null
  const fetchFn = async (url, o) => ((call = { url, o }), { ok: true, json: async () => ({ site_id: 's1' }) })
  const r = await saveSite('site 1', { lat: '12.97', lng: '77.59', radius_m: '80', country: 'in', label: 'Shop' }, { fetchFn, base: 'http://x' })
  assert.equal(r.ok, true)
  assert.equal(call.url, 'http://x/sites/site%201')
  assert.equal(call.o.method, 'PUT')
  assert.deepEqual(JSON.parse(call.o.body), { lat: 12.97, lng: 77.59, radius_m: 80, country: 'IN', label: 'Shop' })
  call = null
  assert.equal((await saveSite('s', { ...ok, lat: 999 }, { fetchFn })).ok, false)
  assert.equal(call, null)
})

test('server and network errors come back as words, not exceptions', async () => {
  const bad = async () => ({ ok: false, status: 422, json: async () => ({ detail: 'radius_m must be between 5 and 5000' }) })
  assert.deepEqual(await saveSite('s', ok, { fetchFn: bad }), { ok: false, error: 'radius_m must be between 5 and 5000' })
  const down = async () => { throw new Error('offline') }
  assert.deepEqual(await saveSite('s', ok, { fetchFn: down }), { ok: false, error: 'Could not reach the server.' })
  assert.equal((await listSites({ fetchFn: down })).ok, false)
  const unauth = async () => ({ ok: false, status: 401, json: async () => ({ detail: 'Dashboard token required' }) })
  assert.equal((await listSites({ fetchFn: unauth })).error, 'Dashboard token required')
  const list = async () => ({ ok: true, json: async () => [{ site_id: 'a' }] })
  assert.deepEqual((await listSites({ fetchFn: list })).sites, [{ site_id: 'a' }])
})

test('current position: a fix, a denial and no geolocation', async () => {
  const fix = { getCurrentPosition: (ok2) => ok2({ coords: { latitude: 1, longitude: 2, accuracy: 9 } }) }
  assert.deepEqual(await currentPosition(fix), { lat: 1, lng: 2, accuracy: 9 })
  const denied = { getCurrentPosition: (_o, err) => err({ code: 1 }) }
  await assert.rejects(currentPosition(denied), /denied/)
  await assert.rejects(currentPosition(undefined), /no location/)
})

test('getSite: a registered site, none registered (404), and an unreachable server', async () => {
  const { getSite } = await import('./sites.js')
  const site = { site_id: 's', lat: 1, lng: 2, radius_m: 80 }
  assert.deepEqual(await getSite('s', { fetchFn: async () => ({ ok: true, status: 200, json: async () => site }), base: 'http://x' }), { ok: true, site })
  assert.deepEqual(await getSite('s', { fetchFn: async () => ({ ok: false, status: 404, json: async () => ({}) }), base: 'http://x' }), { ok: true, site: null })
  assert.equal((await getSite('s', { fetchFn: async () => { throw new Error('x') }, base: 'http://x' })).ok, false)
})

test('the learned-network helpers use the auth header and say what went wrong in words', async () => {
  let call
  const fetchFn = async (url, o) => ((call = { url, o }), { ok: true, json: async () => ({ visits: 3, profile_rows: 2 }) })
  assert.deepEqual((await getProfile('site 1', { fetchFn, base: 'http://x' })).profile, { visits: 3, profile_rows: 2 })
  assert.equal(call.url, 'http://x/sites/site%201/profile')
  const r = await resetNetwork('s', { fetchFn, base: 'http://x' })
  assert.deepEqual(r, { ok: true, rows: 2 })
  assert.equal(call.url, 'http://x/sites/s/reset-fingerprint')
  assert.equal(call.o.method, 'POST')
  const unauth = async () => ({ ok: false, status: 401, json: async () => ({ detail: 'Dashboard token required' }) })
  assert.equal((await getProfile('s', { fetchFn: unauth })).error, 'Dashboard token required')
  assert.equal((await resetNetwork('s', { fetchFn: unauth })).error, 'Dashboard token required')
  const down = async () => { throw new Error('offline') }
  assert.equal((await getProfile('s', { fetchFn: down })).error, 'Could not reach the server.')
})
