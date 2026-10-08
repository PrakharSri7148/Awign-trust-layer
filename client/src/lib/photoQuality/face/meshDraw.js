// Paints the face mesh onto a 2D canvas context: thin glowing white lines, blue dots with a white
// ring (the "face analysis" look). Pure drawing, no DOM, so it can be tested on a Node canvas.
import { MESH_EDGE_INDEX } from './meshGraph.js'

export const MESH_STYLE = { line: '255,255,255', dot: '#2f6bff', ring: '#ffffff', accent: '#34d399' }

// px: [[x, y], ...] in canvas pixels (see projectPoints); alpha 0..1; t: ms clock for the pulse.
// accent: the requested liveness action is being detected right now -> the dots turn green and pulse harder.
export function paintMesh(ctx, px, { alpha = 1, scale = 1, t = 0, accent = false } = {}) {
  if (!px?.length || alpha <= 0) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  ctx.strokeStyle = `rgba(${MESH_STYLE.line},${0.85 * alpha})`
  ctx.lineWidth = 1.4 * scale
  ctx.shadowColor = `rgba(${MESH_STYLE.line},${0.9 * alpha})`
  ctx.shadowBlur = 8 * scale
  ctx.beginPath()
  for (const [a, b] of MESH_EDGE_INDEX) {
    ctx.moveTo(px[a][0], px[a][1])
    ctx.lineTo(px[b][0], px[b][1])
  }
  ctx.stroke()

  ctx.globalAlpha = alpha
  const dot = accent ? MESH_STYLE.accent : MESH_STYLE.dot
  ctx.shadowColor = dot
  ctx.shadowBlur = 10 * scale
  px.forEach(([x, y], i) => {
    const r = 4.6 * scale * (1 + (accent ? 0.22 : 0.08) * Math.sin(t / (accent ? 140 : 320) + i)) // a slow pulse, so it reads as "analysing"
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = dot
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.lineWidth = 1.8 * scale
    ctx.strokeStyle = MESH_STYLE.ring
    ctx.stroke()
    ctx.shadowBlur = 10 * scale
  })
  ctx.restore()
}
