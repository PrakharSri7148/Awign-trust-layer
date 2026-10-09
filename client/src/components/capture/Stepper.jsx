import { Check } from 'lucide-react'

const STEPS = ['Photo', 'Arrival', 'AI scan', 'Verdict']

// The 4-step progress indicator of the redesigned Photo step: done = check, active = blue, pending = outline, joined by bars.
// On phones only the active label is shown (the others stay as screen-reader text). `current` = STEPS.length means every step is done (the
// Verdict step): the last one then keeps aria-current="step" and, on phones, its label.
export default function Stepper({ current }) {
  const allDone = current >= STEPS.length
  return (
    <ol className="cap-stepper" aria-label="Progress">
      {STEPS.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'pending'
        const isCurrent = i === current || (allDone && i === STEPS.length - 1)
        return (
          <li key={label} style={{ display: 'contents' }}>
            <span className={`cap-stepper__item cap-stepper__item--${state}`} aria-current={isCurrent ? 'step' : undefined}>
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
