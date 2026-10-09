import { useEffect, useState } from 'react'
import { caseTitle, severity, whyList } from '../../lib/dashboard/model.js'
import { EmptyState, Icon, SevPill, Skeleton, cx, relTime } from './ui.jsx'

// Accordion of the cases waiting for a reviewer. Refresh reloads from the server.
export default function NeedsReview({ rows, loading, refreshing, onRefresh, lastUpdated, onOpen, siteName }) {
  const list = rows.slice(0, 5)
  const [openId, setOpenId] = useState(null)
  useEffect(() => { if (openId === null && list[0]) setOpenId(list[0].id) }, [openId, list])
  const busy = loading || refreshing

  return (
    <section className={cx('panel', 'area-needs')} aria-labelledby="needs-title">
      <div className={cx('panel__head')}>
        <h2 className={cx('panel__title')} id="needs-title">Needs review</h2>
        <button type="button" className={cx('btn', 'btn--sm', 'btn--accent-outline', refreshing && 'is-spinning')} onClick={onRefresh} disabled={refreshing} aria-label={refreshing ? 'Refreshing' : 'Refresh needs review list'}>
          <Icon name="refresh-cw" />Refresh
        </button>
      </div>
      <p className={cx('needs-updated')} aria-live="polite">{refreshing ? 'Refreshing…' : lastUpdated ? `Updated ${relTime(lastUpdated)}` : 'Connecting…'}</p>
      <div className={cx('needs-list')} aria-busy={busy || undefined}>
        {busy && list.length === 0 && [1, 2, 3, 4].map((i) => <div key={i} className={cx('accordion__item')} style={{ padding: 14 }}><Skeleton h={14} w="60%" /><div style={{ marginTop: 8 }}><Skeleton h={10} w="30%" /></div></div>)}
        {!busy && !list.length && <EmptyState icon="circle-check" title="All caught up">There is nothing waiting for a decision. New flagged cases will appear here.</EmptyState>}
        {list.map((r) => {
          const open = r.id === openId
          const crit = severity(r.fraud_probability).key === 'critical'
          const why = whyList(r)
          return (
            <div key={r.id} className={cx('accordion__item', open && 'is-open')}>
              <button type="button" className={cx('accordion__trigger')} aria-expanded={open} aria-controls={`need-${r.id}`} onClick={() => setOpenId(open ? 0 : r.id)}>
                <span>
                  <span className={cx('accordion__title')}>{caseTitle(r)}{crit && <span style={{ color: 'var(--color-crit)' }}><Icon name="triangle-alert" /><span className={cx('sr-only')}>Critical</span></span>}</span>
                  <span className={cx('accordion__meta')}>{relTime(r.timestamp)} · #{r.id}</span>
                </span>
                <Icon name="chevron-down" className="accordion__chev" />
              </button>
              <div className={cx('accordion__panel')} id={`need-${r.id}`} role="region" hidden={!open}>
                <div className={cx('needs-summary')}>
                  <p>{r.top_reason}</p>
                  {why.length > 0 && <p className={cx('text-xs', 'text-2')}>Why it is here: {why.join(' · ')}</p>}
                  <dl className={cx('kv')}><dt className={cx('text-2')}>Affected site</dt><dd>{siteName(r.site_id)}</dd><dt className={cx('text-2')}>Severity</dt><dd><SevPill p={r.fraud_probability} /></dd></dl>
                  <button type="button" className={cx('btn', 'btn--block')} style={{ marginTop: 6 }} onClick={(e) => onOpen(r.id, e.currentTarget)}>More details</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
