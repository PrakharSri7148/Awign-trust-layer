import { useMemo, useState } from 'react'
import { KPIS, caseTitle, nextSort, sortRows, statusOf, whyList } from '../../lib/dashboard/model.js'
import SortHead from './SortHead.jsx'
import { EmptyState, SevPill, Skeleton, StatusDot, cx, fmtClock, fmtDay } from './ui.jsx'

// The cases to act on, open and most severe first. The KPI cards above choose which cases are listed ("lens").
export default function ReviewQueue({ rows, needsCount, view, kpi, onClearLens, activeId, onHover, onOpen, loading, onViewAll, siteName }) {
  const [sort, setSort] = useState({ key: null, dir: 'desc' })
  const lens = KPIS.find((k) => k.key === kpi)
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])
  const limit = view === 'queue' ? 60 : 7
  const shown = sorted.slice(0, limit)
  const open = rows.filter((r) => statusOf(r).key === 'open').length

  return (
    <section className={cx('queue')} aria-labelledby="queue-title" id="queue-panel" role="tabpanel" data-testid="review-queue">
      <div className={cx('panel__head')}>
        <div>
          <h2 className={cx('panel__title')} id="queue-title">Review queue <span className={cx('badge-count')} data-testid="review-count" aria-label="cases waiting for a reviewer">{needsCount}</span></h2>
          <p className={cx('panel__sub')} id="queue-sub">Open cases first, most severe at the top</p>
        </div>
        {view !== 'queue' && <button type="button" className={cx('btn', 'btn--sm')} onClick={onViewAll}>View all</button>}
      </div>
      {kpi !== 'submissions' && (
        <div className={cx('lens-note')}>
          <span>{lens.lens}</span>
          <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm')} onClick={onClearLens}>Show all</button>
        </div>
      )}
      <div className={cx('table-wrap')}>
        <table className={cx('table', 'table--rows', 'table--stack')} aria-labelledby="queue-title" aria-describedby="queue-sub">
          <thead>
            <tr>
              <SortHead id="case" label="Case" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
              <SortHead id="worker" label="Worker / Site" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
              <SortHead id="time" label="Time" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
              <SortHead id="severity" label="Severity" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
              <SortHead id="status" label="Status" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 6 }, (_, i) => <tr key={i} className={cx('skel-row')}>{[0, 1, 2, 3, 4].map((c) => <td key={c}><Skeleton h={14} w={`${50 + ((i + c) * 13) % 40}%`} /></td>)}</tr>)}
            {!loading && !shown.length && <tr><td colSpan={5}><EmptyState title="Nothing to review here">New submissions that need a decision will show up in this list as workers send them.</EmptyState></td></tr>}
            {!loading && shown.map((r) => (
              <tr key={r.id} tabIndex={0} data-testid="queue-row" data-id={r.id} aria-label={`Open case ${r.id}`} className={cx(r.id === activeId && 'is-active')}
                onClick={(e) => onOpen(r.id, e.currentTarget)} onMouseEnter={() => onHover(r.id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(r.id)}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(r.id, e.currentTarget) } }}>
                <td className={cx('cell--primary')}>
                  <div className={cx('cell-stack')}>
                    <span title={whyList(r).join(' · ')}>{caseTitle(r)}</span>
                    <small className={cx('mono')}>#{r.id} · {r.task_id}</small>
                  </div>
                </td>
                <td>
                  <div className={cx('cell-stack')}>
                    <span className={cx('mono', 'truncate')}>{r.worker_id}</span>
                    <small className={cx('truncate')}>{siteName(r.site_id)}</small>
                  </div>
                </td>
                <td>
                  <div className={cx('cell-stack')}><span className={cx('num')}>{fmtClock(r.timestamp)}</span><small>{fmtDay(r.timestamp)}</small></div>
                </td>
                <td className={cx('cell--end')}><SevPill p={r.fraud_probability} /></td>
                <td><StatusDot row={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={cx('queue__foot')}>
        <span>{!loading && shown.length ? `Showing ${shown.length} of ${rows.length} · ${open} open` : ''}</span>
      </div>
    </section>
  )
}
