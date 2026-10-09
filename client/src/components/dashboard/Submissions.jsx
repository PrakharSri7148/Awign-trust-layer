import { useEffect, useMemo, useRef, useState } from 'react'
import { setToken } from '../../lib/auth.js'
import { flagMeta } from '../../lib/format.js'
import { decisionMeta, filterSubmissions, isDemoRow, nextSort, pctText, sortRows } from '../../lib/dashboard/model.js'
import Popover from './Popover.jsx'
import SortHead from './SortHead.jsx'
import { EmptyState, Icon, SevPill, Skeleton, StatusDot, cx, fmtClock, fmtDay } from './ui.jsx'

const PER = 10

// Every submission: filter by status, date range, photo issue and search; sort any column; page through. A row opens its case file.
export default function Submissions({ rows, loading, error, onReload, onOpen, onVisible, seed, siteName, toast, view }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [range, setRange] = useState('7')
  const [photo, setPhoto] = useState('all')
  const [sort, setSort] = useState({ key: 'time', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [menu, setMenu] = useState(null) // { id, anchor }
  const anchors = useRef(new Map())
  const tokenRef = useRef(null)

  // "Top flagged sources" (and the search box) hand over a search term
  useEffect(() => { if (seed) { setSearch(seed.value); setRange('all'); setPage(1) } }, [seed])

  const flags = useMemo(() => [...new Set(rows.flatMap((r) => r.quality_flags ?? []))].sort(), [rows])
  const filtered = useMemo(() => sortRows(filterSubmissions(rows, { status, range, photo, search }), sort), [rows, status, range, photo, search, sort])
  const pages = Math.max(1, Math.ceil(filtered.length / PER))
  const cur = Math.min(page, pages)
  const shown = filtered.slice((cur - 1) * PER, cur * PER)
  useEffect(() => { onVisible?.(filtered.map((r) => r.id)) }, [filtered, onVisible])

  const clear = () => { setSearch(''); setStatus('all'); setRange('all'); setPhoto('all'); setPage(1) }
  const onSort = (k) => { setSort(nextSort(sort, k, 'time')); setPage(1) }
  const menuRow = menu ? rows.find((r) => r.id === menu.id) : null

  const act = (a, r) => {
    setMenu(null)
    if (a === 'copy') {
      const url = `${location.origin}${location.pathname}#case/${r.id}`
      ;(navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject(new Error('no clipboard'))).then(() => toast('Link copied', { text: `Case #${r.id}` }), () => toast('Could not copy the link', { type: 'error', text: 'Copy it from the address bar after opening the case.' }))
    } else onOpen(r.id, anchors.current.get(r.id), a === 'open' ? null : a)
  }

  return (
    <section className={cx('panel', 'area-subs')} aria-labelledby="subs-title" id="all-submissions">
      <div className={cx('panel__head')}>
        <div>
          <h2 className={cx('panel__title')} id="subs-title">All submissions</h2>
          <p className={cx('panel__sub')} id="subs-count" aria-live="polite">{loading ? 'Loading…' : `${filtered.length} of ${rows.length} shown`}</p>
        </div>
        <div className={cx('subs-controls')}>
          <div className={cx('input-group')}>
            <Icon name="search" />
            <input className={cx('input')} type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Search ID, worker, site, task" aria-label="Search submissions" />
          </div>
          <select className={cx('select')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} aria-label="Filter by status">
            <option value="all">All statuses</option><option value="open">Open</option><option value="resolved">Resolved</option><option value="accepted">Accepted</option>
          </select>
          <select className={cx('select')} value={photo} onChange={(e) => { setPhoto(e.target.value); setPage(1) }} aria-label="Filter by photo issue">
            <option value="all">Photo: all</option><option value="any">Photo: any issue</option><option value="unverified">Photo: unverified</option>
            {flags.map((f) => <option key={f} value={f}>Photo: {flagMeta(f).label}</option>)}
          </select>
          <select className={cx('select')} value={range} onChange={(e) => { setRange(e.target.value); setPage(1) }} aria-label="Date range">
            <option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="all">All time</option>
          </select>
        </div>
      </div>

      {error === 'UNAUTHORIZED' ? (
        <div className={cx('banner', 'banner--error')}>
          <form className={cx('banner__form')} role="alert" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('token')?.toString().trim() ?? ''; if (!v) { tokenRef.current?.focus(); return } setToken(v); onReload() }}>
            <span><Icon name="lock" />This dashboard needs an access token.</span>
            <label className={cx('sr-only')} htmlFor="dash-token">Access token</label>
            <input ref={tokenRef} id="dash-token" className={cx('input')} name="token" type="password" autoComplete="off" placeholder="Access token" aria-label="Access token" />
            <button type="submit" className={cx('btn', 'btn--primary', 'btn--sm')}>Unlock</button>
          </form>
        </div>
      ) : error ? (
        <div className={cx('banner', 'banner--error')}>
          <div className={cx('banner__form')} role="alert"><span><Icon name="circle-alert" />We could not load the latest submissions ({error}). Check your connection and try again.</span><button type="button" className={cx('btn', 'btn--sm', 'btn--danger')} onClick={onReload}>Retry</button></div>
        </div>
      ) : null}

      <div className={cx('table-wrap')}>
        <table className={cx('table', 'table--rows', 'table--stack')} aria-labelledby="subs-title" data-testid="subs-table">
          <thead>
            <tr>
              <SortHead id="id" label="ID" sort={sort} onSort={onSort} />
              <SortHead id="task" label="Task" sort={sort} onSort={onSort} />
              <SortHead id="time" label="Date" sort={sort} onSort={onSort} />
              <SortHead id="worker" label="Worker" sort={sort} onSort={onSort} />
              <SortHead id="site" label="Site" sort={sort} onSort={onSort} />
              <SortHead id="severity" label="Severity" sort={sort} onSort={onSort} />
              <SortHead id="status" label="Status" sort={sort} onSort={onSort} />
              <th scope="col"><span className={cx('sr-only')}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && Array.from({ length: 6 }, (_, i) => <tr key={i} className={cx('skel-row')}>{Array.from({ length: 8 }, (_, c) => <td key={c}><Skeleton h={14} w={`${50 + ((i + c) * 13) % 40}%`} /></td>)}</tr>)}
            {!(loading && rows.length === 0) && !shown.length && (
              <tr><td colSpan={8}>
                <EmptyState icon="search" title={rows.length ? 'No submissions match these filters' : 'No submissions yet'}
                  action={rows.length ? <button type="button" className={cx('btn', 'btn--sm')} style={{ marginTop: 6 }} onClick={clear}>Clear filters</button> : null}>
                  {rows.length ? 'Try a different search, status or date range.' : 'Waiting for the first photo from the field. It will appear here as soon as a worker sends it.'}
                </EmptyState>
              </td></tr>
            )}
            {shown.map((r) => {
              const f = (r.quality_flags ?? []).map((x) => flagMeta(x).label)
              return (
                <tr key={r.id} tabIndex={0} data-id={r.id} aria-label={`Open case ${r.id}`}
                  onClick={(e) => onOpen(r.id, e.currentTarget)}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(r.id, e.currentTarget) } }}>
                  <td className={cx('cell--primary')}><span className={cx('mono')}>#{r.id}</span></td>
                  <td className={cx('cell--wide')}>
                    <div className={cx('cell-stack')}><span>{r.task_id}</span>{f.length > 0 && <small>{f.slice(0, 2).join(', ')}{f.length > 2 && <> +{f.length - 2}<span className={cx('sr-only')}>: {f.slice(2).join(', ')}</span></>}</small>}</div>
                  </td>
                  <td><div className={cx('cell-stack')}><span>{fmtDay(r.timestamp)}</span><small className={cx('num')}>{fmtClock(r.timestamp)}</small></div></td>
                  <td><span className={cx('mono')}>{r.worker_id}</span></td>
                  <td><div className={cx('cell-stack')}><span className={cx('truncate')}>{siteName(r.site_id)}</span>{siteName(r.site_id) !== r.site_id && <small className={cx('mono')}>{r.site_id}</small>}</div></td>
                  <td className={cx('cell--end')}><span className={cx('sev-cell')}><SevPill p={r.fraud_probability} /><span className={cx('num', 'text-2', 'text-xs')}>{pctText(r.fraud_probability)}</span></span></td>
                  <td>
                    <div className={cx('cell-stack')}><StatusDot row={r} />{r.review && <small>{decisionMeta(r.review.decision).label.toLowerCase()} by {r.review.reviewer}</small>}</div>
                  </td>
                  <td className={cx('cell--wide')}>
                    <button type="button" ref={(el) => { if (el) anchors.current.set(r.id, el) }} className={cx('icon-btn')} aria-haspopup="menu" aria-expanded={menu?.id === r.id} aria-label={`Actions for case ${r.id}`}
                      onClick={(e) => { e.stopPropagation(); setMenu(menu?.id === r.id ? null : { id: r.id }) }}><Icon name="ellipsis-vertical" /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {menu && menuRow && (
        <Popover anchorRef={{ current: anchors.current.get(menu.id) }} open onClose={(focus) => { const a = anchors.current.get(menu.id); setMenu(null); if (focus) a?.focus() }} role="menu" label={`Actions for case ${menu.id}`} width={210}>
          <button type="button" className={cx('menu__item')} role="menuitem" onClick={() => act('open', menuRow)}><Icon name="eye" />Open case</button>
          {!isDemoRow(menuRow) && (<>
            <div className={cx('menu__sep')} role="separator" />
            <button type="button" className={cx('menu__item')} role="menuitem" onClick={() => act('approve', menuRow)}><Icon name="circle-check" />Approve…</button>
            <button type="button" className={cx('menu__item')} role="menuitem" onClick={() => act('reject', menuRow)}><Icon name="circle-x" />Reject…</button>
            <button type="button" className={cx('menu__item')} role="menuitem" onClick={() => act('needs_retake', menuRow)}><Icon name="rotate-ccw" />Needs retake…</button>
          </>)}
          <div className={cx('menu__sep')} role="separator" />
          <button type="button" className={cx('menu__item')} role="menuitem" onClick={() => act('copy', menuRow)}><Icon name="copy" />Copy case link</button>
        </Popover>
      )}
      {shown.length > 0 && (
        <div className={cx('pager')}>
          <span>Showing {(cur - 1) * PER + 1}–{(cur - 1) * PER + shown.length} of {filtered.length}</span>
          <div className={cx('pager__btns')}>
            <button type="button" className={cx('btn', 'btn--sm')} disabled={cur <= 1} onClick={() => setPage(cur - 1)}><Icon name="chevron-left" />Previous</button>
            <span style={{ alignSelf: 'center' }}>Page {cur} of {pages}</span>
            <button type="button" className={cx('btn', 'btn--sm')} disabled={cur >= pages} onClick={() => setPage(cur + 1)}>Next<Icon name="chevron-right" /></button>
          </div>
        </div>
      )}
    </section>
  )
}
