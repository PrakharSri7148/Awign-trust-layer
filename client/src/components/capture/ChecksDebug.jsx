import { Bug, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { THRESHOLDS } from '../../lib/photoQuality/config.js'

// `?debug=checks`: every check with its raw value, the whole-frame blur tiles and the face-crop blur next to their
// thresholds, so "why was this refused" is one glance (same numbers as backend/tools/focus_diagnose.py). Renders nothing
// without the query parameter. In the redesign it opens as a drawer (a bottom sheet on phones) from a Diagnostics button.
const wanted = () => {
  try {
    return new URLSearchParams(window.location.search).get('debug') === 'checks'
  } catch {
    return false
  }
}

const n = (v, d = 3) => (v == null ? '—' : Number(v).toFixed(d))

export default function ChecksDebug({ report }) {
  const [open, setOpen] = useState(false)
  const opener = useRef(null)
  const closer = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    closer.current?.focus()
    const key = (e) => {
      if (e.key === 'Escape') { setOpen(false); opener.current?.focus() }
      if (e.key === 'Tab') { // keep focus inside the drawer
        const f = document.querySelectorAll('#cap-debug-drawer button, #cap-debug-drawer [href], #cap-debug-drawer input')
        if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault() }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault() }
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open])
  if (!wanted()) return null
  const t = THRESHOLDS
  const blur = report.checks.blur
  const face = report.checks.face?.details
  const crop = face?.crop
  const close = () => { setOpen(false); opener.current?.focus() }
  return (
    <>
      <button type="button" ref={opener} className="cap-btn cap-btn--sm cap-btn--ghost" onClick={() => setOpen(true)} data-testid="checks-debug-open">
        <Bug size={14} className="cap-icon" aria-hidden="true" /> Diagnostics: debug checks
      </button>
      {open && (
        <>
          <div className="cap-scrim" onClick={close} />
          <aside className="cap-drawer" role="dialog" aria-modal="true" aria-label="Debug checks" id="cap-debug-drawer">
            <div className="cap-drawer__head">
              <div><div className="cap-eyebrow">Diagnostics</div><h2 className="cap-card__title">Debug: checks</h2></div>
              <button type="button" ref={closer} className="cap-icon-btn" aria-label="Close diagnostics" onClick={close}><X size={18} className="cap-icon" aria-hidden="true" /></button>
            </div>
            <div className="cap-drawer__body" data-testid="checks-debug">
              <table className="cap-debug cap-num">
                <thead><tr><th>check</th><th>status</th><th>value</th><th>hint</th></tr></thead>
                <tbody>
                  {Object.values(report.checks).map((c) => (
                    <tr key={c.id}><td>{c.id}</td><td>{c.status}</td><td>{n(c.value)}</td><td>{c.hint ?? ''}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="cap-mono cap-muted" style={{ marginTop: 12, display: 'grid', gap: 6 }}>
                <div>
                  blur {n(blur?.value)} [fail &lt; {t.blur.failBelow}, warn &lt; {t.blur.warnBelow}] · tiles{' '}
                  {(blur?.details?.tileScores ?? []).map((s) => n(s, 2)).join(' ') || '—'} · textured {blur?.details?.texturedTiles ?? '—'}
                </div>
                {face && (
                  <div>
                    face {n(face.score, 2)} conf · height {n(face.heightFrac, 2)} · crop blur {n(crop?.blur)} on {crop?.width ?? '?'}×{crop?.height ?? '?'} px [fail &lt; {t.face.cropBlurFail}, warn &lt; {t.face.cropBlurWarn}]
                  </div>
                )}
                <div>verdict {report.verdict} · blocking {report.issues.filter((i) => i.blocking).map((i) => i.id).join(', ') || 'none'}</div>
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  )
}
