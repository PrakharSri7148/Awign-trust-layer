import { ShieldAlert, ShieldCheck } from 'lucide-react'

export default function StatusBadge({ status }) {
  const flagged = status === 'flagged'
  const Icon = flagged ? ShieldAlert : ShieldCheck
  return (
    <span className={`badge badge--${flagged ? 'flagged' : 'accepted'}`}>
      <Icon size={13} />
      {status}
    </span>
  )
}
