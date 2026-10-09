import { useEffect, useMemo, useRef, useState } from 'react'
import { MAPS } from '../../lib/dashboard/mapData.js'
import { mapMarkers, pctText, severity } from '../../lib/dashboard/model.js'
import { EmptyState, Icon, SevPill, Skeleton, cx, fmtDateTime } from './ui.jsx'

const LEGEND = [['critical', 'Critical', 'var(--color-crit)'], ['high', 'High', 'var(--color-high)'], ['medium', 'Medium', 'var(--color-warn)'], ['low', 'Low', 'var(--color-neutral)']]

// Hex-dot map. Markers are real buttons (focusable, keyboard-operable) laid over the dots. They sit on each submission's REGISTERED site
// (a submission carries no coordinates of its own); "Show as table" is the text alternative.
export default function SubmissionMap({ rows, sites, sitesError, hidden, onToggle, onShowAll, viewKey, onViewKey, asTable, onAsTable, activeId, onSelect, onOpen, loading, onGoSettings }) {
  const sitesById = useMemo(() => new Map((sites ?? []).map((s) => [s.site_id, s])), [sites])
  const { view, markers, outside, unplaced } = useMemo(() => mapMarkers(rows, sitesById, viewKey, hidden), [rows, sitesById, viewKey, hidden])
  const canvasRef = useRef(null)
  const [tip, setTip] = useState(null) // { id, left, top, pinned }
  const hideT = useRef(null)
  const row = tip ? rows.find((r) => r.id === tip.id) : null
  const dotR = viewKey === 'world' ? 1.7 : 0.62

  const show = (m, el, pinned = false) => {
    clearTimeout(hideT.current)
    const c = canvasRef.current.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    let left = b.left - c.left + 14
    if (left + 232 > c.width) left = b.left - c.left - 232 - 8
    setTip({ id: m.row.id, left: Math.max(4, left), top: Math.max(4, Math.min(b.top - c.top - 60, c.height - 150)), pinned })
  }
  const hideSoon = () => { clearTimeout(hideT.current); hideT.current = setTimeout(() => setTip((t) => (t && t.pinned ? t : null)), 160) }
  useEffect(() => () => clearTimeout(hideT.current), [])
  useEffect(() => { setTip(null) }, [viewKey, hidden, rows.length])

  const noSites = sites && sites.length === 0

  return (
    <section className={cx('mapcard')} aria-labelledby="map-title">
      <div className={cx('panel__head')}>
        <div>
          <h2 className={cx('panel__title')} id="map-title">Submission map</h2>
          <p className={cx('panel__sub')}>Each submission at its registered site</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className={cx('segmented')} role="radiogroup" aria-label="Map area">
            {[['asia', 'South Asia'], ['world', 'World']].map(([k, l]) => <button key={k} type="button" className={cx('segmented__item')} role="radio" aria-checked={viewKey === k} onClick={() => onViewKey(k)}>{l}</button>)}
          </div>
          <button type="button" className={cx('icon-btn', 'icon-btn--bordered')} aria-pressed={asTable} aria-label={asTable ? 'Show map' : 'Show map as a table'} data-tip={asTable ? 'Show map' : 'Show as table'} onClick={() => onAsTable(!asTable)}><Icon name={asTable ? 'map' : 'list'} /></button>
        </div>
      </div>

      <div className={cx('mapcard__body')}>
        {loading ? <Skeleton h={240} /> : noSites ? (
          <EmptyState icon="map-pin" title="No site locations yet" action={<button type="button" className={cx('btn', 'btn--sm')} onClick={onGoSettings}>Add a site in Settings</button>}>
            The map places each submission at the registered location of its site. Register your sites to see them here.
          </EmptyState>
        ) : asTable ? (
          <div className={cx('map-table')}>
            <table className={cx('table')}>
              <caption className={cx('sr-only')}>Submission locations</caption>
              <thead><tr><th scope="col">Case</th><th scope="col">Site</th><th scope="col">Location</th><th scope="col">Severity</th></tr></thead>
              <tbody>
                {markers.map((m) => (
                  <tr key={m.row.id}>
                    <td><button type="button" className={cx('btn', 'btn--ghost', 'btn--sm')} onClick={(e) => onOpen(m.row.id, e.currentTarget)}>#{m.row.id}</button></td>
                    <td>{m.site.label ?? m.site.site_id}</td>
                    <td className={cx('mono')}>{m.site.lat.toFixed(3)}, {m.site.lng.toFixed(3)}</td>
                    <td><SevPill p={m.row.fraud_probability} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={cx('map')}>
            <div className={cx('map__canvas')} ref={canvasRef} style={{ aspectRatio: `${view.w} / ${view.h}` }}
              onClick={(e) => { if (!e.target.closest('.rd-map-marker,.rd-map__tip')) setTip(null) }}
              onKeyDown={(e) => { if (e.key === 'Escape' && tip) { e.stopPropagation(); const id = tip.id; setTip(null); document.querySelector(`.rd-map-marker[data-id="${id}"]`)?.focus() } }}>
              <svg className={cx('map__land')} viewBox={`0 0 ${view.w} ${view.h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <path d={view.land} stroke="var(--map-dot)" strokeWidth={dotR} strokeLinecap="round" fill="none" />
                <path d={view.india} stroke="var(--map-dot-home)" strokeWidth={dotR} strokeLinecap="round" fill="none" />
              </svg>
              {markers.map((m) => {
                const s = severity(m.row.fraud_probability)
                return (
                  <button key={m.row.id} type="button" data-id={m.row.id} className={cx('map-marker', `map-marker--${s.key}`, m.row.id === activeId && 'is-active')}
                    style={{ left: `calc(${m.x.toFixed(3)}% + ${m.dx.toFixed(1)}px)`, top: `calc(${m.y.toFixed(3)}% + ${m.dy.toFixed(1)}px)`, zIndex: s.rank + (m.row.id === activeId ? 10 : 0) }}
                    aria-label={`Case ${m.row.id}, ${s.label}, ${m.site.label ?? m.site.site_id}`}
                    onMouseEnter={(e) => !tip?.pinned && show(m, e.currentTarget)} onMouseLeave={hideSoon} onFocus={(e) => show(m, e.currentTarget)}
                    onBlur={(e) => { if (!e.relatedTarget?.closest?.('.rd-map__tip')) hideSoon() }}
                    onClick={(e) => { show(m, e.currentTarget, true); onSelect(m.row.id) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && tip?.pinned && tip.id === m.row.id) { e.preventDefault(); onOpen(m.row.id, e.currentTarget) } }} />
                )
              })}
              {tip && row && (
                <div className={cx('tooltip-card', 'map__tip')} role="dialog" aria-label="Case preview" style={{ left: tip.left, top: tip.top }} onMouseEnter={() => clearTimeout(hideT.current)} onMouseLeave={hideSoon}>
                  <button type="button" className={cx('tooltip-card__head')} onClick={(e) => onOpen(row.id, e.currentTarget)}>
                    <span>{row.task_id} <span className={cx('text-2', 'mono')}>#{row.id}</span></span><Icon name="chevron-right" />
                  </button>
                  <div className={cx('tooltip-card__time')}>{fmtDateTime(row.timestamp)}</div>
                  <dl>
                    <dt>Worker</dt><dd className={cx('mono', 'truncate')}>{row.worker_id}</dd>
                    <dt>Site</dt><dd className={cx('truncate')}>{sitesById.get(row.site_id)?.label ?? row.site_id}</dd>
                    <dt>Fraud</dt><dd><span style={{ color: `var(--color-${severity(row.fraud_probability).key === 'low' ? 'neutral' : severity(row.fraud_probability).key === 'critical' ? 'crit' : severity(row.fraud_probability).key === 'medium' ? 'warn' : 'high'})` }}>{pctText(row.fraud_probability)} · {severity(row.fraud_probability).label}</span></dd>
                  </dl>
                  <button type="button" className={cx('btn', 'btn--sm', 'btn--block')} style={{ marginTop: 10 }} onClick={(e) => onOpen(row.id, e.currentTarget)}>Open case <Icon name="chevron-right" /></button>
                </div>
              )}
              {!markers.length && <EmptyState icon="map-pin" title="No submissions to show">Turn on more severity levels in the legend below, or pick another KPI.</EmptyState>}
            </div>
            {(outside > 0 || unplaced > 0 || sitesError) && (
              <p className={cx('map__outside', 'text-xs', 'text-2')}>
                {outside > 0 && <>{outside} outside this view. {viewKey === 'asia' ? 'Switch to World to see them. ' : ''}</>}
                {unplaced > 0 && <>{unplaced} from sites with no registered location. </>}
                {sitesError && <>Site locations could not be loaded.</>}
              </p>
            )}
          </div>
        )}
      </div>

      <div className={cx('legend')} role="group" aria-label="Show severity on map">
        {LEGEND.map(([k, l, c]) => (
          <button key={k} type="button" className={cx('legend-chip')} aria-pressed={!hidden.has(k)} onClick={() => onToggle(k)}>
            <span className={cx('legend-chip__dot')} style={{ '--dot': c }} />{l}
          </button>
        ))}
        <button type="button" className={cx('legend-chip', 'legend-chip--all')} aria-pressed={hidden.size === 0} onClick={onShowAll}>All</button>
      </div>
    </section>
  )
}
