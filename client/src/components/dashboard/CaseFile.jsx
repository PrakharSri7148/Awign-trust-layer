import { motion } from 'framer-motion'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/api.js'
import { useToast } from '../../lib/contexts.jsx'
import { flagMeta, pct } from '../../lib/format.js'
import { CHECK_IDS, CHECK_LABELS } from '../../lib/photoQuality/schema.js'
import { FlagChips, PhotoBadge } from '../ui/PhotoBadge.jsx'
import CountUp from '../ui/CountUp.jsx'
import Gauge from '../ui/Gauge.jsx'
import ShapBars from '../ui/ShapBars.jsx'
import StatusBadge from '../ui/StatusBadge.jsx'

export default function CaseFile({ row, onClose }) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const flagged = row.status === 'flagged'
  const color = flagged ? 'var(--red)' : 'var(--green)'
  const isDemo = String(row.id).startsWith('demo-')
  const when = new Date(row.timestamp)

  // The list endpoint leaves the per-check report out; fetch it for this case.
  const [detail, setDetail] = useState(null)
  useEffect(() => {
    if (!row.has_photo || isDemo) return
    let alive = true
    fetch(`${API_BASE}/submissions/${row.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setDetail(d?.photo_quality ?? null))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [row.id, row.has_photo, isDemo])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function reset() {
    setBusy(true)
    try {
      if (!isDemo) {
        const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(row.site_id)}/reset-fingerprint`, { method: 'POST' })
        if (!res.ok) throw new Error(`Server responded ${res.status}`)
      }
      toast(`Fingerprint reset for ${row.site_id}${isDemo ? ' (demo)' : ''}`)
      setConfirming(false)
    } catch (err) {
      toast(`Reset failed: ${err.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const verdict = row.photo_verdict ?? 'unverified'
  const steps = [
    ['Submitted', when.toLocaleString()],
    ['Photo checked on device', 'edge validation · focus, light, lens, glare, shake, noise, face'],
    ['Photo re-checked by server', verdict === 'unverified' ? 'no photo to check' : `verdict: ${verdict}${row.client_mismatch ? ' · device report contradicted' : ''}`],
    ['Sensors read', 'GPS · motion · network'],
    ['Scored by classifier', `p = ${pct(row.fraud_probability)}`],
  ]

  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Case file ${row.id}`}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 36 }}
      >
        <div className="drawer__head">
          <div>
            <div className="eyebrow eyebrow--cyan">Case file · #{row.id}</div>
            <div className="drawer__status" style={{ color, marginTop: 4 }}>{flagged ? 'FLAGGED' : 'ACCEPTED'}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close case file" autoFocus>
            <X size={20} />
          </button>
        </div>

        <div className="drawer__gauge">
          <Gauge value={row.fraud_probability} mark={0.5} color={color} size={170} stroke={11} key={row.id}>
            <div className="eyebrow">Fraud prob.</div>
            <div className="num" style={{ fontSize: 30, fontWeight: 700, color }}>
              <CountUp to={row.fraud_probability * 100} decimals={1} suffix="%" />
            </div>
            <StatusBadge status={row.status} />
          </Gauge>
        </div>

        <div className="panel panel--tight">
          <div className="eyebrow eyebrow--cyan">Why?</div>
          <p style={{ margin: '6px 0 16px' }}>{row.top_reason}</p>
          <ShapBars importances={row.feature_importances} key={row.id} />
        </div>

        <PhotoSection row={row} detail={detail} verdict={verdict} />

        <dl className="kv">
          <dt>Worker</dt><dd>{row.worker_id}</dd>
          <dt>Task</dt><dd>{row.task_id}</dd>
          <dt>Site</dt><dd>{row.site_id}</dd>
        </dl>

        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Timeline</div>
          <ol className="timeline">
            {steps.map(([t, sub], i) => (
              <li key={t} className={i === steps.length - 1 ? (flagged ? 'end-red' : 'end-green') : ''}>
                {t}
                <small>{sub}</small>
              </li>
            ))}
          </ol>
        </div>

        {confirming ? (
          <div className="confirm" role="alertdialog" aria-label="Confirm reset">
            <div style={{ display: 'flex', gap: 10 }}>
              <AlertTriangle size={18} className="text-red" style={{ flex: 'none', marginTop: 2 }} />
              <span>The next submission for <b className="mono">{row.site_id}</b> becomes the new ambient baseline. This can't be undone.</span>
            </div>
            <div className="row">
              <button className="btn" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
              <button className="btn btn--danger" onClick={reset} disabled={busy}>{busy ? 'Resetting…' : 'Reset baseline'}</button>
            </div>
          </div>
        ) : (
          <button className="btn btn--danger" onClick={() => setConfirming(true)}>
            <RotateCcw size={16} /> Reset site fingerprint
          </button>
        )}
      </motion.aside>
    </>
  )
}

