import { BrainCircuit } from 'lucide-react'
import { useEffect, useState } from 'react'

const LINES = [
  'Comparing the GPS trail with the phone\'s movement…',
  'Checking the network against the site…',
  'Re-checking the photo on the server…',
  'Running gradient-boosting classifier…',
  'Computing SHAP explanation…',
]

export default function Analysis() {
  const [n, setN] = useState(1)
  useEffect(() => {
    const id = setInterval(() => setN((v) => Math.min(LINES.length, v + 1)), 650)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="stack--lg stack">
      <div className="neural" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <div className="neural__core">
          <BrainCircuit size={28} />
        </div>
      </div>
      <div className="terminal" role="status" aria-live="polite">
        {LINES.slice(0, n).slice(-4).map((l) => (
          <div key={l}>&gt; {l}</div>
        ))}
      </div>
    </div>
  )
}
