import { useLayoutEffect, useRef, useState } from 'react'

// Where a width x height picture lands inside its container when fitted with
// `object-fit: contain`: { x, y, w, h } in container pixels, so overlays can be
// positioned over the picture itself rather than the letterbox.
// mode 'cover' is the same for an `object-fit: cover` picture (x / y go negative, the picture is cropped by the container).
export function useContainFit(width, height, mode = 'contain') {
  const ref = useRef(null)
  const [fit, setFit] = useState(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !width || !height || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const { width: cw, height: ch } = entry.contentRect
      const s = mode === 'cover' ? Math.max(cw / width, ch / height) : Math.min(cw / width, ch / height)
      setFit({ w: width * s, h: height * s, x: (cw - width * s) / 2, y: (ch - height * s) / 2 })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [width, height, mode])
  return [ref, fit]
}
