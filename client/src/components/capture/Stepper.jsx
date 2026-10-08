import { Check } from 'lucide-react'

const STEPS = ['Photo', 'Arrival', 'AI scan', 'Verdict']

export default function Stepper({ current }) {
  return (
    <ol className="stepper" style={{ listStyle: 'none', padding: 0 }} aria-label="Progress">
      {STEPS.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : ''
        return (
          <li key={label} style={{ display: 'contents' }} aria-current={i === current ? 'step' : undefined}>
            <div className={`step step--${state}`}>
              <span className="step__dot">{i < current ? <Check size={15} strokeWidth={3} /> : i + 1}</span>
              <span className="step__label">{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`step__bar${i < current ? ' step__bar--done' : ''}`}>
                <i />
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
