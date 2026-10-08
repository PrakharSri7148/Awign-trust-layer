// Where the backend is, first match wins:
//   1. ?api=<url> in the page address (saved, so the next visits keep it; ?api=reset forgets it)
//   2. the address saved earlier (the "Server" field in the demo tools)
//   3. VITE_API_URL at build time
//   4. on desktop http://localhost:8000; from a phone the page host is the dev machine's LAN IP, so the backend is reached on
//      that IP; over HTTPS through the Vite /api proxy.
// Inside the Android APK the page is http://localhost (the phone itself) and there is no Vite proxy, so 1-3 are how the app finds
// the laptop (a LAN or tunnel address changes every run, hence settable at runtime and not only at build time).
export const API_KEY = 'trust.api.base'

export function normalizeBase(url) {
  const s = String(url ?? '').trim().replace(/\/+$/, '')
  if (!s) return null
  if (s.startsWith('/')) return s // a same-origin proxy path such as /api
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? `${u.origin}${u.pathname.replace(/\/+$/, '')}` : null
  } catch {
    return null
  }
}

function readStore(storage, k) {
  try {
    return storage?.getItem(k) ?? null
  } catch {
    return null
  }
}

function writeStore(storage, k, v) {
  try {
    if (v == null) storage?.removeItem(k)
    else storage?.setItem(k, v)
  } catch {
    /* blocked storage: the ?api= value still applies to this page load */
  }
}

export function resolveApiBase({ search = '', storage = null, envUrl = null, location = null } = {}) {
  const q = new URLSearchParams(search).get('api')
  if (q === 'reset') writeStore(storage, API_KEY, null)
  else if (q) {
    const n = normalizeBase(q)
    if (n) {
      writeStore(storage, API_KEY, n)
      return { base: n, source: 'url' }
    }
  }
  const saved = q === 'reset' ? null : normalizeBase(readStore(storage, API_KEY))
  if (saved) return { base: saved, source: 'saved' }
  if (envUrl) return { base: envUrl, source: 'build' }
  if (!location) return { base: 'http://localhost:8000', source: 'default' }
  return { base: location.protocol === 'https:' ? '/api' : `http://${location.hostname}:8000`, source: 'default' }
}

// Reading `localStorage` itself can throw (blocked site data, some private modes): never let that stop the app from starting.
const safeStorage = () => {
  try {
    return typeof window === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

const resolved = resolveApiBase({
  search: globalThis.location?.search ?? '',
  storage: safeStorage(),
  envUrl: import.meta.env?.VITE_API_URL || null,
  location: typeof window === 'undefined' ? null : window.location,
})
export const API_BASE = resolved.base
export const API_SOURCE = resolved.source

// Save a new backend address (null = forget it). The caller reloads the page: every module reads API_BASE once.
export function setApiBase(url, storage = safeStorage()) {
  if (url == null || url === '') {
    writeStore(storage, API_KEY, null)
    return { ok: true, base: null }
  }
  const n = normalizeBase(url)
  if (!n) return { ok: false, error: 'Enter an address such as http://192.168.1.20:8000 or https://name.trycloudflare.com' }
  writeStore(storage, API_KEY, n)
  return { ok: true, base: n }
}

// GET /health on a backend address: { ok, ms } or { ok: false, error }. Used by "Test connection".
export async function checkServer(base, { fetchFn = fetch, timeoutMs = 4000, now = () => Date.now() } = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const t0 = now()
  try {
    const res = await fetchFn(`${base}/health`, { signal: ctl.signal })
    if (!res.ok) return { ok: false, error: `Server responded ${res.status}` }
    const body = await res.json()
    return body?.status === 'ok' ? { ok: true, ms: now() - t0 } : { ok: false, error: 'Reached something, but it is not this backend' }
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? `No answer within ${timeoutMs / 1000} s` : 'Could not reach it (wrong address, server not running, or blocked by CORS)' }
  } finally {
    clearTimeout(timer)
  }
}

// A random challenge list + a single-use nonce for the live check (face-required tasks). Resolves to
// { id, challenges, expires_at, ttl_s, ... }, or null when the server cannot be reached (the camera then shows
// "can't reach the server" and retries; it no longer falls back silently to local challenges).
//
// ONE request per attempt: callers asking for the same worker + task while a request is in flight share it (React
// StrictMode starts the camera twice in development, which used to waste a nonce per attempt).
const inflight = new Map()
export function fetchLivenessChallenge({ workerId, taskId, timeoutMs = 4000, fetchFn = fetch, base = API_BASE }) {
  const key = `${base}|${workerId}|${taskId}`
  if (inflight.has(key)) return inflight.get(key)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const p = (async () => {
    try {
      const res = await fetchFn(`${base}/liveness/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: workerId, task_id: taskId }),
        signal: ctl.signal,
      })
      return res.ok ? await res.json() : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p
}

// Open a visit session with the server (the trail the phone records afterwards must fit inside it by the SERVER's clock, and a
// visit carries one submission). Resolves to { visitId, offsetMs } where offsetMs = server time minus device time (it keeps a
// phone with a wrong clock from looking like a trail "from the future"), or null when the server cannot be reached.
export async function startVisit({ workerId, taskId, siteId, timeoutMs = 4000, fetchFn = fetch, base = API_BASE, now = () => Date.now() }) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const t0 = now()
    const res = await fetchFn(`${base}/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: workerId, task_id: taskId, site_id: siteId }),
      signal: ctl.signal,
    })
    if (!res.ok) return null
    const body = await res.json()
    const t1 = now()
    if (!body?.visit_id || !Number.isFinite(body.server_time_ms)) return null
    return { visitId: body.visit_id, offsetMs: Math.round(body.server_time_ms - (t0 + t1) / 2) }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
