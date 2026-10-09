import { Download, LocateFixed, MapPinned, Square, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { CONSENT_SHORT, CONSENT_TEXT, CONSENT_TITLE } from '../../lib/sensorFusion/consent.js'
import { recentFix, recordingSummary } from '../../lib/sensorFusion/display.js'
import { SCENARIOS, buildTraceDoc, demoToolsOn, downloadTrace, recordModeOn } from '../../lib/sensorFusion/exportTrace.js'
import { BIG_MOVE_M, distanceM, fmtDist } from '../../lib/sensorFusion/siteForm.js'
import { SITE_EVENT, currentPosition, getSite, saveSite } from '../../lib/sensorFusion/sites.js'
import { useRecorderState } from '../../lib/sensorFusion/useRecorder.js'
import { Accordion } from './ui.jsx'
import { getNetworkInfo } from '../../lib/sensors.js'

// Visit recording: the consent text, a start button (a tap, which iOS needs for the motion permission) and the live summary.
// The wording is a DRAFT (lib/sensorFusion/consent.js).
export default function VisitPanel({ recorder, onStart, onStop, note, siteId = 'site_demo_1' }) {
  const s = useRecorderState(recorder)
  const [busy, setBusy] = useState(false)
  const [scenario, setScenario] = useState(SCENARIOS[0][0])
  const [text, setText] = useState('')
  const record = recordModeOn()
  const tools = demoToolsOn()
  const [siteMsg, setSiteMsg] = useState(null)

  // Demo tool: stand at the venue and tap once; the arrival and "outside the site" checks then know where the site is.
  async function registerHere() {
    setSiteMsg('Finding your location…')
    try {
      // The running recording already has a fresh fix (a cold one-shot request often times out on phones); otherwise ask once.
      const st = recorder.getState()
      const fresh = recentFix(st, { maxAgeS: 20 })
      const p = fresh ? { ...fresh, accuracy: st.lastFix.acc ?? 0 } : await currentPosition()
      // A site that already exists keeps its radius, country and label (this button used to wipe the country, which switches the
      // "network is in another country" check off), and it is never moved far from here: that is the dashboard panel's job, which
      // also asks whether to forget the network learned at the old place.
      const cur = await getSite(siteId)
      const had = cur.ok ? cur.site : null
      const away = had ? distanceM(had, p) : null
      if (away != null && away > BIG_MOVE_M) {
        setSiteMsg(`This spot is ${fmtDist(away)} from the saved site. Move a site that far in the dashboard's Site location panel: it asks whether to forget the network learned at the old place.`)
        return
      }
      const r = await saveSite(siteId, { lat: p.lat, lng: p.lng, radius_m: had?.radius_m ?? 80, country: had?.country ?? '', label: had?.label ?? 'registered from the phone' })
      if (r.ok) globalThis.dispatchEvent?.(new Event(SITE_EVENT))
      setSiteMsg(r.ok ? `This spot (±${Math.round(p.accuracy)} m) is now ${siteId}, radius ${had?.radius_m ?? 80} m${had ? ' (country and label kept)' : ''}.` : r.error)
    } catch (e) {
      setSiteMsg(e.message)
    }
  }

  async function start() {
    setBusy(true)
    try {
      await onStart()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="cap-card cap-visit" aria-label="Visit recording" data-testid="visit-panel">
      <div className="cap-card__head"><div className="cap-eyebrow"><MapPinned size={14} className="cap-icon" aria-hidden="true" /> Visit recording</div></div>
      <div className="cap-card__body">
        {s.running ? (
          <div className="cap-visit__row">
            <span className="cap-visit__live" role="status"><i className="cap-visit__dot" aria-hidden="true" /><span>Recording · {recordingSummary(s)}</span></span>
            <button type="button" className="cap-btn cap-btn--sm" onClick={onStop}><Square size={13} className="cap-icon" aria-hidden="true" /> Stop</button>
          </div>
        ) : (
          <>
            <p className="cap-visit__consent"><b>{CONSENT_TITLE}.</b> {CONSENT_SHORT}</p>
            <div className="cap-visit__row">
              <button type="button" className="cap-btn cap-btn--primary" onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Start recording my visit'}</button>
            </div>
            <Accordion title="What is recorded?">
              <p className="cap-visit__consent">{CONSENT_TEXT}</p>
            </Accordion>
          </>
        )}
        {s.running && (s.motion === 'null_events' || s.motion === 'absent' || s.motion === 'denied') && (
          <p className="cap-visit__note" role="note">
            <TriangleAlert size={16} className="cap-icon" aria-hidden="true" />
            <span>{s.motion === 'denied' ? 'Motion access was denied, so only the location is recorded.' : 'This device has no motion sensor, so only the location is recorded.'}</span>
          </p>
        )}
        {s.geo === 'denied' && (
          <p className="cap-visit__note" role="note"><TriangleAlert size={16} className="cap-icon" aria-hidden="true" /><span>Location access was denied, so no trail can be recorded.</span></p>
        )}
        {note && <p className="cap-visit__note" role="note"><TriangleAlert size={16} className="cap-icon" aria-hidden="true" /><span>{note}</span></p>}
        {(tools || record) && (
          <Accordion title="Demo and record tools" meta="(diagnostics)" defaultOpen>
            <div className="cap-visit__tools">
              {tools && (
                <div className="cap-visit__toolrow" data-testid="demo-tools">
                  <button type="button" className="cap-btn cap-btn--sm" onClick={registerHere}><LocateFixed size={13} className="cap-icon" aria-hidden="true" /> Register this spot as the site</button>
                  {siteMsg && <span className="cap-visit__consent" role="status">{siteMsg}</span>}
                </div>
              )}
              {record && (
                <div className="cap-visit__toolrow" data-testid="record-mode">
                  <label className="cap-field">
                    <span className="cap-field__label">Scenario folder</span>
                    <select value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Scenario folder" className="cap-select">
                      {SCENARIOS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                  </label>
                  <label className="cap-field">
                    <span className="cap-field__label">Note</span>
                    <input value={text} onChange={(e) => setText(e.target.value)} placeholder="phone, OS/browser, what you did" aria-label="Note" className="cap-input" />
                  </label>
                  <button
                    type="button"
                    className="cap-btn cap-btn--sm"
                    disabled={!s.running}
                    onClick={() => downloadTrace(buildTraceDoc({ scenario, note: text, trail: recorder.snapshot(), networkInfo: getNetworkInfo(), userAgent: navigator.userAgent }))}
                  >
                    <Download size={13} className="cap-icon" aria-hidden="true" /> Download trace
                  </button>
                </div>
              )}
            </div>
          </Accordion>
        )}
      </div>
    </section>
  )
}
