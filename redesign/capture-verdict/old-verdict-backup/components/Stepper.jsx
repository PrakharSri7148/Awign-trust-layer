import { Check } from 'lucide-react'

const STEPS = ['Photo', 'Arrival', 'AI scan', 'Verdict']

// The 4-step progress indicator of the redesigned Photo step: done = check, active = blue, pending = outline, joined by bars.
// On phones only the active label is shown (the others stay as screen-reader text).
export default function Stepper({ current }) {
  return (
    <ol className="cap-stepper" aria-label="Progress">
      {STEPS.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'pending'
        return (
          <li key={label} style={{ display: 'contents' }}>
            <span className={`cap-stepper__item cap-stepper__item--${state}`} aria-current={i === current ? 'step' : undefined}>
              <span className="cap-stepper__dot">{i < current ? <Check size={15} strokeWidth={3} aria-hidden="true" /> : i + 1}</span>
              <span className="cap-stepper__label">{label}</span>
            </span>
            {i < STEPS.length - 1 && <span className={`cap-stepper__bar${i < current ? ' cap-stepper__bar--done' : ''}`} aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}
