import { useEffect, useState } from 'react'

// How the camera is laid out for the current viewport:
//   side     >= 1000 px  a large stage with the metrics panel beside it
//   under    721-999 px  the stage at full width, the metrics under it
//   overlay  <= 720 px   phones: an immersive full-viewport camera, metrics overlaid above the shutter
export const BREAKPOINTS = { side: 1000, overlay: 720 }

export const layoutFor = (width) => (width >= BREAKPOINTS.side ? 'side' : width > BREAKPOINTS.overlay ? 'under' : 'overlay')

export function useLayoutMode() {
  const read = () => (typeof window === 'undefined' ? 'side' : layoutFor(window.innerWidth))
  const [mode, setMode] = useState(read)
  useEffect(() => {
    const on = () => setMode(read())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return mode
}
