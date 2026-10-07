import { useEffect, useState } from 'react'

// Radial gauge. value/mark are fractions 0..1; mark draws a threshold tick.
export default function Gauge({ value, mark, color = 'var(--cyan)', size = 160, stroke = 10, children }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(Math.max(0, Math.min(1, value))))
    return () => cancelAnimationFrame(id)
  }, [value])

  const r = (size - stroke) / 2 - 4
  const c = 2 * Math.PI * r
  const mid = size / 2

  return (
    <div className="gauge" style={{ width: size, height: size, color }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="gauge__track" cx={mid} cy={mid} r={r} strokeWidth={stroke} />
        <circle
          className="gauge__arc"
          cx={mid}
          cy={mid}
          r={r}
          strokeWidth={stroke}
          stroke="currentColor"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
        />
        {mark != null && (
          <line
            x1={mid + r - stroke}
            x2={mid + r + stroke}
            y1={mid}
            y2={mid}
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            transform={`rotate(${mark * 360} ${mid} ${mid})`}
          />
        )}
      </svg>
      <div className="gauge__center">{children}</div>
    </div>
  )
}
