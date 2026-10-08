import { useEffect, useRef } from 'react'
import { lerpPoints, projectPoints } from '../../lib/photoQuality/face/meshGraph.js'
import { paintMesh } from '../../lib/photoQuality/face/meshDraw.js'

// The face-analysis mesh over the preview. `targetRef.current` is the newest set of mesh points
// (normalised, or null when no face); landmarks arrive ~8 times a second, so every animation
// frame the drawn points glide a fraction of the way there and the whole mesh fades in/out.
export default function FaceMesh({ targetRef, fit, mirrored, accentRef = null }) {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !fit) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(fit.w * dpr)
    canvas.height = Math.round(fit.h * dpr)
    const ctx = canvas.getContext('2d')
    const scale = Math.max(0.8, Math.min(1.6, fit.w / 420))
    let cur = null
    let alpha = 0
    let raf

    const frame = (t) => {
      const target = targetRef.current
      if (target) cur = lerpPoints(cur, target, 0.35)
      alpha = Math.max(0, Math.min(1, alpha + (target ? 0.12 : -0.08)))
      if (!target && alpha === 0) cur = null
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, fit.w, fit.h)
      if (cur && alpha > 0) paintMesh(ctx, projectPoints(cur, fit.w, fit.h, mirrored), { alpha, scale, t, accent: !!accentRef?.current })
      const state = alpha > 0.3 ? 'on' : 'off'
      if (canvas.dataset.mesh !== state) canvas.dataset.mesh = state
      const acc = accentRef?.current ? 'on' : 'off'
      if (canvas.dataset.accent !== acc) canvas.dataset.accent = acc
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [fit?.w, fit?.h, mirrored, targetRef, accentRef])

  if (!fit) return null
  return <canvas ref={ref} className="facemesh" data-mesh="off" style={{ left: fit.x, top: fit.y, width: fit.w, height: fit.h }} aria-hidden="true" />
}
