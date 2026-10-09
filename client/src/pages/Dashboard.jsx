import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import CaseFile from '../components/dashboard/CaseFile.jsx'
import { useDashTheme, useSites, useToasts, readReviewer } from '../components/dashboard/hooks.js'
import { Charts, PhotoQuality } from '../components/dashboard/Insights.jsx'
import KpiStrip from '../components/dashboard/KpiStrip.jsx'
import NeedsReview from '../components/dashboard/NeedsReview.jsx'
import ReviewQueue from '../components/dashboard/ReviewQueue.jsx'
import Settings from '../components/dashboard/Settings.jsx'
import Submissions from '../components/dashboard/Submissions.jsx'
import SubmissionMap from '../components/dashboard/SubmissionMap.jsx'
import TopBar, { NavTabs, VIEWS } from '../components/dashboard/TopBar.jsx'
import TopSources from '../components/dashboard/TopSources.jsx'
import { Icon, cx } from '../components/dashboard/ui.jsx'
import { getToken, setToken } from '../lib/auth.js'
import { useDemo } from '../lib/contexts.jsx'
import { lensRows, needsRows, withinDays } from '../lib/dashboard/model.js'
import { DBIP_CREDIT, describeIpDatabase, useIpDatabase } from '../lib/ipDatabase.js'
import { DEMO_SITE_ID } from '../lib/sensorFusion/siteForm.js'
import { useHealth, useSubmissions } from '../lib/useSubmissions.js'
import '../styles/dashboard.css'

const CASE_HASH = /^#case\/([\w.-]+)$/

