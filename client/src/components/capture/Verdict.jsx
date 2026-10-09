import { CircleAlert } from 'lucide-react'
import { useEffect } from 'react'
import FetchedPanel from './FetchedPanel.jsx'
import { useLayoutMode } from './useLayoutMode.js'
import VerdictCard, { NewSubmission } from './VerdictCard.jsx'
import WhyCard from './WhyCard.jsx'

// Step 4 of 4 (Verdict), inside CapShell under the Stepper (design: redesign/capture-verdict).
//   desktop >= 1000  left column: result card (with the action) + notes; right column: Why? + What was fetched
//   tablet 721-999   result card full width, then Why? and What was fetched side by side
//   phone <= 720     one column; "What was fetched" collapsed behind Details; "New submission" in a sticky bar above the bottom nav
// `notes` = the unavailable sensor readings (sensorNotesFor), printed as "Note: … Submitted anyway." under the result card.
export default function Verdict({ result, notes = [], onReset }) {
  const phone = useLayoutMode() === 'overlay'
  useEffect(() => { document.getElementById('vres-title')?.focus({ preventScroll: true }) }, [])
  return (
    <div className={`cap-verdict cap-verdict--${result.status}`} data-fusion={result.fusion?.motion ? 'yes' : 'no'}>
      <div className="cap-verdict__side">
        <VerdictCard result={result} action={phone ? null : <NewSubmission onReset={onReset} className="cap-vres__btn" />} />
        {notes.length > 0 && (
          <div className="cap-banner cap-banner--warn" role="status" data-testid="sensor-notes">
            <CircleAlert size={18} className="cap-icon" aria-hidden="true" />
            <span className="cap-banner__text">Note: {notes.join('; ')}. Submitted anyway.</span>
          </div>
        )}
      </div>
      <div className="cap-verdict__main">
        <WhyCard result={result} />
        <FetchedPanel fusion={result.fusion} phone={phone} />
      </div>
      {phone && <div className="cap-vaction"><NewSubmission onReset={onReset} /></div>}
    </div>
  )
}
