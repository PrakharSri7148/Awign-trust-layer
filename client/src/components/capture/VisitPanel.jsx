import { Download, LocateFixed, MapPinned, Square } from 'lucide-react'
import { useState } from 'react'
import { CONSENT_SHORT, CONSENT_TEXT, CONSENT_TITLE } from '../../lib/sensorFusion/consent.js'
import { recentFix, recordingSummary } from '../../lib/sensorFusion/display.js'
import { SCENARIOS, buildTraceDoc, demoToolsOn, downloadTrace, recordModeOn } from '../../lib/sensorFusion/exportTrace.js'
import { BIG_MOVE_M, distanceM, fmtDist } from '../../lib/sensorFusion/siteForm.js'
import { SITE_EVENT, currentPosition, getSite, saveSite } from '../../lib/sensorFusion/sites.js'
import { useRecorderState } from '../../lib/sensorFusion/useRecorder.js'
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
    <div className="panel panel--tight fz-visit" data-testid="visit-panel">
      <div className="eyebrow eyebrow--cyan fz-visit__eyebrow"><MapPinned size={12} style={{ verticalAlign: '-1px' }} /> Visit recording</div>
      {s.running ? (
        <div className="fz-visit__row">
          <span className="fz-live" role="status"><i aria-hidden="true" /> Recording · {recordingSummary(s)}</span>
          <button type="button" className="btn btn--sm" onClick={onStop}><Square size={13} /> Stop</button>
        </div>
      ) : (
        <div className="fz-visit__row">
          <p className="fz-visit__text"><b>{CONSENT_TITLE}.</b> {CONSENT_SHORT}</p>
          <button type="button" className="btn btn--primary btn--sm" onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Start recording my visit'}</button>
          <details className="fz-visit__more">
            <summary>What is recorded?</summary>
            <p className="fz-visit__text">{CONSENT_TEXT}</p>
          </details>
        </div>
      )}
      {s.running && (s.motion === 'null_events' || s.motion === 'absent' || s.motion === 'denied') && (
        <p className="fz-visit__text" role="note">
          {s.motion === 'denied' ? 'Motion access was denied, so only the location is recorded.' : 'This device has no motion sensor, so only the location is recorded.'}
        </p>
      )}
      {s.geo === 'denied' && <p className="fz-visit__text" role="note">Location access was denied, so no trail can be recorded.</p>}
      {note && <p className="fz-visit__text" role="note">{note}</p>}
      {tools && (
        <div className="fz-visit__row" data-testid="demo-tools">
          <button type="button" className="btn btn--sm" onClick={registerHere}><LocateFixed size={13} /> Register this spot as the site</button>
          {siteMsg && <span className="fz-visit__text" role="status">{siteMsg}</span>}
        </div>
      )}
      {record && (
        <div className="fz-visit__row" data-testid="record-mode">
          <select value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Scenario folder" className="chip">
            {SCENARIOS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="phone, OS/browser, what you did" aria-label="Note" className="chip" style={{ minWidth: 220 }} />
          <button
            type="button"
            className="btn btn--sm"
            disabled={!s.running}
            onClick={() => downloadTrace(buildTraceDoc({ scenario, note: text, trail: recorder.snapshot(), networkInfo: getNetworkInfo(), userAgent: navigator.userAgent }))}
          >
            <Download size={13} /> Download trace
          </button>
        </div>
      )}
    </div>
  )
}
