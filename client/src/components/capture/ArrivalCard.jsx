import { Activity, Check, LoaderCircle, MapPin, Satellite, TriangleAlert, Wifi } from 'lucide-react'
import { arrivalProgress, MOTION_MS } from '../../lib/arrivalProgress.js'
import { sensorNotesFor } from '../../lib/sensorNotes.js'
import { useRecorderState } from '../../lib/sensorFusion/useRecorder.js'
import CountdownRing from './CountdownRing.jsx'
import SignalBars from './SignalBars.jsx'
import SensorTile from './SensorTile.jsx'
import TrailTile, { trailState } from './TrailTile.jsx'
import Waveform from './Waveform.jsx'

const SEGMENTS = 20

// Step 2 of 4 (Arrival): the single card shown while the app reads GPS, motion and network for ~3 s. No buttons: it moves on by itself.
// Design: redesign/capture-arrival. `sensors` = { gps, motion, net } as 'wait' | 'acq' | 'ok' | 'na'; `readout` = the value lines;
// `left` = ms left of the motion reading; `continuing` = all readings are in and the 0.5 s pause before the AI scan runs.
export default function ArrivalCard({ sensors, readout, left, continuing, photoUrl, recorder }) {
  const states = { ...sensors, trail: trailState(useRecorderState(recorder)) }
  const p = arrivalProgress(states, left)
  const notes = sensorNotesFor(sensors)
  const tone = p.all ? (p.anyNa ? 'warn' : 'pass') : 'info'
  const lit = Math.round((p.pct / 100) * SEGMENTS)
  const motion = sensors.motion
  return (
    <section className="cap-card cap-arr" aria-labelledby="arr-title" aria-busy={!continuing} data-testid="arrival-card">
      <div className="cap-card__head">
        <div>
          <div className="cap-eyebrow"><MapPin size={14} className="cap-icon" aria-hidden="true" />Verifying your arrival</div>
          <h2 className="cap-card__title" id="arr-title">Sending your location</h2>
        </div>
        {photoUrl && (
          <figure className="cap-thumb" role="img" aria-label="Your verified photo">
            <div className="cap-thumb__img"><img src={photoUrl} alt="" /></div>
            <span className="cap-thumb__badge" aria-hidden="true"><Check size={12} className="cap-icon" /></span>
          </figure>
        )}
      </div>
      <div className="cap-card__body">
        <p className="cap-arr__lead">Your photo is verified. Hold the phone naturally for ~3 seconds while we send your GPS location and the movement recorded on the way, and check you reached the site.</p>

        <div className="cap-progress">
          <div className="cap-progress__row">
            <p className="cap-progress__count" role="status"><b>{p.done}</b> of 4 readings done</p>
            {continuing && <span className="cap-pill cap-pill--info"><LoaderCircle size={12} className="cap-icon cap-spin" aria-hidden="true" />Continuing…</span>}
          </div>
          <span className={`cap-meter cap-meter--20 cap-meter--${tone}`} role="meter" aria-label="Readings progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct} aria-valuetext={`${p.done} of 4 readings done`}>
            {Array.from({ length: SEGMENTS }, (_, i) => <i key={i} className={`cap-meter__cell${i < lit ? ' cap-meter__cell--on' : ''}`} />)}
          </span>
        </div>

        <ul className="cap-sensors" aria-label="Sensor readings">
          <SensorTile icon={Satellite} title="GPS" state={sensors.gps} value={readout.gps} mono={sensors.gps === 'ok'} testId="arrival-gps" />
          <SensorTile icon={Activity} title="Motion" state={motion} value={readout.motion} testId="arrival-motion">
            <div className="cap-sensor__live">
              <Waveform active={motion === 'acq'} hold={motion === 'ok'} label={motion === 'acq' ? 'Live motion waveform' : motion === 'ok' ? 'Motion waveform, recorded' : 'Motion waveform, flat: no motion sensor reading'} />
              {motion === 'acq' && <CountdownRing left={left} total={MOTION_MS} />}
            </div>
          </SensorTile>
          <SensorTile icon={Wifi} title="Network" state={sensors.net} value={readout.net} aside={sensors.net === 'ok' ? <SignalBars type={readout.netType} /> : null} testId="arrival-net" />
          <TrailTile recorder={recorder} />
        </ul>

        {notes.length > 0 && (
          <div className="cap-notice" role="status" data-testid="arrival-notes">
            <TriangleAlert size={16} className="cap-icon" aria-hidden="true" />
            <div>
              <div className="cap-notice__lead">Note</div>
              <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
              <p className="cap-notice__foot">We continue anyway.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
