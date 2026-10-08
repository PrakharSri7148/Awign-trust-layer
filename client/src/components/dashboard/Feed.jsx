import { motion } from 'framer-motion'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { setToken } from '../../lib/auth.js'
import { FACTORS, flagMeta, matchesPhoto, pct, relTime } from '../../lib/format.js'
import { FlagChips, PhotoBadge } from '../ui/PhotoBadge.jsx'
import StatusBadge from '../ui/StatusBadge.jsx'

const PAGE = 25
const FILTERS = ['all', 'flagged', 'accepted']


export default function Feed({ rows, loading, error, fresh, onReload, onOpen }) {
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [photo, setPhoto] = useState('all')
  const [limit, setLimit] = useState(PAGE)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(id)
  }, [])

  const counts = {
    all: rows.length,
    flagged: rows.filter((r) => r.status === 'flagged').length,
    accepted: rows.filter((r) => r.status === 'accepted').length,
  }
  const photoFlags = [...new Set(rows.flatMap((r) => r.quality_flags ?? []))].sort()
  const needle = q.trim().toLowerCase()
  const visible = rows.filter(
    (r) =>
      (filter === 'all' || r.status === filter) &&
      matchesPhoto(r, photo) &&
      (!needle || [r.id, r.worker_id, r.site_id, r.task_id].some((v) => String(v).toLowerCase().includes(needle))),
  )
  const shown = visible.slice(0, limit)

  return (
    <section className="panel" aria-label="Live submissions">
      <div className="feed-bar">
        <div className="seg" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => { setFilter(f); setLimit(PAGE) }}>
              {filter === f && <motion.span layoutId="seg-pill" className="seg__pill" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
              <span style={{ textTransform: 'capitalize' }}>{f}</span>
              <span className="count">{counts[f]}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={15} />
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} placeholder="Search worker, site, task or ID" aria-label="Search submissions" />
        </label>
        <label className="select">
          <span className="visually-hidden">Filter by photo issue</span>
          <select value={photo} onChange={(e) => { setPhoto(e.target.value); setLimit(PAGE) }} aria-label="Filter by photo issue">
            <option value="all">Photo: all</option>
            <option value="any">Photo: any issue</option>
            <option value="unverified">Photo: unverified</option>
            {photoFlags.map((f) => <option key={f} value={f}>Photo: {flagMeta(f).label}</option>)}
          </select>
        </label>
        <span className="faint num" style={{ marginLeft: 'auto', fontSize: 12 }}>{visible.length} of {rows.length} shown</span>
      </div>

      {error === 'UNAUTHORIZED' ? (
        <form
          className="banner banner--error"
          role="alert"
          style={{ marginBottom: 'var(--s2)' }}
          onSubmit={(e) => { e.preventDefault(); setToken(new FormData(e.currentTarget).get('token')?.toString().trim() ?? ''); onReload() }}
        >
          <span>This dashboard needs an access token.</span>
          <input name="token" type="password" autoComplete="off" aria-label="Access token" style={{ margin: '0 8px' }} />
          <button className="btn btn--sm btn--primary" type="submit">Unlock</button>
        </form>
      ) : error ? (
        <div className="banner banner--error" role="alert" style={{ marginBottom: 'var(--s2)' }}>
          <span>Error loading submissions: {error}</span>
          <button className="btn btn--sm btn--danger" onClick={onReload}>Retry</button>
        </div>
      ) : null}

      {loading && rows.length === 0 ? (
        <div aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" />)}</div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <div className="radar" aria-hidden="true" />
          <div style={{ fontWeight: 600, color: 'var(--text)' }}>{rows.length ? 'No matching submissions' : 'No submissions yet'}</div>
          <div style={{ fontSize: 13 }}>{rows.length ? 'Try a different filter or search.' : 'Waiting for field data… or toggle DEMO to preview.'}</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="feed">
            <thead>
              <tr>
                {['ID', 'Worker', 'Task', 'Site', 'Time', 'Status', 'Photo', 'Fraud prob.', 'Top reason', 'SHAP mix'].map((h) => <th key={h} scope="col">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr
                  key={s.id}
                  className={fresh.has(s.id) ? 'fresh' : ''}
                  tabIndex={0}
                  onClick={() => onOpen(s)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(s))}
                >
                  <td className="mono text-cyan">#{s.id}</td>
                  <td className="mono">{s.worker_id}</td>
                  <td className="mono dim">{s.task_id}</td>
                  <td className="mono dim">{s.site_id}</td>
                  <td className="dim" title={new Date(s.timestamp).toLocaleString()}>{relTime(s.timestamp, now)}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td>
                    <div className="photocell">
                      <PhotoBadge verdict={s.photo_verdict ?? 'unverified'} />
                      <FlagChips flags={s.quality_flags} max={2} />
                      {s.review && <span className={`st st--${s.review.decision === 'approve' ? 'pass' : 'fail'}`} title={`${s.review.decision} by ${s.review.reviewer}`}>{s.review.decision === 'approve' ? 'reviewed ✓' : s.review.decision === 'reject' ? 'rejected' : 'retake'}</span>}
                    </div>
                  </td>
                  <td>
                    <div className="pbar">
                      <div className="pbar__track">
                        <div className="pbar__fill" style={{ width: `${s.fraud_probability * 100}%`, background: s.status === 'flagged' ? 'var(--red)' : 'var(--green)', boxShadow: `0 0 8px ${s.status === 'flagged' ? 'var(--red)' : 'var(--green)'}` }} />
                        <div className="pbar__mark" />
                      </div>
                      <span className="num" style={{ width: 52, textAlign: 'right' }}>{pct(s.fraud_probability)}</span>
                    </div>
                  </td>
                  <td className="cell-reason" title={s.top_reason}>{s.top_reason}</td>
                  <td>
                    <div className="stack-bar" title={FACTORS.map((f) => `${f.label} ${pct(s.feature_importances?.[f.key] ?? 0)}`).join(' · ')}>
                      {FACTORS.map((f) => <i key={f.key} style={{ width: `${(s.feature_importances?.[f.key] ?? 0) * 100}%`, background: f.color }} />)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {visible.length > limit && (
        <div style={{ textAlign: 'center', marginTop: 'var(--s2)' }}>
          <button className="btn btn--sm" onClick={() => setLimit((l) => l + PAGE)}>Load {Math.min(PAGE, visible.length - limit)} more</button>
        </div>
      )}
    </section>
  )
}
