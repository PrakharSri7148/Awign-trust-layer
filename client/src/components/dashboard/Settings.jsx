import { useEffect, useRef, useState } from 'react'
import { useDemo } from '../../lib/contexts.jsx'
import { DEMO_SITE_ID } from '../../lib/sensorFusion/siteForm.js'
import { SITE_EVENT, currentPosition, resetNetwork, saveSite, validateSite } from '../../lib/sensorFusion/sites.js'
import { readReviewer, saveReviewer } from './hooks.js'
import SiteLocation from './SiteLocation.jsx'
import { Icon, cx } from './ui.jsx'
import { useFocusTrap } from './useFocusTrap.js'

// The destructive "reset network profile" (it used to sit inside every case file): a confirm dialog, focus trapped, Esc cancels.
function ConfirmReset({ site, onClose, onDone, toast }) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  useFocusTrap(ref, onClose)
  useEffect(() => { ref.current?.querySelector('[data-cancel]')?.focus() }, [])
  async function go() {
    setBusy(true)
    const r = await resetNetwork(site.site_id)
    setBusy(false)
    if (!r.ok) { toast('Reset failed', { type: 'error', text: r.error }); return }
    toast(`Network profile reset for ${site.site_id}`, { text: 'It will be rebuilt from the next accepted visits.' })
    onDone()
  }
  return (
    <>
      <div className={cx('scrim')} onClick={onClose} />
      <div ref={ref} className={cx('dialog')} role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-desc">
        <h2 id="dlg-title">Reset network profile?</h2>
        <p id="dlg-desc" className={cx('text-2', 'text-sm')}>The network profile learned for <strong className={cx('mono')} style={{ color: 'var(--color-text)' }}>{site.site_id}</strong> is forgotten and rebuilt from the next accepted visits. Until then the network check says "not enough history". This can't be undone.</p>
        <div className={cx('dialog__actions')}>
          <button type="button" className={cx('btn')} data-cancel onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={cx('btn', 'btn--danger-solid')} onClick={go} disabled={busy} data-testid="reset-confirm">{busy ? 'Resetting…' : 'Reset network profile'}</button>
        </div>
      </div>
    </>
  )
}

function Field({ id, label, ...rest }) {
  return <div className={cx('field')}><label className={cx('field__label')} htmlFor={id}>{label}</label><input id={id} className={cx('input')} autoComplete="off" {...rest} /></div>
}

