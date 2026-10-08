import { Route } from 'lucide-react'
import { recordingSummary } from '../../lib/sensorFusion/display.js'
import { useRecorderState } from '../../lib/sensorFusion/useRecorder.js'
import SensorTile from './SensorTile.jsx'

// The approach trail in the Sensors step: what was recorded before the Submit tap (not a fake reading: when nothing was
// recorded it says so).
export default function TrailTile({ recorder }) {
  const s = useRecorderState(recorder)
  const state = !s.running ? 'na' : s.fixes + s.windows > 0 ? 'ok' : 'acq'
  const value = s.running ? recordingSummary(s) : 'Not recorded (start the visit recording on the first screen to add the approach)'
  return (
    <SensorTile icon={Route} title="Approach trail" state={state} value={value}>
      {s.running && s.activities.length > 0 && (
        <div className="fz-strip" style={{ marginTop: 6 }} role="img" aria-label="Phone activity in the last two minutes">
          {s.activities.map((a, i) => <i key={i} className={`fz-cell fz-act--${a}`} title={a} />)}
        </div>
      )}
    </SensorTile>
  )
}
