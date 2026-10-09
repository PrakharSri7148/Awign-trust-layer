import { useContainFit } from './useContainFit.js'

// The photo shown "contain"-fitted, with labelled boxes drawn where a check found
// a problem (face, glare, covered lens). `boxes` are fractions of the photo:
//   { x0, y0, x1, y1, label, tone: 'ok' | 'warn' | 'bad' }
export default function PhotoOverlay({ src, width, height, boxes = [] }) {
  const [ref, fit] = useContainFit(width, height)
  return (
    <div className="vf-photo" ref={ref}>
      <img src={src} alt="Captured proof" />
      {fit &&
        boxes.map((b) => (
          <div
            key={b.label}
            className={`ovl ovl--${b.tone}`}
            style={{ left: fit.x + b.x0 * fit.w, top: fit.y + b.y0 * fit.h, width: (b.x1 - b.x0) * fit.w, height: (b.y1 - b.y0) * fit.h }}
          >
            <span>{b.label}</span>
          </div>
        ))}
    </div>
  )
}

// Boxes for the checks that can point at a region of the photo.
export function overlayBoxes(report) {
  if (!report) return []
  const boxes = []
  const tone = (c) => (c.status === 'pass' ? 'ok' : report.issues.find((i) => i.id === c.id)?.blocking ? 'bad' : 'warn')
  const face = report.checks.face
  if (face?.details?.box) {
    const b = face.details.box
    boxes.push({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h, label: 'face', tone: tone(face) })
  }
  const glare = report.checks.glare
  if (glare && glare.status !== 'pass' && glare.details?.bbox) {
    const b = glare.details.bbox
    boxes.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, label: 'glare', tone: 'warn' })
  }
  const lens = report.checks.obstruction
  if (lens && lens.status !== 'pass' && lens.details?.bbox) {
    const b = lens.details.bbox
    boxes.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, label: 'covered?', tone: tone(lens) })
  }
  return boxes
}
