export default function Logo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="tl-g" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22d3ee" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d="M16 2.5 4.5 7v8.2c0 7 4.7 12.2 11.5 14.3 6.8-2.1 11.5-7.3 11.5-14.3V7L16 2.5Z" stroke="url(#tl-g)" strokeWidth="1.8" fill="rgba(34,211,238,0.08)" />
      <path d="M10 14h4l2 4 3-8 1.5 4H23" stroke="url(#tl-g)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="14" r="1.4" fill="#22d3ee" />
      <circle cx="23" cy="14" r="1.4" fill="#8b5cf6" />
    </svg>
  )
}