// The reviewer console (the /dashboard route). Layout and behaviour: see redesign/README.md.
export default function Dashboard() {
  const { data, loading, error, lastUpdated, reload } = useSubmissions()
  const { demo, mock } = useDemo()
  const health = useHealth()
  const ipDb = describeIpDatabase(useIpDatabase())
  const { sites, error: sitesError } = useSites()
  const toasts = useToasts()
  const [theme, setTheme] = useDashTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()

  const view = VIEWS.some((v) => v.key === params.get('view')) ? params.get('view') : 'overview'
  const [kpi, setKpi] = useState('submissions')
  const [hidden, setHidden] = useState(() => new Set())
  const [mapView, setMapView] = useState('asia')
  const [mapTable, setMapTable] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [seed, setSeed] = useState(null)
  const [visibleIds, setVisibleIds] = useState([])
  const [selectedSite, setSelectedSite] = useState(DEMO_SITE_ID)
  const opener = useRef(null)
  const decisionRef = useRef(null)
  const missingShown = useRef(null)

  const rows = useMemo(() => (demo ? [...mock, ...data].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) : data), [demo, mock, data])
  const initialLoading = loading && data.length === 0 && !demo
  const last7 = useMemo(() => withinDays(rows, 7), [rows])
  const lens = useMemo(() => lensRows(last7, kpi), [last7, kpi])
  const needs = useMemo(() => needsRows(rows), [rows])
  const sitesById = useMemo(() => new Map((sites ?? []).map((s) => [s.site_id, s])), [sites])
  const siteName = useCallback((id) => sitesById.get(id)?.label ?? id, [sitesById])
  const hasToken = !!getToken()

  useEffect(() => { const prev = document.title; document.title = 'Reviewer console · Trust Layer'; return () => { document.title = prev } }, [])

  /* ---------- Views ---------- */
  const setView = useCallback((v) => {
    setParams((p) => { const n = new URLSearchParams(p); if (v === 'overview') n.delete('view'); else n.set('view', v); return n }, { replace: true })
    window.scrollTo(0, 0)
  }, [setParams])

  /* ---------- Case file, deep link #case/ID ---------- */
  const caseMatch = CASE_HASH.exec(location.hash)
  const caseRow = caseMatch ? rows.find((r) => String(r.id) === caseMatch[1]) ?? null : null

  const openCase = useCallback((id, el, decision = null) => {
    opener.current = el ?? document.activeElement
    decisionRef.current = decision
    navigate({ pathname: location.pathname, search: location.search, hash: `#case/${id}` })
  }, [navigate, location.pathname, location.search])

  const closeCase = useCallback(() => {
    const id = caseMatch?.[1]
    navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true })
    decisionRef.current = null
    requestAnimationFrame(() => {
      const back = (opener.current?.isConnected && opener.current) || document.querySelector(`[data-id="${id}"]`) || document.getElementById('main')
      back?.focus()
      opener.current = null
    })
  }, [navigate, location.pathname, location.search, caseMatch])

  // A link to a case that does not exist: say so (once) and drop the hash.
  useEffect(() => {
    if (!caseMatch || caseRow || initialLoading || loading) return
    if (missingShown.current === caseMatch[1]) return
    missingShown.current = caseMatch[1]
    toasts.push(`Case #${caseMatch[1]} was not found`, { type: 'error', text: 'It may have been removed, or the link is wrong.' })
    navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true })
  }, [caseMatch, caseRow, initialLoading, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Actions ---------- */
  // Reload from the server and say what changed.
  const onRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    const before = new Set(needs.map((r) => r.id))
    const [fresh] = await Promise.all([reload(), new Promise((r) => setTimeout(r, 600))])
    setRefreshing(false)
    if (!fresh) { toasts.push('Could not refresh', { type: 'error', text: 'Check your connection and try again.' }); return }
    const added = needsRows(fresh).filter((r) => !before.has(r.id))
    toasts.push(added.length ? `${added.length} new ${added.length === 1 ? 'case' : 'cases'}` : 'You are up to date', { text: added.length ? 'They are in Needs review.' : 'No new cases since the last refresh.' })
  }, [refreshing, needs, reload, toasts])

  const pickSource = (key) => {
    setSeed({ value: key, n: Date.now() })
    if (view !== 'overview' && view !== 'submissions') setView('overview')
    toasts.push(`Showing ${key}`, { text: 'Filtered the submissions table.' })
    setTimeout(() => document.getElementById('all-submissions')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  const toggleSev = (k) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const list = visibleIds.length ? visibleIds : rows.map((r) => r.id)

  return (
    <div className="rd" data-theme={theme}>
      <a className={cx('skip-link')} href="#main">Skip to content</a>
      <div className={cx('app-shell')}>
        <TopBar view={view} onView={setView} health={health} ipDb={ipDb} rows={rows} needs={needs} onOpenCase={openCase} theme={theme} onTheme={setTheme}
          reviewer={readReviewer()} hasToken={hasToken} onForgetToken={() => { setToken(''); window.location.reload() }} onSettings={() => setView('settings')} />

        <main id="main" className={cx('dash')} data-view={view} tabIndex={-1}>
          <h1 className={cx('sr-only')}>{VIEWS.find((v) => v.key === view).label}</h1>
          {view !== 'settings' && (
            <>
              <section className={cx('panel', 'area-main')} aria-label="Activity">
                <KpiStrip rows={rows} kpi={kpi} onKpi={(k) => { setKpi(k); setActiveId(null) }} loading={initialLoading} />
                <div className={cx('main-split')}>
                  <ReviewQueue rows={lens} needsCount={needs.length} view={view} kpi={kpi} onClearLens={() => setKpi('submissions')} activeId={activeId} onHover={setActiveId}
                    onOpen={openCase} loading={initialLoading} onViewAll={() => setView('queue')} siteName={siteName} />
                  <SubmissionMap rows={lens} sites={sites} sitesError={sitesError} hidden={hidden} onToggle={toggleSev} onShowAll={() => setHidden(new Set())} viewKey={mapView} onViewKey={setMapView}
                    asTable={mapTable} onAsTable={setMapTable} activeId={activeId} onSelect={setActiveId} onOpen={openCase} loading={initialLoading} onGoSettings={() => setView('settings')} />
                </div>
              </section>
              <NeedsReview rows={needs} loading={initialLoading} refreshing={refreshing} onRefresh={onRefresh} lastUpdated={lastUpdated} onOpen={openCase} siteName={siteName} />
              <Submissions rows={rows} loading={initialLoading} error={error} onReload={reload} onOpen={openCase} onVisible={setVisibleIds} seed={seed} siteName={siteName} toast={toasts.push} view={view} />
              <TopSources rows={rows} onPick={pickSource} siteName={siteName} />
              <Charts rows={rows} loading={initialLoading} />
              <PhotoQuality rows={rows} loading={initialLoading} />
            </>
          )}
          {view === 'settings' && <Settings theme={theme} onTheme={setTheme} sites={sites} sitesError={sitesError} toast={toasts.push} selectedSite={selectedSite} onSelectSite={setSelectedSite} />}
        </main>

        <footer className={cx('footer')}>
          <span><Icon name="activity" size={12} /> Edge validation → <b>Sensor fusion</b> → Explainable AI</span>
          {ipDb.credit && <span data-testid="dbip-credit"><a href={DBIP_CREDIT.url} target="_blank" rel="noopener noreferrer">{DBIP_CREDIT.text}</a> · CC BY 4.0</span>}
        </footer>
      </div>

      <NavTabs view={view} onView={setView} bottom />

      {caseRow && (
        <CaseFile key={caseRow.id} row={caseRow} list={list} siteName={siteName} initialDecision={decisionRef.current}
          onClose={closeCase} onNavigate={(id) => navigate({ pathname: location.pathname, search: location.search, hash: `#case/${id}` }, { replace: true })} onSaved={() => { toasts.push('Decision recorded', { text: 'It is stored with your name and the time.' }); reload() }} />
      )}

      <div className={cx('toast-region')} role="region" aria-label="Notifications">
        {toasts.items.map((t) => (
          <div key={t.id} className={cx('toast', `toast--${t.type}`)} role={t.type === 'error' ? 'alert' : 'status'}>
            <Icon name={t.type === 'error' ? 'circle-alert' : 'circle-check'} />
            <div className={cx('toast__body')}><div className={cx('toast__title')}>{t.title}</div>{t.text && <div className={cx('toast__text')}>{t.text}</div>}</div>
            <button type="button" className={cx('icon-btn')} aria-label="Dismiss notification" onClick={() => toasts.dismiss(t.id)}><Icon name="x" /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
