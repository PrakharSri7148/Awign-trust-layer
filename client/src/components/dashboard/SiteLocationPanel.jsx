import { Fingerprint, History, LocateFixed, MapPin, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../../lib/contexts.jsx'
import { DEMO_SITE_ID, accuracyNote, describeChange, describeProfile, diffRows, fmtDist, fmtWhen, moveLine, shouldDefaultReset } from '../../lib/sensorFusion/siteForm.js'
import { SITE_EVENT, currentPosition, getProfile, getSite, listChanges, resetNetwork, saveSite, validateSite } from '../../lib/sensorFusion/sites.js'

const EMPTY = { lat: '', lng: '', radius_m: 100, country: 'IN', label: '' }
const fromSite = (s) => (s ? { lat: String(s.lat), lng: String(s.lng), radius_m: s.radius_m, country: s.country ?? '', label: s.label ?? '' } : EMPTY)

// Move the claimed area of the demo site (site_demo_1) from the dashboard: edit it, take it from the phone's GPS, review old -> new, save.
// Every save is written to a change log. Moving more than 1 km also forgets the network learned at the old place, ticked by default,
// so the home network is never silently kept as "normal" for the venue.
export default function SiteLocationPanel({ siteId = DEMO_SITE_ID }) {
  const toast = useToast()
  const [site, setSite] = useState(undefined) // undefined = loading, null = none registered
  const [changes, setChanges] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [reset, setReset] = useState(false)
  const resetTouched = useRef(false)
  const [step, setStep] = useState('edit') // edit | confirm
  const [fix, setFix] = useState(null) // { accuracy } of the last "use my location"
  const [error, setError] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [profile, setProfile] = useState(null)
  const [forgetAsk, setForgetAsk] = useState(false)

  const load = useCallback(async () => {
    const [s, c, p] = await Promise.all([getSite(siteId), listChanges(siteId), getProfile(siteId)])
    setProfile(p.ok ? p.profile : null)
    setForgetAsk(false)
    setLoadError(s.ok ? null : s.error)
    if (s.ok) {
      setSite(s.site)
      setForm(fromSite(s.site))
    } else setSite((prev) => (prev === undefined ? null : prev))
    setChanges(c.ok ? c.changes : [])
    resetTouched.current = false
    setReset(false)
    setStep('edit')
    setFix(null)
  }, [siteId])
  useEffect(() => {
    load()
  }, [load])

  const move = moveLine(site, form)
  const validation = validateSite(form)

  // the default of "forget the learned network" follows the distance until the person decides
  useEffect(() => {
    if (!resetTouched.current) setReset(shouldDefaultReset(site, form))
  }, [site, form.lat, form.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => {
    setError(null)
    setStep('edit')
    setForm((f) => ({ ...f, [k]: e.target.value }))
  }

  async function here() {
    setBusy(true)
    setError(null)
    try {
      const p = await currentPosition()
      setForm((f) => ({ ...f, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }))
      setFix({ accuracy: p.accuracy })
      setStep('edit')
    } catch (e) {
      setFix(null)
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmSave() {
    setBusy(true)
    setError(null)
    const r = await saveSite(siteId, { ...form, reset_network: site ? reset : false })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      setStep('edit')
      return
    }
    toast(`Site ${siteId} saved${r.site.network_reset ? ' · learned network forgotten' : ''}`)
    globalThis.dispatchEvent?.(new Event(SITE_EVENT))
    load()
  }

  async function forgetNow() {
    setBusy(true)
    const r = await resetNetwork(siteId)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      setForgetAsk(false)
      return
    }
    toast(`Learned network forgotten (${r.rows} rows)`)
    load()
  }

  const learned = describeProfile(profile)
  const acc = fix ? accuracyNote(fix.accuracy) : null
  const rows = step === 'confirm' ? diffRows(site, form) : []
  // nothing to save only when EVERY field equals the saved one (a changed radius or label alone is a real change)
  const unchanged = !!site && !diffRows(site, form).some((r) => r.changed)

  return (
    <div className="panel site-loc" data-testid="site-location-panel">
      <div className="eyebrow eyebrow--cyan"><MapPin size={12} style={{ verticalAlign: '-1px' }} /> Site location · <span className="mono">{siteId}</span></div>
      <p className="dim site-loc__lead">Where this site really is. The arrival, outside-the-site and network checks compare each submission with it. Stand at the place and tap <b>Use my current location</b>, or type the values.</p>

      {loadError && <p className="site-loc__msg site-loc__msg--red" role="alert" data-testid="site-load-error">{loadError}{/token/i.test(loadError) ? ' Enter the access token in the live feed above.' : ''}</p>}

      {site === undefined && !loadError && <p className="dim" style={{ fontSize: 13 }}>Loading…</p>}

      {site === null && !loadError && (
        <p className="site-loc__msg site-loc__msg--amber" data-testid="site-none">
          <TriangleAlert size={14} /> No site is registered for <b>{siteId}</b>. Until it is, submissions are scored without the arrival and area checks (the case file says so). Fill in the form below to create it.
        </p>
      )}

      {site && (
        <dl className="kv site-loc__current" data-testid="site-current">
          <dt>Latitude</dt><dd>{site.lat.toFixed(6)}</dd>
          <dt>Longitude</dt><dd>{site.lng.toFixed(6)}</dd>
          <dt>Radius</dt><dd>{site.radius_m} m</dd>
          <dt>Country</dt><dd>{site.country ?? '-'}</dd>
          <dt>Label</dt><dd>{site.label ?? '-'}</dd>
          <dt>Last changed</dt><dd>{changes[0] ? fmtWhen(changes[0].changed_at) : 'before the change log existed'}</dd>
        </dl>
      )}

      {site && profile && (
        <div className="site-loc__learned" data-testid="learned">
          <div className="eyebrow"><Fingerprint size={12} style={{ verticalAlign: '-1px' }} /> Learned network (the site's fingerprint)</div>
          <p className={`site-loc__headline${learned.known ? ' site-loc__headline--ok' : ''}`} data-testid="learned-headline">{learned.headline}</p>
          {!learned.empty && (
            <table className="checktable" data-testid="learned-table">
              <thead><tr><th>What</th><th>Value</th><th>Visits</th><th>Last seen</th></tr></thead>
              <tbody>
                {learned.rows.map((r) => (
                  <tr key={`${r.kind}-${r.key}`}><td>{r.kind}</td><td className="num">{r.key}{r.meaning && <div className="dim" style={{ fontSize: 12, fontFamily: 'var(--font-ui)' }}>{r.meaning}</div>}</td><td className="num">{r.count}</td><td className="num dim">{r.last}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="faint" style={{ fontSize: 12, margin: '8px 0 0' }}>{learned.rule} Stored: speed classes and provider numbers only, never an IP address.</p>
          {!learned.empty && !forgetAsk && (
            <button type="button" className="btn btn--sm btn--danger" onClick={() => setForgetAsk(true)} disabled={busy} data-testid="forget-now">Forget the learned network</button>
          )}
          {forgetAsk && (
            <div className="site-loc__row" data-testid="forget-confirm">
              <span style={{ fontSize: 13 }}>This forgets all {learned.rows.length} rows above. The next 3 trusted visits rebuild it.</span>
              <button type="button" className="btn btn--sm btn--danger" onClick={forgetNow} disabled={busy} data-testid="forget-yes">Yes, forget it</button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setForgetAsk(false)} disabled={busy}>Keep it</button>
            </div>
          )}
        </div>
      )}

      {(site !== undefined || loadError) && (
        <form className="site-loc__form" onSubmit={(e) => { e.preventDefault(); if (!validation) setStep('confirm') }} noValidate>
          <label className="site-loc__field">Latitude
            <input value={form.lat} onChange={set('lat')} inputMode="decimal" autoComplete="off" aria-label="Latitude" data-testid="f-lat" />
          </label>
          <label className="site-loc__field">Longitude
            <input value={form.lng} onChange={set('lng')} inputMode="decimal" autoComplete="off" aria-label="Longitude" data-testid="f-lng" />
          </label>
          <label className="site-loc__field">Radius (m)
            <input value={form.radius_m} onChange={set('radius_m')} inputMode="numeric" autoComplete="off" aria-label="Radius in metres" data-testid="f-radius" />
          </label>
          <label className="site-loc__field">Country
            <input value={form.country} onChange={set('country')} maxLength={2} autoComplete="off" aria-label="Country code" data-testid="f-country" />
          </label>
          <label className="site-loc__field site-loc__field--wide">Label
            <input value={form.label} onChange={set('label')} maxLength={80} autoComplete="off" aria-label="Label" placeholder="e.g. Hackathon venue" data-testid="f-label" />
          </label>

          <div className="site-loc__row site-loc__field--wide">
            <button type="button" className="btn btn--sm" onClick={here} disabled={busy} data-testid="use-location"><LocateFixed size={14} /> Use my current location</button>
            <span className="faint" style={{ fontSize: 12 }}>On a phone this needs the HTTPS address.</span>
          </div>
          {acc && <p className={`site-loc__msg site-loc__msg--${acc.tone} site-loc__field--wide`} data-testid="fix-note" role="status">{acc.text}</p>}

          {move.text && <p className={`site-loc__move site-loc__move--${move.kind} site-loc__field--wide`} data-testid="move-line">{move.text}</p>}

          {site && (
            <label className="site-loc__check site-loc__field--wide">
              <input type="checkbox" checked={reset} onChange={(e) => { resetTouched.current = true; setReset(e.target.checked) }} data-testid="f-reset" />
              <span>
                <b>Forget the learned network for this site</b>
                <span className="dim"> The system learns what the network usually looks like here from accepted visits. If the site moves far, the old place's network would make the new place's network look "unseen". {move.kind === 'big' ? 'Ticked because the move is more than 1 km. Untick to keep what was learned.' : 'Left unticked because the move is under 1 km. Tick it to forget what was learned anyway.'}</span>
              </span>
            </label>
          )}

          {validation && (form.lat !== '' || form.lng !== '') && <p className="site-loc__msg site-loc__msg--red site-loc__field--wide" role="alert" data-testid="validation">{validation}</p>}
          {error && <p className="site-loc__msg site-loc__msg--red site-loc__field--wide" role="alert" data-testid="save-error">{error}</p>}

          {step === 'edit' && (
            <div className="site-loc__row site-loc__field--wide">
              <button type="submit" className="btn btn--primary" disabled={busy || !!validation || unchanged} data-testid="review">{site ? 'Review change' : 'Review new site'}</button>
            </div>
          )}
        </form>
      )}

      {step === 'confirm' && (
        <div className="site-loc__confirm" data-testid="confirm">
          <div className="eyebrow">Confirm: old → new</div>
          <table className="checktable">
            <thead><tr><th>Field</th><th>Now</th><th>After saving</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.changed ? 'differs' : ''}>
                  <td>{r.name}</td><td className="num dim">{r.from}</td><td className="num">{r.changed ? r.to : <span className="dim">{r.to} (same)</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {move.text && <p className="site-loc__move" data-testid="confirm-move">{move.text}</p>}
          {site && <p className="dim" style={{ fontSize: 13 }} data-testid="confirm-reset">{reset ? 'The learned network for this site will be forgotten.' : 'The learned network for this site will be kept.'}</p>}
          <div className="site-loc__row">
            <button type="button" className="btn btn--primary" onClick={confirmSave} disabled={busy} data-testid="confirm-save">Confirm and save</button>
            <button type="button" className="btn btn--ghost" onClick={() => setStep('edit')} disabled={busy} data-testid="back">Back</button>
          </div>
        </div>
      )}

      <div className="site-loc__log" data-testid="site-log">
        <div className="eyebrow"><History size={12} style={{ verticalAlign: '-1px' }} /> Change log</div>
        {changes.length === 0 ? (
          <p className="dim" style={{ fontSize: 13, margin: '6px 0 0' }}>No changes recorded yet.</p>
        ) : (
          <ul className="site-loc__list">
            {changes.map((c) => {
              const d = describeChange(c)
              return (
                <li key={c.id} data-testid="log-row">
                  <span className="mono dim">{fmtWhen(c.changed_at)}</span>
                  <span>{d.what}</span>
                  {d.network && <span className="faint">{d.network}</span>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
