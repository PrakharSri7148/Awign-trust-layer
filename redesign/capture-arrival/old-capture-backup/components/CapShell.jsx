import { Camera, Ellipsis, LayoutGrid, Moon, Sun, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { DBIP_CREDIT, describeIpDatabase, useIpDatabase } from '../../lib/ipDatabase.js'

const Mark = () => (
  <svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true"><path d="M9 11h14M16 11v12" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" fill="none" /></svg>
)

// The page shell of the redesigned Photo step: brand, icon-only nav, the IP-database warning, a theme switch, the credit line and (phones) a bottom nav.
// Everything else the old shell showed (demo toggle, status chip, worker chip) is deliberately not here: see redesign/capture-photo/README.md.
export default function CapShell({ children, theme, onTheme }) {
  const { pathname } = useLocation()
  const ipDb = describeIpDatabase(useIpDatabase())
  const warn = ipDb.state === 'missing' || ipDb.state === 'stale'
  const [menu, setMenu] = useState(false)
  const menuRef = useRef(null)
  const onCapture = pathname === '/'

  useEffect(() => {
    if (!menu) return undefined
    const away = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(false) }
    const esc = (e) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [menu])

  return (
    <div className="cap" data-theme={theme}>
      <a className="cap-skip-link" href="#cap-main">Skip to content</a>
      <div className="cap-shell">
        <header className="cap-topbar">
          <Link className="cap-brand" to="/" aria-label="Trust Layer, SYS//VERIFY v1.0">
            <span className="cap-brand__logo"><Mark /></span>
            <span className="cap-brand__text"><span className="cap-brand__name">TRUST LAYER</span><span className="cap-brand__sub">SYS//VERIFY v1.0</span></span>
          </Link>
          <nav className="cap-nav" aria-label="Primary">
            <Link className="cap-nav__tab" to="/" aria-label="Capture" data-tip="Capture" aria-current={onCapture ? 'page' : undefined}><Camera size={18} className="cap-icon" aria-hidden="true" /></Link>
            <Link className="cap-nav__tab" to="/dashboard" aria-label="Dashboard" data-tip="Dashboard"><LayoutGrid size={18} className="cap-icon" aria-hidden="true" /></Link>
          </nav>
          <div className="cap-topbar__right" ref={menuRef}>
            {warn && (
              <span className="cap-chip cap-chip--warn cap-chip--ipdb" tabIndex={0} data-tip={ipDb.detail} data-tip-pos="left" data-testid="ipdb-chip">
                <TriangleAlert size={14} className="cap-icon" aria-hidden="true" />{ipDb.label}
              </span>
            )}
            <button type="button" className="cap-icon-btn" aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'} data-tip={theme === 'dark' ? 'Light theme' : 'Dark theme'} data-tip-pos="left" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun size={18} className="cap-icon" aria-hidden="true" /> : <Moon size={18} className="cap-icon" aria-hidden="true" />}
            </button>
            {warn && (
              <button type="button" className="cap-icon-btn cap-topbar__more" aria-label="Warnings" aria-expanded={menu} data-badge="1" onClick={() => setMenu((m) => !m)}>
                <Ellipsis size={18} className="cap-icon" aria-hidden="true" />
              </button>
            )}
            {menu && warn && (
              <div className="cap-popover" role="dialog" aria-label="Warnings">
                <p className="cap-popover__note"><TriangleAlert size={14} className="cap-icon" aria-hidden="true" /><span><b>{ipDb.label}.</b> {ipDb.detail}</span></p>
              </div>
            )}
          </div>
        </header>
        <main className="cap-main" id="cap-main" tabIndex={-1}>{children}</main>
        <footer className="cap-footer">
          {ipDb.credit && (
            <div data-testid="dbip-credit"><a href={DBIP_CREDIT.url} target="_blank" rel="noopener noreferrer">{DBIP_CREDIT.text}</a> · CC BY 4.0</div>
          )}
        </footer>
      </div>
      <nav className="cap-bottomnav" aria-label="Primary (phone)">
        <Link to="/" aria-current={onCapture ? 'page' : undefined}><Camera size={18} className="cap-icon" aria-hidden="true" />Capture</Link>
        <Link to="/dashboard"><LayoutGrid size={18} className="cap-icon" aria-hidden="true" />Dashboard</Link>
      </nav>
    </div>
  )
}
