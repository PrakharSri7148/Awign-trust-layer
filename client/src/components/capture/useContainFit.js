import { useLayoutEffect, useRef, useState } from 'react'

// Where a width x height picture lands inside its container when fitted with
// `object-fit: contain`: { x, y, w, h } in container pixels, so overlays can be
// positioned over the picture itself rather than the letterbox.
export function useContainFit(width, height) {
  const ref = useRef(null)
  const [fit, setFit] = useState(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !width || !height || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const { width: cw, height: ch } = entry.contentRect
      const s = Math.min(cw / width, ch / height)
      setFit({ w: width * s, h: height * s, x: (cw - width * s) / 2, y: (ch - height * s) / 2 })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [width, height])
  return [ref, fit]
}
