import { useCountUp } from '../../lib/useSubmissions.js'

export default function CountUp({ to, decimals = 0, suffix = '', duration }) {
  const v = useCountUp(to, duration)
  return (
    <span className="num">
      {v.toFixed(decimals)}
      {suffix}
    </span>
  )
}
