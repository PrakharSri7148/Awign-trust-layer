import { Download, MapPinned, Square } from 'lucide-react'
import { useState } from 'react'
import { CONSENT_SHORT, CONSENT_TEXT, CONSENT_TITLE } from '../../lib/sensorFusion/consent.js'
import { recordingSummary } from '../../lib/sensorFusion/display.js'
import { SCENARIOS, buildTraceDoc, downloadTrace, recordModeOn } from '../../lib/sensorFusion/exportTrace.js'
import { useRecorderState } from '../../lib/sensorFusion/useRecorder.js'
import { getNetworkInfo } from '../../lib/sensors.js'

// Visit recording: the consent text, a start button (a tap, which iOS needs for the motion permission) and the live summary.
// The wording is a DRAFT (lib/sensorFusion/consent.js).
export default function VisitPanel({ recorder, onStart, onStop, note }) {
  const s = useRecorderState(recorder)
  const [busy, setBusy] = useState(false)
  const [scenario, setScenario] = useState(SCENARIOS[0][0])
  const [text, setText] = useState('')
  const record = recordModeOn()

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
