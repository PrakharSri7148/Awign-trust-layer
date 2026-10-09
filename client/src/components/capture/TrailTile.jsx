import { Route } from 'lucide-react'
import { recordingSummary } from '../../lib/sensorFusion/display.js'
import { useRecorderState } from '../../lib/sensorFusion/useRecorder.js'
import SensorTile from './SensorTile.jsx'

const NOT_RECORDED = 'Not recorded (start the visit recording on the first screen to add the approach)'
const LEGEND = [['still', 'is-still'], ['walking', 'is-walking'], ['moving', 'is-moving'], ['unknown', 'is-unknown']]

// The approach trail in the Arrival step: what was recorded before the "I've reached the site" tap (not a fake reading: when nothing was
// recorded it says so). Locked = fixes or windows were recorded, Acquiring = the recording just started, Unavailable = nothing recorded.
export function trailState(s) {
  return !s.running ? 'na' : s.fixes + s.windows > 0 ? 'ok' : 'acq'
}

export default function TrailTile({ recorder }) {
  const s = useRecorderState(recorder)
  const state = trailState(s)
  const value = s.running ? recordingSummary(s) : NOT_RECORDED
  return (
    <SensorTile icon={Route} title="Approach trail" state={state} value={value} testId="arrival-trail">
      {s.running && s.activities.length > 0 && (
        <>
          <div className="cap-strip" role="img" aria-label="Phone activity in the last two minutes">
            {s.activities.map((a, i) => <i key={i} className={`is-${a}`} title={a} />)}
          </div>
          <div className="cap-legend" aria-hidden="true">
            {LEGEND.map(([word, c]) => <span key={word}><i className={c} />{word}</span>)}
          </div>
        </>
      )}
    </SensorTile>
  )
}
