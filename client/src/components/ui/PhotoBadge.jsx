import { VERDICT_META, flagMeta } from '../../lib/format.js'

// The server's verdict on the photo, as a small badge.
export function PhotoBadge({ verdict }) {
  const m = VERDICT_META[verdict] ?? VERDICT_META.unverified
  return <span className={`pbadge pbadge--${m.tone}`}>{m.label}</span>
}

// Flags as chips: quality problems and integrity concerns stand out, plain context is muted.
export function FlagChips({ flags = [], max = 2 }) {
  if (!flags.length) return <span className="faint">-</span>
  const shown = flags.slice(0, max)
  return (
    <span className="flagchips">
      {shown.map((f) => {
        const m = flagMeta(f)
        return <span key={f} className={`flagchip flagchip--${m.kind}`} title={m.help}>{m.label}</span>
      })}
      {flags.length > max && <span className="flagchip flagchip--info" title={flags.slice(max).map((f) => flagMeta(f).label).join(', ')}>+{flags.length - max}</span>}
    </span>
  )
}
