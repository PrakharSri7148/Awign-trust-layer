import { Check, Loader2, TriangleAlert } from 'lucide-react'

const STATE_LABEL = { wait: 'Waiting', acq: 'Acquiring', ok: 'Locked', na: 'Unavailable' }

export default function SensorTile({ icon: Icon, title, state, value, aside, children }) {
  return (
    <div className={`sensor sensor--${state}`}>
      <div className="sensor__icon">
        <Icon size={22} />
      </div>
      <div className="sensor__body">
        <div className="sensor__title">
          {title}
          <span className={`sensor__state ${state === 'ok' ? 'text-green' : state === 'na' ? 'text-amber' : state === 'acq' ? 'text-cyan' : 'faint'}`}>
            {state === 'ok' && <Check size={12} style={{ verticalAlign: '-2px' }} />}{' '}
            {state === 'na' && <TriangleAlert size={12} style={{ verticalAlign: '-2px' }} />}{' '}
            {state === 'acq' && <Loader2 size={12} style={{ verticalAlign: '-2px', animation: 'spin 1s linear infinite' }} />}{' '}
            {STATE_LABEL[state]}
          </span>
        </div>
        {value && <div className="sensor__val">{value}</div>}
        {children}
      </div>
      {aside}
    </div>
  )
}
