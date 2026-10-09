import { THRESHOLDS } from '../../lib/photoQuality/config.js'

// `?debug=checks`: every check with its raw value, the whole-frame blur tiles and the face-crop
// blur next to their thresholds, so "why was this refused" is one glance (same numbers as
// backend/tools/focus_diagnose.py). Renders nothing without the query parameter.
const wanted = () => {
  try {
    return new URLSearchParams(window.location.search).get('debug') === 'checks'
  } catch {
    return false
  }
}

const n = (v, d = 3) => (v == null ? '—' : Number(v).toFixed(d))

export default function ChecksDebug({ report }) {
  if (!wanted()) return null
  const t = THRESHOLDS
  const blur = report.checks.blur
  const face = report.checks.face?.details
  const crop = face?.crop
  return (
    <details open className="qc__debug" data-testid="checks-debug">
      <summary>Debug: checks</summary>
      <table className="num">
        <tbody>
          {Object.values(report.checks).map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td>{c.status}</td>
              <td>{n(c.value)}</td>
              <td>{c.hint ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="num">
        blur {n(blur?.value)} [fail &lt; {t.blur.failBelow}, warn &lt; {t.blur.warnBelow}] · tiles{' '}
        {(blur?.details?.tileScores ?? []).map((s) => n(s, 2)).join(' ') || '—'} · textured {blur?.details?.texturedTiles ?? '—'}
      </div>
      {face && (
        <div className="num">
          face {n(face.score, 2)} conf · height {n(face.heightFrac, 2)} · crop blur {n(crop?.blur)} on {crop?.width ?? '?'}×{crop?.height ?? '?'} px [fail &lt; {t.face.cropBlurFail}, warn &lt; {t.face.cropBlurWarn}]
        </div>
      )}
      <div className="num">verdict {report.verdict} · blocking {report.issues.filter((i) => i.blocking).map((i) => i.id).join(', ') || 'none'}</div>
    </details>
  )
}
