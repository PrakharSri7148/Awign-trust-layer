import { Check, Clock, LoaderCircle, TriangleAlert } from 'lucide-react'

// One reading of the Arrival step: the live version of a Sensor-feed group. Border and icon colour follow the state (classes cap-sensor--wait / --acq /
// --ok / --na), and the state is always a pill with a word and an icon. `aside` sits at the right end of the value row (the signal bars);
// `children` spans under the text (the waveform + countdown ring, the activity strip).
const STATE = {
  wait: { label: 'Waiting', pill: 'skip', Icon: Clock },
  acq: { label: 'Acquiring', pill: 'info', Icon: LoaderCircle },
  ok: { label: 'Locked', pill: 'pass', Icon: Check },
  na: { label: 'Unavailable', pill: 'warn', Icon: TriangleAlert },
}

export default function SensorTile({ icon: Icon, title, state, value, mono = false, aside, children, testId }) {
  const s = STATE[state]
  return (
    <li className={`cap-sensor cap-sensor--${state}`} data-testid={testId} data-state={state}>
      <span className="cap-sensor__icon" aria-hidden="true"><Icon size={20} className="cap-icon" /></span>
      <div className="cap-sensor__body">
        <div className="cap-sensor__head">
          <h3 className="cap-sensor__title">{title}</h3>
          <span className={`cap-pill cap-pill--${s.pill}`}><s.Icon size={12} className={`cap-icon${state === 'acq' ? ' cap-spin' : ''}`} aria-hidden="true" />{s.label}</span>
        </div>
        <div className="cap-sensor__main">
          <div className={`cap-sensor__value${mono ? ' cap-mono' : ''}`}>{value}</div>
          {aside}
        </div>
      </div>
      {children && <div className="cap-sensor__extra">{children}</div>}
    </li>
  )
}
