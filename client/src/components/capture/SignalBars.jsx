// 4-bar signal indicator for the network reading: 4g = 4 bars, 3g = 2, 2g / slow-2g / slow = 1, anything else 0.
const BARS = { slow: 1, '3g': 2, '2g': 1, 'slow-2g': 1, '4g': 4 }
export const barsFor = (type) => BARS[type] ?? 0

export default function SignalBars({ type }) {
  const n = barsFor(type)
  return (
    <span className="cap-signal" role="img" aria-label={`Signal strength: ${n} of 4 bars`}>
      {[0, 1, 2, 3].map((i) => <i key={i} className={i < n ? 'is-on' : undefined} />)}
    </span>
  )
}
