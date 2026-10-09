import { useCallback, useEffect, useRef, useState } from 'react'
import { DEMO_SITE_ID, accuracyNote, describeChange, describeProfile, diffRows, fmtWhen, moveLine, shouldDefaultReset } from '../../lib/sensorFusion/siteForm.js'
import { SITE_EVENT, currentPosition, getProfile, getSite, listChanges, resetNetwork, saveSite, validateSite } from '../../lib/sensorFusion/sites.js'
import { Icon, cx } from './ui.jsx'

const EMPTY = { lat: '', lng: '', radius_m: 100, country: 'IN', label: '' }
const fromSite = (s) => (s ? { lat: String(s.lat), lng: String(s.lng), radius_m: s.radius_m, country: s.country ?? '', label: s.label ?? '' } : EMPTY)

function Field({ id, label, wide, ...rest }) {
  return (
    <div className={cx('field', wide && 'field--wide')}>
      <label className={cx('field__label')} htmlFor={id}>{label}</label>
      <input id={id} className={cx('input')} autoComplete="off" {...rest} />
    </div>
  )
}

// Where one site really is: edit it, take it from the device's GPS, review old -> new, save. Every save is written to a change log.
// Moving more than 1 km also forgets the network learned at the old place (ticked by default), so the old home network is never silently
// kept as "normal" for the venue.
export default function SiteLocation({ siteId, siteOptions, onSiteId, toast }) {
  const [site, setSite] = useState(undefined) // undefined = loading, null = none registered
  const [changes, setChanges] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [reset, setReset] = useState(false)
  const resetTouched = useRef(false)
  const [step, setStep] = useState('edit') // edit | confirm
  const [fix, setFix] = useState(null)
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
    if (s.ok) { setSite(s.site); setForm(fromSite(s.site)) } else setSite((prev) => (prev === undefined ? null : prev))
    setChanges(c.ok ? c.changes : [])
    resetTouched.current = false
    setReset(false)
    setStep('edit')
    setFix(null)
  }, [siteId])
  useEffect(() => { setSite(undefined); load() }, [load])

  const move = moveLine(site, form)
  const validation = validateSite(form)
  useEffect(() => { if (!resetTouched.current) setReset(shouldDefaultReset(site, form)) }, [site, form.lat, form.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => { setError(null); setStep('edit'); setForm((f) => ({ ...f, [k]: e.target.value })) }

  async function here() {
    setBusy(true); setError(null)
    try {
      const p = await currentPosition()
      setForm((f) => ({ ...f, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }))
      setFix({ accuracy: p.accuracy }); setStep('edit')
    } catch (e) { setFix(null); setError(e.message) } finally { setBusy(false) }
  }

  async function confirmSave() {
    setBusy(true); setError(null)
    const r = await saveSite(siteId, { ...form, reset_network: site ? reset : false })
    setBusy(false)
    if (!r.ok) { setError(r.error); setStep('edit'); return }
    toast(`Site ${siteId} saved${r.site.network_reset ? ' · learned network forgotten' : ''}`)
    globalThis.dispatchEvent?.(new Event(SITE_EVENT))
    load()
  }

  async function forgetNow() {
    setBusy(true)
    const r = await resetNetwork(siteId)
    setBusy(false)
    if (!r.ok) { setError(r.error); setForgetAsk(false); return }
    toast(`Learned network forgotten (${r.rows} rows)`)
    load()
  }

  const learned = describeProfile(profile)
  const acc = fix ? accuracyNote(fix.accuracy) : null
  const rows = step === 'confirm' ? diffRows(site, form) : []
  const unchanged = !!site && !diffRows(site, form).some((r) => r.changed) // every field equal to the saved one: nothing to save

  return (
    <section className={cx('panel', 'panel--wide', 'site-loc')} aria-labelledby="loc-title" data-testid="site-location-panel">
      <div className={cx('panel__head')}>
        <div>
          <h2 className={cx('panel__title')} id="loc-title">Site location</h2>
          <p className={cx('panel__sub')}>Where this site really is. The arrival, outside-the-site and network checks compare each submission with it. Stand at the place and tap <b>Use my current location</b>, or type the values.</p>
        </div>
        <div className={cx('field')} style={{ minWidth: 220 }}>
          <label className={cx('sr-only')} htmlFor="loc-site">Site</label>
          <select id="loc-site" className={cx('select')} value={siteId} onChange={(e) => onSiteId(e.target.value)}>{siteOptions.map((id) => <option key={id} value={id}>{id}</option>)}</select>
        </div>
      </div>
      <div className={cx('settings__body')}>
        {loadError && <p className={cx('note', 'note--bad')} role="alert" data-testid="site-load-error">{loadError}{/token/i.test(loadError) ? ' Enter the access token in the submissions list.' : ''}</p>}
        {site === undefined && !loadError && <p className={cx('text-2', 'text-sm')}>Loading…</p>}
        {site === null && !loadError && (
          <p className={cx('note', 'note--warn')} data-testid="site-none"><Icon name="triangle-alert" /> No site is registered for <b>{siteId}</b>. Until it is, submissions are scored without the arrival and area checks (the case file says so). Fill in the form below to create it.</p>
        )}

        {site && (
          <dl className={cx('kv', 'site-current')} data-testid="site-current">
            <dt>Latitude</dt><dd className={cx('mono')}>{site.lat.toFixed(6)}</dd>
            <dt>Longitude</dt><dd className={cx('mono')}>{site.lng.toFixed(6)}</dd>
            <dt>Radius</dt><dd>{site.radius_m} m</dd>
            <dt>Country</dt><dd>{site.country ?? '-'}</dd>
            <dt>Label</dt><dd>{site.label ?? '-'}</dd>
            <dt>Last changed</dt><dd>{changes[0] ? fmtWhen(changes[0].changed_at) : 'before the change log existed'}</dd>
          </dl>
        )}

        {site && profile && (
          <div className={cx('learned')} data-testid="learned">
            <h3 className={cx('quality__h')}><Icon name="fingerprint" /> Learned network (the site's fingerprint)</h3>
            <p className={cx('learned__headline', learned.known && 'is-ok')} data-testid="learned-headline">{learned.headline}</p>
            {!learned.empty && (
              <div className={cx('table-wrap')}>
                <table className={cx('table')} data-testid="learned-table">
                  <thead><tr><th>What</th><th>Value</th><th>Visits</th><th>Last seen</th></tr></thead>
                  <tbody>
                    {learned.rows.map((r) => (
                      <tr key={`${r.kind}-${r.key}`}><td>{r.kind}</td><td className={cx('num')}>{r.key}{r.meaning && <div className={cx('text-2', 'text-xs')} style={{ fontFamily: 'var(--font-ui)' }}>{r.meaning}</div>}</td><td className={cx('num')}>{r.count}</td><td className={cx('num', 'text-2')}>{r.last}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={cx('text-xs', 'text-2')}>{learned.rule} Stored: speed classes and provider numbers only, never an IP address.</p>
            {!learned.empty && !forgetAsk && <button type="button" className={cx('btn', 'btn--sm', 'btn--danger')} style={{ width: 'fit-content' }} onClick={() => setForgetAsk(true)} disabled={busy} data-testid="forget-now">Forget the learned network</button>}
            {forgetAsk && (
              <div className={cx('inline-confirm')} role="alertdialog" aria-label="Confirm forgetting the learned network" data-testid="forget-confirm">
                <span>This forgets all {learned.rows.length} rows above. The next 3 trusted visits rebuild it.</span>
                <button type="button" className={cx('btn', 'btn--sm', 'btn--danger-solid')} onClick={forgetNow} disabled={busy} data-testid="forget-yes">Yes, forget it</button>
                <button type="button" className={cx('btn', 'btn--sm', 'btn--ghost')} onClick={() => setForgetAsk(false)} disabled={busy}>Keep it</button>
              </div>
            )}
          </div>
        )}

        {(site !== undefined || loadError) && (
          <form className={cx('loc-form')} onSubmit={(e) => { e.preventDefault(); if (!validation) setStep('confirm') }} noValidate aria-label="Edit site location">
            <h3 className={cx('quality__h')}><Icon name="map-pin" /> {site ? 'Change the location' : 'Register the location'}</h3>
            <div className={cx('sites-form__grid')}>
              <Field id="f-lat" label="Latitude" value={form.lat} onChange={set('lat')} inputMode="decimal" aria-label="Latitude" data-testid="f-lat" />
              <Field id="f-lng" label="Longitude" value={form.lng} onChange={set('lng')} inputMode="decimal" aria-label="Longitude" data-testid="f-lng" />
              <Field id="f-radius" label="Radius (m)" value={form.radius_m} onChange={set('radius_m')} inputMode="numeric" aria-label="Radius in metres" data-testid="f-radius" />
              <Field id="f-country" label="Country" value={form.country} onChange={set('country')} maxLength={2} aria-label="Country code" data-testid="f-country" />
              <Field id="f-label" label="Label" value={form.label} onChange={set('label')} maxLength={80} placeholder="e.g. Hackathon venue" aria-label="Label" data-testid="f-label" />
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className={cx('btn', 'btn--sm')} onClick={here} disabled={busy} data-testid="use-location"><Icon name="locate" />Use my current location</button>
              <span className={cx('text-xs', 'text-2')}>On a phone this needs the HTTPS address.</span>
            </div>
            {acc && <p className={cx('note', `note--${acc.tone === 'green' ? 'ok' : 'warn'}`)} data-testid="fix-note" role="status">{acc.text}</p>}
            {move.text && <p className={cx('note', move.kind === 'big' ? 'note--warn' : 'note--neutral')} data-testid="move-line">{move.text}</p>}
            {site && (
              <label className={cx('check-row')} style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" checked={reset} onChange={(e) => { resetTouched.current = true; setReset(e.target.checked) }} data-testid="f-reset" style={{ marginTop: 3 }} />
                <span>
                  <b>Forget the learned network for this site</b>
                  <span className={cx('text-2')}> The system learns what the network usually looks like here from accepted visits. If the site moves far, the old place's network would make the new place's network look "unseen". {move.kind === 'big' ? 'Ticked because the move is more than 1 km. Untick to keep what was learned.' : 'Left unticked because the move is under 1 km. Tick it to forget what was learned anyway.'}</span>
                </span>
              </label>
            )}
            {validation && (form.lat !== '' || form.lng !== '') && <div className={cx('field__error')} role="alert" data-testid="validation"><Icon name="circle-alert" />{validation}</div>}
            {error && <div className={cx('field__error')} role="alert" data-testid="save-error"><Icon name="circle-alert" />{error}</div>}
            {step === 'edit' && <div><button type="submit" className={cx('btn', 'btn--primary')} disabled={busy || !!validation || unchanged} data-testid="review">{site ? 'Review change' : 'Review new site'}</button></div>}
          </form>
        )}

        {step === 'confirm' && (
          <div className={cx('confirm-box')} data-testid="confirm" role="region" aria-label="Confirm change">
            <h3 className={cx('quality__h')}>Confirm: old → new</h3>
            <div className={cx('table-wrap')}>
              <table className={cx('table')}>
                <thead><tr><th>Field</th><th>Now</th><th>After saving</th></tr></thead>
                <tbody>
                  {rows.map((r) => <tr key={r.key} className={cx(r.changed && 'is-differs')}><td>{r.name}</td><td className={cx('num', 'text-2')}>{r.from}</td><td className={cx('num')}>{r.changed ? r.to : <span className={cx('text-2')}>{r.to} (same)</span>}</td></tr>)}
                </tbody>
              </table>
            </div>
            {move.text && <p className={cx('note', move.kind === 'big' ? 'note--warn' : 'note--neutral')} data-testid="confirm-move">{move.text}</p>}
            {site && <p className={cx('text-2', 'text-sm')} data-testid="confirm-reset">{reset ? 'The learned network for this site will be forgotten.' : 'The learned network for this site will be kept.'}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className={cx('btn', 'btn--primary')} onClick={confirmSave} disabled={busy} data-testid="confirm-save">Confirm and save</button>
              <button type="button" className={cx('btn', 'btn--ghost')} onClick={() => setStep('edit')} disabled={busy} data-testid="back">Back</button>
            </div>
          </div>
        )}

        <div className={cx('changelog')} data-testid="site-log">
          <h3 className={cx('quality__h')}><Icon name="history" /> Change log</h3>
          {changes.length === 0 ? <p className={cx('text-2', 'text-sm')}>No changes recorded yet.</p> : (
            <ul className={cx('changelog__list')}>
              {changes.map((c) => { const d = describeChange(c); return <li key={c.id} data-testid="log-row"><span className={cx('mono', 'text-2')}>{fmtWhen(c.changed_at)}</span><span>{d.what}</span>{d.network && <span className={cx('text-2')}>{d.network}</span>}</li> })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

export { DEMO_SITE_ID }