const ST = { pass: 'pass', warn: 'warn', fail: 'fail', skip: 'skip' }

function PhotoSection({ row, detail, verdict }) {
  const server = detail?.server
  const client = detail?.client
  const ev = detail?.evidence
  const flags = row.quality_flags ?? []
  const rows = server ? CHECK_IDS.filter((id) => server.checks[id]) : []
  const fmt = (c) => (c?.value == null ? '-' : Number(c.value).toFixed(2))

  return (
    <div className="panel panel--tight">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div className="eyebrow eyebrow--cyan">Photo</div>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="faint num" style={{ fontSize: 12 }}>quality {Math.round((row.photo_quality_score ?? 0) * 100)}/100</span>
          <PhotoBadge verdict={verdict} />
        </span>
      </div>

      {row.has_photo && (
        <a href={`${API_BASE}${row.photo_url}`} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 10 }}>
          <img className="photo-thumb" src={`${API_BASE}${row.photo_url}`} alt={`Photo submitted for case ${row.id}`} loading="lazy" />
        </a>
      )}

      {flags.length > 0 && (
        <>
          <div style={{ marginTop: 12 }}><FlagChips flags={flags} max={99} /></div>
          <ul className="help-list">
            {flags.map((f) => (
              <li key={f}><b>{flagMeta(f).label}.</b> {flagMeta(f).help}</li>
            ))}
          </ul>
        </>
      )}

      {rows.length > 0 && (
        <table className="checktable" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>Check</th><th>Server</th><th>Value</th><th>Device</th></tr>
          </thead>
          <tbody>
            {rows.map((id) => {
              const s = server.checks[id]
              const c = client?.checks?.[id]
              const differs = c && s.status !== c.status && s.status !== 'skip'
              return (
                <tr key={id} className={differs ? 'differs' : ''} title={s.hint ?? ''}>
                  <td>{CHECK_LABELS[id]}</td>
                  <td><span className={`st st--${ST[s.status]}`}>{s.status}</span></td>
                  <td className="num dim">{fmt(s)}</td>
                  <td>{c ? <span className={`st st--${ST[c.status] ?? 'skip'}`}>{c.status}</span> : <span className="faint">-</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {ev && (
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Capture</dt><dd>{ev.capture?.source === 'camera' ? 'In-app live camera' : 'Picked file'}{ev.capture?.burst ? ` · burst ${ev.capture.burst.picked + 1}/${ev.capture.burst.frames}` : ''}</dd>
          <dt>Camera</dt><dd>{[ev.exif?.make, ev.exif?.model].filter(Boolean).join(' ') || 'unknown'}</dd>
          <dt>EXIF time</dt><dd>{ev.exif?.taken_at ? new Date(ev.exif.taken_at).toLocaleString() : 'none'}</dd>
          {client?.sensor && (<><dt>Steadiness</dt><dd>{client.sensor.rotation_rms}°/s rot · {client.sensor.accel_rms} m/s² (device-reported)</dd></>)}
          {server?.metrics && (<><dt>Size</dt><dd>{server.metrics.width}×{server.metrics.height}</dd></>)}
        </dl>
      )}

      {!row.has_photo && <p className="dim" style={{ fontSize: 13, margin: '10px 0 0' }}>No photo is stored for this submission.</p>}
    </div>
  )
}
