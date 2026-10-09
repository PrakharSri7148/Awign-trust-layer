import { motion } from 'framer-motion'
import { Activity, Camera, FlaskConical, LayoutDashboard, TriangleAlert } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import Background from './ui/Background.jsx'
import Logo from './ui/Logo.jsx'
import { useDemo } from '../lib/contexts.jsx'
import { DBIP_CREDIT, describeIpDatabase, useIpDatabase } from '../lib/ipDatabase.js'
import { useHealth } from '../lib/useSubmissions.js'

const LINKS = [
  { to: '/', label: 'Capture', icon: Camera, end: true },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
]

// The reviewer console (/dashboard) has its own top bar and footer (components/dashboard), and so has the Photo step of the Capture
// page (components/capture/CapShell). Capture wraps its later steps (Arrival, AI scan, Verdict) in ChromeShell itself.
export default function Shell({ children }) {
  const { pathname } = useLocation()
  if (pathname.startsWith('/dashboard') || pathname === '/') return <>{children}</>
  return <ChromeShell>{children}</ChromeShell>
}

export function ChromeShell({ children }) {
  const health = useHealth()
  const { demo, setDemo } = useDemo()
  const { pathname } = useLocation()
  const ipDb = describeIpDatabase(useIpDatabase())

  const color = health == null ? 'var(--amber)' : health ? 'var(--green)' : 'var(--red)'
  const label = health == null ? 'CONNECTING' : health ? 'SYSTEM ONLINE' : 'BACKEND OFFLINE'

  return (
    <div className="shell">
      <Background />
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div>
            <span className="brand__name">TRUST LAYER</span>
            <span className="brand__sub">SYS//VERIFY v1.0</span>
          </div>
        </div>
        <nav className="nav" aria-label="Primary">
          {LINKS.map(({ to, label, icon: Icon, end }) => {
            const active = end ? pathname === to : pathname.startsWith(to)
            return (
              <NavLink key={to} to={to} end={end} className={`nav__link${active ? ' nav__link--active' : ''}`}>
                {active && <motion.span layoutId="nav-pill" className="nav__pill" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
                <Icon size={15} />
                {label}
              </NavLink>
            )
          })}
        </nav>
        <div className="topbar__spacer" />
        <div className="topbar__chips">
          <span className="chip hide-sm">worker_demo_1 · site_demo_1</span>
          <button
            type="button"
            className={`chip toggle${demo ? ' toggle--on' : ''}`}
            onClick={() => setDemo(!demo)}
            aria-pressed={demo}
            title="Fill the dashboard with seeded mock data"
          >
            <FlaskConical size={13} />
            DEMO {demo ? 'ON' : 'OFF'}
          </button>
          {(ipDb.state === 'missing' || ipDb.state === 'stale') && (
            <span className="chip" style={{ color: 'var(--amber)' }} title={ipDb.detail} data-testid="ipdb-chip">
              <TriangleAlert size={13} />
              {ipDb.label}
            </span>
          )}
          <span className="chip" style={{ color }}>
            <span className="dot dot--pulse" />
            {label}
          </span>
        </div>
      </header>

      <motion.main
        key={pathname}
        className={`page${pathname === '/' ? ' page--capture' : ''}`}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.main>

      <footer className="footer">
        <Activity size={11} style={{ verticalAlign: '-1px' }} /> Edge validation → <b>Sensor fusion</b> → Explainable AI
        {ipDb.credit && (
          <div className="footer__credit" data-testid="dbip-credit">
            <a href={DBIP_CREDIT.url} target="_blank" rel="noopener noreferrer">{DBIP_CREDIT.text}</a> · CC BY 4.0
          </div>
        )}
      </footer>
    </div>
  )
}
