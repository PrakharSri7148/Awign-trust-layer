import { LocateFixed, MapPin } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../../lib/contexts.jsx'
import { currentPosition, listSites, saveSite } from '../../lib/sensorFusion/sites.js'

// Where each site really is. The arrival, outside-the-site and IP-distance checks (sensor fusion) need this; until a site is
// registered the case file says "no site location registered" and those checks are skipped, never guessed.
export default function SitesPanel() {
  const toast = useToast()
  const [sites, setSites] = useState([])
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ site_id: 'site_demo_1', lat: '', lng: '', radius_m: 80, country: 'IN', label: '' })
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const r = await listSites()
    if (r.ok) setSites(r.sites)
    setError(r.ok ? null : r.error)
  }, [])
  useEffect(() => {
    reload()
  }, [reload])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function here() {
    setBusy(true)
    try {
      const p = await currentPosition()
      setForm((f) => ({ ...f, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }))
      toast(`Location found (±${Math.round(p.accuracy)} m)`)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    const r = await saveSite(form.site_id.trim(), form)
    setBusy(false)
    if (r.ok) {
      toast(`Site ${r.site.site_id} saved`)
      reload()
    } else toast(r.error, 'error')
  }

  return (
    <div className="panel" data-testid="sites-panel">
      <div className="eyebrow eyebrow--cyan"><MapPin size={12} style={{ verticalAlign: '-1px' }} /> Site locations</div>
      <p className="dim" style={{ fontSize: 13, margin: '6px 0 12px' }}>Where a site really is. The arrival and "outside the site" checks use it. Stand at the site and tap <b>Use my current location</b>.</p>
      {error && <p className="dim" style={{ fontSize: 13 }}>{error}</p>}
      {sites.length > 0 && (
        <table className="checktable" style={{ marginBottom: 12 }}>
          <thead><tr><th>Site</th><th>Latitude, longitude</th><th>Radius</th><th>Country</th></tr></thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.site_id}>
                <td>{s.site_id}{s.label ? ` · ${s.label}` : ''}</td>
                <td className="num dim">{s.lat.toFixed(5)}, {s.lng.toFixed(5)}</td>
                <td className="num dim">{s.radius_m} m</td>
                <td className="dim">{s.country ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={save} className="sites-form">
        <input className="chip" aria-label="Site id" placeholder="site id" value={form.site_id} onChange={set('site_id')} required />
        <input className="chip" aria-label="Latitude" placeholder="latitude" value={form.lat} onChange={set('lat')} inputMode="decimal" required />
        <input className="chip" aria-label="Longitude" placeholder="longitude" value={form.lng} onChange={set('lng')} inputMode="decimal" required />
        <input className="chip" aria-label="Radius in metres" placeholder="radius m" value={form.radius_m} onChange={set('radius_m')} inputMode="numeric" style={{ width: 90 }} />
        <input className="chip" aria-label="Country code" placeholder="IN" value={form.country} onChange={set('country')} maxLength={2} style={{ width: 60 }} />
        <button type="button" className="btn btn--sm" onClick={here} disabled={busy}><LocateFixed size={13} /> Use my current location</button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>Save site</button>
      </form>
    </div>
  )
}