function Sites({ sites, error, toast, onSelectSite }) {
  const [form, setForm] = useState({ site_id: '', lat: '', lng: '', radius_m: '80', country: 'IN' })
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const openerRef = useRef(null)
  const set = (k) => (e) => { setFormError(null); setForm((f) => ({ ...f, [k]: e.target.value })) }

  async function here() {
    setBusy(true)
    try { const p = await currentPosition(); setForm((f) => ({ ...f, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) })); toast('Location found', { text: `Accurate to about ${Math.round(p.accuracy)} m.` }) }
    catch (e) { toast('Could not get your location', { type: 'error', text: e.message }) } finally { setBusy(false) }
  }
  async function save(e) {
    e.preventDefault()
    const id = form.site_id.trim()
    const bad = !id ? 'Enter a site ID.' : !/^[A-Za-z0-9_-]+$/.test(id) ? 'The site ID can only use letters, numbers, dashes and underscores.' : (sites ?? []).some((s) => s.site_id === id) ? 'A site with this ID already exists. Use "Edit location" instead.' : validateSite(form)
    if (bad) { setFormError(bad); return }
    setBusy(true)
    const r = await saveSite(id, form)
    setBusy(false)
    if (!r.ok) { setFormError(r.error); return }
    toast(`Site ${r.site.site_id} saved`)
    setForm({ site_id: '', lat: '', lng: '', radius_m: '80', country: 'IN' })
    globalThis.dispatchEvent?.(new Event(SITE_EVENT))
  }

  return (
    <section className={cx('panel', 'panel--wide')} aria-labelledby="sites-title" data-testid="sites-panel">
      <div className={cx('panel__head')}>
        <div><h2 className={cx('panel__title')} id="sites-title">Sites</h2><p className={cx('panel__sub')}>Where each site really is. The arrival and "outside the site" checks use it. Without a registered site those checks are skipped, never guessed.</p></div>
      </div>
      <div className={cx('settings__body')}>
        {error && <p className={cx('note', 'note--bad')} role="alert">{error}</p>}
        {sites && sites.length === 0 && !error && <p className={cx('text-2', 'text-sm')}>No site is registered yet. Add one below.</p>}
        {sites && sites.length > 0 && (
          <div className={cx('table-wrap')}>
            <table className={cx('table', 'table--stack')}>
              <thead><tr><th scope="col">Site</th><th scope="col">Latitude, longitude</th><th scope="col">Radius</th><th scope="col">Country</th><th scope="col"><span className={cx('sr-only')}>Actions</span></th></tr></thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.site_id}>
                    <td className={cx('cell--primary')} data-label="Site"><div className={cx('cell-stack')}><span className={cx('mono')}>{s.site_id}</span>{s.label && <small>{s.label}</small>}</div></td>
                    <td data-label="Location" className={cx('mono')}>{s.lat.toFixed(5)}, {s.lng.toFixed(5)}</td>
                    <td data-label="Radius" className={cx('num')}>{s.radius_m} m</td>
                    <td data-label="Country">{s.country ?? '-'}</td>
                    <td className={cx('cell--wide')} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className={cx('btn', 'btn--sm', 'btn--ghost')} onClick={() => onSelectSite(s.site_id)}>Edit location</button>{' '}
                      <button type="button" className={cx('btn', 'btn--sm', 'btn--danger')} data-testid={`reset-${s.site_id}`} onClick={(e) => { openerRef.current = e.currentTarget; setConfirm(s) }}>Reset network profile</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form className={cx('sites-form')} onSubmit={save} noValidate aria-label="Add a site">
          <h3 style={{ fontSize: 'var(--text-sm)' }}>Add a site</h3>
          <div className={cx('sites-form__grid')}>
            <Field id="as-id" label="Site ID" value={form.site_id} onChange={set('site_id')} placeholder="site_xyz_01" />
            <Field id="as-lat" label="Latitude" value={form.lat} onChange={set('lat')} inputMode="decimal" />
            <Field id="as-lng" label="Longitude" value={form.lng} onChange={set('lng')} inputMode="decimal" />
            <Field id="as-r" label="Radius (m)" value={form.radius_m} onChange={set('radius_m')} inputMode="numeric" />
            <Field id="as-c" label="Country" value={form.country} onChange={set('country')} maxLength={2} />
          </div>
          {formError && <div className={cx('field__error')} role="alert"><Icon name="circle-alert" />{formError}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={cx('btn', 'btn--sm')} onClick={here} disabled={busy}><Icon name="navigation" />Use my current location</button>
            <button type="submit" className={cx('btn', 'btn--primary', 'btn--sm')} disabled={busy}>Save site</button>
          </div>
        </form>
      </div>
      {confirm && <ConfirmReset site={confirm} toast={toast} onClose={() => { setConfirm(null); openerRef.current?.focus() }} onDone={() => { setConfirm(null); openerRef.current?.focus(); globalThis.dispatchEvent?.(new Event(SITE_EVENT)) }} />}
    </section>
  )
}

export default function Settings({ theme, onTheme, sites, sitesError, toast, selectedSite, onSelectSite }) {
  const { demo, setDemo, inject } = useDemo()
  const [name, setName] = useState(readReviewer)
  const options = [...new Set([DEMO_SITE_ID, ...(sites ?? []).map((s) => s.site_id)])].sort()

  return (
    <section className={cx('area-settings')} aria-labelledby="settings-title" data-testid="settings">
      <h2 className={cx('sr-only')} id="settings-title">Settings</h2>
      <div className={cx('settings')}>
        <section className={cx('panel')}>
          <div className={cx('panel__head')}><h2 className={cx('panel__title')}>Appearance</h2></div>
          <div className={cx('settings__body')}>
            <p className={cx('settings-note')}>The console is dark by default. Light is easier to read outdoors.</p>
            <div className={cx('segmented')} role="radiogroup" aria-label="Theme" style={{ width: 'fit-content' }}>
              {[['dark', 'moon', 'Dark'], ['light', 'sun', 'Light']].map(([k, i, l]) => <button key={k} type="button" className={cx('segmented__item')} role="radio" aria-checked={theme === k} onClick={() => onTheme(k)}><Icon name={i} />{l}</button>)}
            </div>
          </div>
        </section>
        <section className={cx('panel')}>
          <div className={cx('panel__head')}><h2 className={cx('panel__title')}>Reviewer</h2></div>
          <div className={cx('settings__body')}>
            <p className={cx('settings-note')}>Your name is recorded with every decision you make. It is kept on this device only; it is not a login.</p>
            <div className={cx('field')} style={{ maxWidth: 320 }}><label className={cx('field__label')} htmlFor="rev-name">Your name</label><input id="rev-name" className={cx('input')} value={name} maxLength={60} autoComplete="name" onChange={(e) => { setName(e.target.value); saveReviewer(e.target.value.trim()) }} /></div>
          </div>
        </section>
        <section className={cx('panel')}>
          <div className={cx('panel__head')}><h2 className={cx('panel__title')}>Severity levels</h2></div>
          <div className={cx('settings__body')}>
            <p className={cx('settings-note')}>Severity is set from the fraud probability. These levels are fixed for the whole team.</p>
            <div className={cx('table-wrap')}>
              <table className={cx('table')}>
                <thead><tr><th scope="col">Level</th><th scope="col">Fraud probability</th></tr></thead>
                <tbody>
                  <tr><td><span className={cx('pill', 'pill--critical')}>Critical</span></td><td className={cx('num')}>80% and above</td></tr>
                  <tr><td><span className={cx('pill', 'pill--high')}>High</span></td><td className={cx('num')}>60% to 79%</td></tr>
                  <tr><td><span className={cx('pill', 'pill--medium')}>Medium</span></td><td className={cx('num')}>40% to 59%</td></tr>
                  <tr><td><span className={cx('pill', 'pill--low')}>Low</span></td><td className={cx('num')}>Below 40%</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
        <section className={cx('panel')} data-testid="demo-panel">
          <div className={cx('panel__head')}><h2 className={cx('panel__title')}>Demo data</h2></div>
          <div className={cx('settings__body')}>
            <p className={cx('settings-note')}>Fill the console with seeded mock submissions to look around when there is little real data. Demo cases cannot be reviewed and never reach the server.</p>
            <label className={cx('check-row')}><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} data-testid="demo-toggle" /> Show demo data</label>
            {demo && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className={cx('btn', 'btn--sm', 'btn--danger')} onClick={() => inject('flagged')}>Add a flagged case</button>
                <button type="button" className={cx('btn', 'btn--sm')} onClick={() => inject('accepted')}>Add an accepted case</button>
              </div>
            )}
          </div>
        </section>
      </div>
      <div className={cx('settings')} style={{ paddingTop: 0 }}>
        <Sites sites={sites} error={sitesError} toast={toast} onSelectSite={(id) => { onSelectSite(id); setTimeout(() => document.getElementById('loc-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0) }} />
        <SiteLocation siteId={selectedSite} siteOptions={options} onSiteId={onSelectSite} toast={toast} />
      </div>
    </section>
  )
}
