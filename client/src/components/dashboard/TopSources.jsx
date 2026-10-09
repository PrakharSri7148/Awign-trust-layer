import { useMemo, useState } from 'react'
import { topSources } from '../../lib/dashboard/model.js'
import { EmptyState, cx } from './ui.jsx'

export default function TopSources({ rows, onPick, siteName }) {
  const [by, setBy] = useState('worker')
  const items = useMemo(() => topSources(rows, by), [rows, by])
  return (
    <section className={cx('panel', 'area-top')} aria-labelledby="top-title">
      <div className={cx('panel__head')}>
        <h2 className={cx('panel__title')} id="top-title">Top flagged sources</h2>
        <div className={cx('segmented')} role="radiogroup" aria-label="Rank by">
          {[['worker', 'Workers'], ['site', 'Sites']].map(([k, l]) => <button key={k} type="button" className={cx('segmented__item')} role="radio" aria-checked={by === k} onClick={() => setBy(k)}>{l}</button>)}
        </div>
      </div>
      <ol className={cx('sources')}>
        {!items.length && <li><EmptyState title="No flagged sources">Nothing has been flagged yet.</EmptyState></li>}
        {items.map((it, i) => (
          <li key={it.key}>
            <button type="button" className={cx('source-row')} onClick={() => onPick(it.key)}>
              <span className={cx('source-row__rank')}>{i + 1}</span>
              <span className={cx('source-row__main')}>
                <span className={cx('truncate', by === 'worker' && 'mono')} style={{ display: 'block' }}>{by === 'worker' ? it.key : siteName(it.key)}</span>
                {by === 'site' && <small>{it.key}</small>}
              </span>
              <span className={cx('badge-count')} aria-label={`${it.count} flagged`}>{it.count}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
