// Small shared pieces of the redesigned Photo step. Classes are written out in full (cap- prefix), see styles/capture.css.
import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'

export const STATUS_WORD = { pass: 'passed', warn: 'warning', fail: 'failed' }

// One accordion (an expandable section). Uncontrolled unless `open` + `onToggle` are given.
export function Accordion({ title, meta, defaultOpen = false, open, onToggle, flat = false, children, testId }) {
  const id = useId()
  const [own, setOwn] = useState(defaultOpen)
  const isOpen = open ?? own
  const toggle = () => (onToggle ? onToggle(!isOpen) : setOwn(!isOpen))
  return (
    <div className={`cap-acc${isOpen ? ' is-open' : ''}${flat ? ' cap-acc--flat' : ''}`} data-testid={testId}>
      <button type="button" className="cap-acc__trigger" aria-expanded={isOpen} aria-controls={id} onClick={toggle}>
        <span>{title}{meta ? <> <span className="cap-acc__meta">{meta}</span></> : null}</span>
        <ChevronDown size={16} className="cap-icon cap-acc__chev" aria-hidden="true" />
      </button>
      <div className="cap-acc__panel" id={id} hidden={!isOpen}>{children}</div>
    </div>
  )
}

export const cls = (...p) => p.filter(Boolean).join(' ')
