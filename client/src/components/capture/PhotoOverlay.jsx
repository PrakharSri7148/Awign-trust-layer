import { useContainFit } from './useContainFit.js'

// The captured photo in the stage, "contain"-fitted, with labelled boxes drawn where a check found a problem (face,
// glare, covered lens). While the checks run: a scan line and the terminal line over the photo.
//   `boxes` are fractions of the photo: { x0, y0, x1, y1, label, tone: 'ok' | 'warn' | 'bad' }
export default function PhotoOverlay({ src, width, height, boxes = [], checking = false, needsFace = false, blocked = false }) {
  const [ref, fit] = useContainFit(width, height)
  const ar = width && height ? width / height : 4 / 3
  return (
    <div className={`cap-stage cap-on-camera${blocked ? ' cap-stage--blocked' : ''}`} style={{ '--cap-ar': `${ar}`, '--cap-ar-num': ar }} data-stage="photo">
      <div className="cap-photo" ref={ref}>
        <div className="cap-photo__frame"><img src={src} alt="Captured proof" /></div>
        {fit &&
          boxes.map((b) => {
            const top = fit.y + b.y0 * fit.h
            return (
              <div
                key={b.label}
                className={`cap-box cap-box--${b.tone}${top < 30 ? ' cap-box--lower' : ''}`}
                style={{ left: fit.x + b.x0 * fit.w, top, width: (b.x1 - b.x0) * fit.w, height: (b.y1 - b.y0) * fit.h }}
              >
                <span className="cap-box__label">{b.label}</span>
              </div>
            )
          })}
      </div>
      {checking && <div className="cap-scanline" aria-hidden="true" />}
      {checking && <div className="cap-terminal" role="status">&gt; Checking focus, lighting, lens{needsFace ? ', face' : ''} on-device…</div>}
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
