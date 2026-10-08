// The server's IP database (DB-IP lite): GET /health carries `ip_database` (backend/fusion/ipctx.py status()). The data is CC BY 4.0, so
// wherever it is shown to people the credit "IP Geolocation by DB-IP" must appear, as text with a link (no image, no third-party request).
import { useEffect, useState } from 'react'
import { API_BASE } from './api.js'

export const DBIP_CREDIT = { text: 'IP Geolocation by DB-IP', url: 'https://db-ip.com' }

// -> { state: 'unknown' | 'missing' | 'stale' | 'ok', label, detail, credit } from the `ip_database` object of /health.
export function describeIpDatabase(info) {
  if (!info || typeof info !== 'object') return { state: 'unknown', label: null, detail: null, credit: false }
  if (!info.installed) {
    return { state: 'missing', label: 'IP database not installed', detail: 'The network check runs without country, provider or VPN data. Run tools/fetch_geoip.py on the server and restart it.', credit: false }
  }
  const age = Number.isFinite(info.age_days) ? info.age_days : null
  const when = info.date ? `data from ${info.date}${age != null ? `, ${age} days old` : ''}` : 'data date unknown'
  if (info.stale) return { state: 'stale', label: 'IP database is old', detail: `${when}. Refresh it with tools/fetch_geoip.py and restart the server.`, credit: true }
  return { state: 'ok', label: null, detail: `DB-IP lite, ${when}`, credit: true }
}

export function useIpDatabase(everyMs = 60000) {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      fetch(`${API_BASE}/health`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && setInfo(j?.ip_database ?? null))
        .catch(() => alive && setInfo(null))
    load()
    const id = setInterval(load, everyMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [everyMs])
  return info
}
