// On desktop this is http://localhost:8000. From a phone, the page host is the
// dev machine's LAN IP, so the backend is reached on that IP. Over HTTPS we go
// through the Vite /api proxy instead. VITE_API_URL overrides everything.
export const API_BASE =
  import.meta.env?.VITE_API_URL ||
  (typeof window === 'undefined' ? 'http://localhost:8000' : window.location.protocol === 'https:' ? '/api' : `http://${window.location.hostname}:8000`)

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
