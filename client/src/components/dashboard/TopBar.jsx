import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { relTime, cx, Icon, SevPill } from './ui.jsx'
import Popover from './Popover.jsx'
import { caseTitle } from '../../lib/dashboard/model.js'

export const VIEWS = [
  { key: 'overview', label: 'Overview', icon: 'layout-grid' },
  { key: 'queue', label: 'Review queue', icon: 'triangle-alert' },
  { key: 'submissions', label: 'Submissions', icon: 'list' },
  { key: 'map', label: 'Map', icon: 'globe' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
]

export function NavTabs({ view, onView, bottom = false }) {
  return (
    <nav className={cx(bottom ? 'bottom-bar' : 'nav-tabs')} aria-label="Primary">
      {VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          className={cx('nav-tab')}
          aria-label={v.label}
          aria-current={v.key === view ? 'page' : undefined}
          data-tip={bottom ? undefined : v.label}
          onClick={() => onView(v.key)}
        >
          <Icon name={v.icon} size={bottom ? 18 : 18} />
          {bottom && <span>{v.key === 'queue' ? 'Queue' : v.label}</span>}
        </button>
      ))}
    </nav>
  )
}

const HEALTH = {
  null: { cls: 'connecting', label: 'Connecting' },
  true: { cls: 'online', label: 'System online' },
  false: { cls: 'offline', label: 'Backend offline' },
}

export default function TopBar({ view, onView, health, ipDb, rows, needs, onOpenCase, theme, onTheme, reviewer, hasToken, onForgetToken, onSettings }) {
  const searchRef = useRef(null)
  const bellRef = useRef(null)
  const userRef = useRef(null)
  const [pop, setPop] = useState(null) // 'search' | 'bell' | 'user'
  const [term, setTerm] = useState('')
  const h = HEALTH[String(health)]
  const close = (focus = true) => { setPop(null); if (focus) ({ search: searchRef, bell: bellRef, user: userRef })[pop]?.current?.focus() }
  const t = term.trim().toLowerCase().replace('#', '')
  const results = t ? rows.filter((r) => [r.id, r.worker_id, r.site_id, r.task_id].some((v) => String(v).toLowerCase().includes(t))).slice(0, 6) : []
  const initials = (reviewer || 'Reviewer').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const bellTop = needs.slice(0, 3)

  return (
    <header className={cx('topbar')}>
      <Link className={cx('wordmark')} to="/dashboard" aria-label="Trust Layer, reviewer console">
        <span className={cx('wordmark__bracket')}>[</span>trustlayer<span className={cx('wordmark__bracket')}>]</span>
      </Link>

      <NavTabs view={view} onView={onView} />

      <div className={cx('topbar__right')}>
        {(ipDb.state === 'missing' || ipDb.state === 'stale') && (
          <span className={cx('pill', 'pill--warn')} title={ipDb.detail} data-testid="ipdb-chip"><Icon name="triangle-alert" size={12} />{ipDb.label}</span>
        )}
        <span className={cx('status', `status--${h.cls}`, 'topbar__status')} data-testid="health">{h.label}</span>
        <button ref={searchRef} type="button" className={cx('icon-btn')} aria-label="Search cases" aria-haspopup="dialog" aria-expanded={pop === 'search'} data-tip="Search" onClick={() => { setTerm(''); setPop(pop === 'search' ? null : 'search') }}><Icon name="search" /></button>
        <button ref={bellRef} type="button" className={cx('icon-btn', needs.length && 'has-dot')} aria-label={`Notifications, ${needs.length} waiting for a reviewer`} aria-haspopup="dialog" aria-expanded={pop === 'bell'} data-tip="Notifications" onClick={() => setPop(pop === 'bell' ? null : 'bell')}><Icon name="bell" /></button>
        <span className={cx('topbar__divider')} aria-hidden="true" />
        <button ref={userRef} type="button" className={cx('icon-btn')} aria-label={`Account menu${reviewer ? ` for ${reviewer}` : ''}`} aria-haspopup="menu" aria-expanded={pop === 'user'} onClick={() => setPop(pop === 'user' ? null : 'user')}><span className={cx('avatar')} aria-hidden="true">{initials}</span></button>
      </div>

      <Popover anchorRef={searchRef} open={pop === 'search'} onClose={close} role="dialog" label="Search cases" width={360} focusFirst={false}>
        <div className={cx('input-group')}>
          <Icon name="search" />
          <input className={cx('input')} autoFocus type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Case number, worker or site" aria-label="Search cases"
            onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { close(false); onOpenCase(results[0].id, searchRef.current) } if (e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.closest('[data-rd-popover]').querySelector('[data-menu-item]')?.focus() } }} />
        </div>
        <ul style={{ marginTop: 6 }} aria-label="Results">
          {!t && <li className={cx('menu__label')}>Type to search all submissions</li>}
          {t && !results.length && <li className={cx('menu__label')}>No cases match “{term}”</li>}
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" className={cx('menu__item')} data-menu-item onClick={() => { close(false); onOpenCase(r.id, searchRef.current) }}>
                <span className={cx('mono')}>#{r.id}</span><span className={cx('truncate')} style={{ flex: 1 }}>{r.site_id}</span><SevPill p={r.fraud_probability} />
              </button>
            </li>
          ))}
        </ul>
      </Popover>

      <Popover anchorRef={bellRef} open={pop === 'bell'} onClose={close} role="menu" label="Notifications" width={300}>
        <div className={cx('menu__label')}>Needs attention</div>
        {!bellTop.length && <div className={cx('menu__label')}>Nothing is waiting for a reviewer.</div>}
        {bellTop.map((r) => (
          <button key={r.id} type="button" className={cx('menu__item')} role="menuitem" onClick={() => { close(false); onOpenCase(r.id, bellRef.current) }}>
            <span style={{ display: 'grid', textAlign: 'left' }}><span>{caseTitle(r)} <span className={cx('mono', 'text-2')}>#{r.id}</span></span><small className={cx('text-2')}>{relTime(r.timestamp)}</small></span>
          </button>
        ))}
      </Popover>

      <Popover anchorRef={userRef} open={pop === 'user'} onClose={close} role="menu" label="Account" width={230}>
        <div className={cx('menu__label')}>{reviewer || 'Reviewer'}</div>
        <button type="button" className={cx('menu__item')} role="menuitem" onClick={() => { close(false); onSettings() }}><Icon name="settings" />Settings</button>
        <button type="button" className={cx('menu__item')} role="menuitem" onClick={() => { close(false); onTheme(theme === 'dark' ? 'light' : 'dark') }}><Icon name={theme === 'dark' ? 'sun' : 'moon'} />Switch theme</button>
        <Link className={cx('menu__item')} role="menuitem" to="/" style={{ textDecoration: 'none' }}><Icon name="smartphone" />Worker capture app</Link>
        {hasToken && (<><div className={cx('menu__sep')} role="separator" /><button type="button" className={cx('menu__item')} role="menuitem" onClick={() => { close(false); onForgetToken() }}><Icon name="lock" />Forget access token</button></>)}
      </Popover>
    </header>
  )
}
