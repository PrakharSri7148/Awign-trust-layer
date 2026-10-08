// Where a site really is (the "claimed area"): the arrival, outside-the-site and IP-distance checks need it. Thin helpers around
// GET/PUT /sites (backend/main.py) so the dashboard form and the "register this spot" button share one validation.
import { API_BASE } from '../api.js'
import { authHeaders } from '../auth.js'

export function validateSite({ lat, lng, radius_m: r, country }) {
  const la = Number(lat)
  const ln = Number(lng)
  if (lat === '' || lat == null || !Number.isFinite(la) || la < -90 || la > 90) return 'Latitude must be a number between -90 and 90.'
  if (lng === '' || lng == null || !Number.isFinite(ln) || ln < -180 || ln > 180) return 'Longitude must be a number between -180 and 180.'
  const rad = Number(r)
  if (!Number.isFinite(rad) || rad < 5 || rad > 5000) return 'Radius must be between 5 and 5000 metres.'
  if (country && !/^[A-Za-z]{2}$/.test(String(country).trim())) return 'Country must be a two-letter code (for example IN), or empty.'
  return null
}

const msg = async (res) => {
  try {
    const b = await res.json()
    return typeof b.detail === 'string' ? b.detail : `Server responded ${res.status}`
  } catch {
    return `Server responded ${res.status}`
  }
}

export async function listSites({ fetchFn = fetch, base = API_BASE } = {}) {
  try {
    const res = await fetchFn(`${base}/sites`, { headers: authHeaders() })
    return res.ok ? { ok: true, sites: await res.json() } : { ok: false, error: await msg(res) }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}

export async function saveSite(siteId, body, { fetchFn = fetch, base = API_BASE } = {}) {
  const err = validateSite(body)
  if (err) return { ok: false, error: err }
  try {
    const res = await fetchFn(`${base}/sites/${encodeURIComponent(siteId)}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        lat: Number(body.lat), lng: Number(body.lng), radius_m: Number(body.radius_m),
        country: body.country ? String(body.country).trim().toUpperCase() : null, label: body.label ? String(body.label).trim() || null : null,
        // only sent when asked: a save must never forget (or keep) the learned network by accident
        ...(body.reset_network ? { reset_network: true } : {}),
      }),
    })
    return res.ok ? { ok: true, site: await res.json() } : { ok: false, error: await msg(res) }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}

// One site's registered location: { ok, site } , { ok: true, site: null } when none is registered, or { ok: false, error }.
export async function getSite(siteId, { fetchFn = fetch, base = API_BASE } = {}) {
  try {
    const res = await fetchFn(`${base}/sites/${encodeURIComponent(siteId)}`, { headers: authHeaders() })
    if (res.status === 404) return { ok: true, site: null }
    return res.ok ? { ok: true, site: await res.json() } : { ok: false, error: await msg(res) }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}

// The change log of one site, newest first: { ok, changes } or { ok: false, error }.
export async function listChanges(siteId, { fetchFn = fetch, base = API_BASE } = {}) {
  try {
    const res = await fetchFn(`${base}/sites/${encodeURIComponent(siteId)}/changes`, { headers: authHeaders() })
    return res.ok ? { ok: true, changes: await res.json() } : { ok: false, error: await msg(res) }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}

// The stored fingerprint of a site (what its learned network looks like): { ok, profile } or { ok: false, error }.
export async function getProfile(siteId, { fetchFn = fetch, base = API_BASE } = {}) {
  try {
    const res = await fetchFn(`${base}/sites/${encodeURIComponent(siteId)}/profile`, { headers: authHeaders() })
    return res.ok ? { ok: true, profile: await res.json() } : { ok: false, error: await msg(res) }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}

// Forget everything learned for this site (the existing reset endpoint): { ok, rows } or { ok: false, error }.
export async function resetNetwork(siteId, { fetchFn = fetch, base = API_BASE } = {}) {
  try {
    const res = await fetchFn(`${base}/sites/${encodeURIComponent(siteId)}/reset-fingerprint`, { method: 'POST', headers: authHeaders() })
    if (!res.ok) return { ok: false, error: await msg(res) }
    const j = await res.json()
    return { ok: true, rows: j.profile_rows ?? 0 }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}

// Tell the screens that show the site (the live Sensor feed) that it changed.
export const SITE_EVENT = 'trust:site-saved'

// The phone's / laptop's position right now (one fix), for "use my current location".
export function currentPosition(geolocation = globalThis.navigator?.geolocation, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!geolocation) return reject(new Error('This browser has no location.'))
    geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e?.code === 1 ? 'Location access was denied.' : 'Could not get a location fix.')),
      { enableHighAccuracy: true, timeout },
    )
  })
}
