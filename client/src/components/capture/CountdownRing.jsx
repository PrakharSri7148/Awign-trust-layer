// The 3.0 -> 0.0 s countdown of the Motion reading: a ring that fills as the time passes, the seconds left in the middle.
export default function CountdownRing({ left, total }) {
  const secs = (left / 1000).toFixed(1)
  const p = Math.max(0, Math.min(1, 1 - left / total))
  return (
    <div className="cap-ring" role="meter" aria-label="Motion sampling time left" aria-valuemin={0} aria-valuemax={total / 1000} aria-valuenow={Number(secs)} aria-valuetext={`${secs} s left`} style={{ '--p': p.toFixed(3) }}>
      <svg viewBox="0 0 52 52" aria-hidden="true">
        <circle className="cap-ring__track" cx="26" cy="26" r="20" pathLength="100" />
        <circle className="cap-ring__bar" cx="26" cy="26" r="20" pathLength="100" />
      </svg>
      <span className="cap-ring__num" aria-hidden="true">{secs}</span>
    </div>
  )
}
