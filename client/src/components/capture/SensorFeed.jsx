import { Activity, Ban, ChevronDown, ChevronUp, Gauge as GaugeIcon, Radio, Route, Satellite, Server, TriangleAlert, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import { API_BASE, API_SOURCE, checkServer, setApiBase } from '../../lib/api.js'
import { NOT_AVAILABLE, liveFeed, trailGeometry } from '../../lib/sensorFusion/display.js'
import { demoToolsOn, isNativeApp } from '../../lib/sensorFusion/exportTrace.js'
import { SITE_EVENT, getSite } from '../../lib/sensorFusion/sites.js'
import { useRecorderState } from '../../lib/sensorFusion/useRecorder.js'
import { getNetworkInfo } from '../../lib/sensors.js'
import Waveform from './Waveform.jsx'
import { Accordion } from './ui.jsx'

const STATE_WORD = { granted: 'allowed', denied: 'denied', prompt: 'not asked yet', absent: 'no sensor', null_events: 'no sensor (empty events)', waiting: 'waiting for data' }
const word = (v) => (v == null ? 'not started' : (STATE_WORD[v] ?? v))
const SOURCE_WORD = { url: 'from ?api=', saved: 'saved on this device', build: 'set at build time', default: 'default' }

// One "label: value" row. A missing value prints "-" (never a made-up number). `tone` colours the value (warn | pass).
function KV({ k, v, id, tone, mono }) {
  return (
    <div className="cap-kv__row">
      <dt>{k}</dt>
      <dd className={`${tone ? `cap-kv__val--${tone} ` : ''}${mono ? 'cap-mono ' : ''}${v == null ? 'cap-kv__val--muted' : ''}`} data-testid={id ? `feed-${id}` : undefined}>{v ?? '-'}</dd>
    </div>
  )
}
const Head = ({ icon: Icon, children }) => <div className="cap-kv__head"><Icon size={14} className="cap-icon" aria-hidden="true" />{children}</div>

// Browser permission states that the recorder cannot see by itself (the camera; location before the recording starts).
function usePermissions() {
  const [p, setP] = useState({})
  useEffect(() => {
    const perms = globalThis.navigator?.permissions
    if (!perms?.query) return undefined
    const subs = []
    for (const name of ['geolocation', 'camera']) {
      perms.query({ name }).then((st) => {
        const upd = () => setP((o) => ({ ...o, [name]: st.state }))
        upd()
        st.addEventListener?.('change', upd)
        subs.push(() => st.removeEventListener?.('change', upd))
      }).catch(() => setP((o) => ({ ...o, [name]: 'unknown' })))
    }
    return () => subs.forEach((f) => f())
  }, [])
  return p
}

function ServerBox() {
  const [val, setVal] = useState(API_BASE.startsWith('/') ? '' : API_BASE)
  const [msg, setMsg] = useState(null)
  async function test() {
    setMsg({ tone: 'muted', text: 'Testing…' })
    const base = val.trim() || API_BASE
    const r = await checkServer(base)
    setMsg(r.ok ? { tone: 'green', text: `Connected to ${base} (${r.ms} ms)` } : { tone: 'red', text: r.error })
  }
  function save() {
    const r = setApiBase(val.trim() || null)
    if (!r.ok) return setMsg({ tone: 'red', text: r.error })
    setMsg({ tone: 'muted', text: 'Saved. Reloading…' })
    setTimeout(() => globalThis.location?.reload(), 300)
  }
  return (
    <div data-testid="server-box">
      <Accordion title={<><Server size={14} className="cap-icon" aria-hidden="true" style={{ display: 'inline', verticalAlign: '-2px' }} /> Server</>} meta="(demo tools)">
        <div className="cap-muted" style={{ fontSize: 'var(--cap-text-xs)' }}>Now: <span className="cap-mono" data-testid="server-now">{API_BASE}</span> ({SOURCE_WORD[API_SOURCE] ?? API_SOURCE})</div>
        <div className="cap-visit__toolrow">
          <label className="cap-field">
            <span className="cap-field__label">Backend address</span>
            <input className="cap-input" value={val} onChange={(e) => setVal(e.target.value)} placeholder="http://192.168.1.20:8000" aria-label="Backend address" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          </label>
          <button type="button" className="cap-btn cap-btn--sm" onClick={test}>Test connection</button>
          <button type="button" className="cap-btn cap-btn--sm" onClick={save}>Save</button>
        </div>
        {msg && <div role="status" data-testid="server-msg" style={{ fontSize: 'var(--cap-text-xs)', color: msg.tone === 'green' ? 'var(--cap-ok)' : msg.tone === 'red' ? 'var(--cap-bad)' : 'var(--cap-text-2)' }}>{msg.text}</div>}
      </Accordion>
    </div>
  )
}

// The live Sensor feed: everything the visit recording is fetching right now, and what it cannot fetch (with the reason). Sits
// BELOW the camera so the camera keeps its shutter-in-view height budget.
export default function SensorFeed({ recorder, siteId }) {
  const s = useRecorderState(recorder)
  const perms = usePermissions()
  const [site, setSite] = useState({ loading: true })
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('gps')
  const tools = demoToolsOn()
  const native = isNativeApp()

  useEffect(() => {
    let alive = true
    const load = () => getSite(siteId).then((r) => alive && setSite(r.ok ? { site: r.site } : { error: r.error }))
    load()
    globalThis.addEventListener?.(SITE_EVENT, load)
    return () => {
      alive = false
      globalThis.removeEventListener?.(SITE_EVENT, load)
    }
  }, [siteId])

  const f = liveFeed(s, { net: getNetworkInfo() })
  const geom = s.points?.length ? trailGeometry(s.points, site.site ?? null, [], { w: 240, h: 150, pad: 10 }) : null
  const siteText = site.loading ? 'checking…' : site.error ? `unknown (${site.error})` : site.site ? `registered, radius ${site.site.radius_m} m` : 'not registered'

  const tabs = [['gps', 'GPS'], ['motion', 'Motion'], ['session', 'Session'], ['network', 'Network'], ['trail', 'Trail'], ['na', 'Not available']]
  const agoWarn = f.gps.agoS > 15 ? 'warn' : null
  const onKey = (e) => {
    const i = tabs.findIndex(([id]) => id === tab)
    const go = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
    if (go == null) return
    e.preventDefault()
    setTab(tabs[go][0])
    document.getElementById(`feed-tab-${tabs[go][0]}`)?.focus()
  }

  return (
    <section className="cap-card cap-feed" data-testid="sensor-feed" aria-label="Live sensor feed">
      <div className="cap-card__head">
        <div className="cap-eyebrow"><Satellite size={14} className="cap-icon" aria-hidden="true" /> Sensor feed</div>
        {s.running && <span className="cap-feed__live"><i aria-hidden="true" /> live</span>}
      </div>
      <div className="cap-card__body">
        {!s.running && <p className="cap-muted" style={{ fontSize: 'var(--cap-text-xs)' }}>start the visit recording above to see live values</p>}
        {native && API_SOURCE === 'default' && (
          <p className="cap-visit__note" role="note"><TriangleAlert size={16} className="cap-icon" aria-hidden="true" /><span style={{ color: 'var(--cap-warn)' }}>Inside the app the backend address must be set: enter the laptop's address under Server below.</span></p>
        )}

        <div className="cap-feed__heads">
          <div className="cap-kpi cap-kpi--sm"><span className="cap-kpi__label">GPS accuracy</span><b className="cap-kpi__value">{f.gps.accuracy ? `±${f.gps.accuracy}` : '—'}</b></div>
          <div className="cap-kpi cap-kpi--sm"><span className="cap-kpi__label">Last fix</span><b className="cap-kpi__value" style={agoWarn ? { color: 'var(--cap-warn)' } : undefined}>{f.gps.agoS == null ? '—' : `${f.gps.agoS} s`}</b></div>
          <div className="cap-kpi cap-kpi--sm"><span className="cap-kpi__label">Activity</span><b className="cap-kpi__value" style={f.activity.now === 'walking' ? { color: 'var(--cap-ok)' } : undefined}>{f.activity.now || '—'}</b></div>
        </div>
        <button type="button" className="cap-btn cap-btn--block" aria-expanded={open} aria-controls="cap-feed-panel" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide sensor feed' : 'Open sensor feed'}
          {open ? <ChevronUp size={16} className="cap-icon" aria-hidden="true" /> : <ChevronDown size={16} className="cap-icon" aria-hidden="true" />}
        </button>

        <div id="cap-feed-panel" hidden={!open}>
          <div className="cap-tabs" role="tablist" aria-label="Sensor feed groups" onKeyDown={onKey}>
            {tabs.map(([id, label]) => (
              <button key={id} type="button" role="tab" id={`feed-tab-${id}`} className="cap-tab" aria-selected={tab === id} aria-controls={`feed-pnl-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>

          <div className="cap-feed__panel" role="tabpanel" id="feed-pnl-gps" aria-labelledby="feed-tab-gps" hidden={tab !== 'gps'}>
            <Head icon={Satellite}>GPS · {word(f.gps.state)}</Head>
            <dl className="cap-kv">
              <KV k="Latitude" v={f.gps.lat} id="lat" mono />
              <KV k="Longitude" v={f.gps.lng} id="lng" mono />
              <KV k="Accuracy" v={f.gps.accuracy && `±${f.gps.accuracy}`} id="accuracy" />
              <KV k="Speed (reported)" v={f.gps.speed} />
              <KV k="Heading" v={f.gps.heading} />
              <KV k="Altitude" v={f.gps.altitude} />
              <KV k="Fixes kept" v={f.gps.fixes} id="fixes" />
              <KV k="Last fix" v={f.gps.agoS == null ? null : `${f.gps.agoS} s ago`} id="fix-ago" tone={agoWarn} />
              <KV k="Distance" v={f.gps.distance} />
            </dl>
          </div>

          <div className="cap-feed__panel" role="tabpanel" id="feed-pnl-motion" aria-labelledby="feed-tab-motion" hidden={tab !== 'motion'}>
            <Head icon={Activity}>Motion · {word(f.motion.state)}</Head>
            <dl className="cap-kv">
              <KV k="|Acceleration|" v={f.motion.acc} id="acc" />
              <KV k="|Rotation|" v={f.motion.gyro} id="gyro" />
              <KV k="Sensor rate" v={f.motion.rateHz} id="rate" />
            </dl>
            {open && tab === 'motion' && <Waveform active={s.running && s.motion === 'granted'} />}
            <dl className="cap-kv">
              <KV k="Activity now" v={f.activity.now} id="activity" tone={f.activity.now === 'walking' ? 'pass' : null} />
              <KV k="Step rhythm" v={f.activity.rhythm} id="rhythm" />
              <KV k="5 s windows" v={f.motion.windows} id="windows" />
            </dl>
            {f.activity.recent.length > 0 && (
              <>
                <div className="cap-strip" role="img" aria-label="Phone activity, last two minutes">
                  {f.activity.recent.map((a, i) => <i key={i} className={`is-${a}`} title={a} />)}
                </div>
                <div className="cap-legend"><span><i style={{ background: 'color-mix(in srgb, var(--cap-text-2) 55%, transparent)' }} />still</span><span><i style={{ background: 'var(--cap-ok)' }} />walking</span><span><i style={{ background: 'var(--cap-accent-text)' }} />moving</span></div>
              </>
            )}
          </div>

          <div className="cap-feed__panel" role="tabpanel" id="feed-pnl-session" aria-labelledby="feed-tab-session" hidden={tab !== 'session'}>
            <Head icon={GaugeIcon}>Session</Head>
            <dl className="cap-kv">
              <KV k="Visit" v={f.session.visit} id="visit" mono />
              <KV k="Server clock offset" v={f.session.offset} id="offset" />
              <KV k="Recording for" v={f.session.recordingS == null ? null : `${f.session.recordingS} s`} />
              <KV k="Screen wake lock" v={native && f.session.wakeLock === 'not held' ? 'kept on by the app' : f.session.wakeLock} id="wakelock" tone={!native && f.session.wakeLock === 'not held' ? 'warn' : null} />
              <KV k="Time hidden" v={`${f.session.hiddenS} s (${f.session.hiddenCount}×)`} id="hidden" tone={f.session.hiddenS ? 'warn' : null} />
              <KV k="GPS restarts" v={f.session.watchRestarts} id="restarts" />
              <KV k="Location permission" v={word(s.geo ?? perms.geolocation)} />
              <KV k="Camera permission" v={word(perms.camera)} />
            </dl>
          </div>

          <div className="cap-feed__panel" role="tabpanel" id="feed-pnl-network" aria-labelledby="feed-tab-network" hidden={tab !== 'network'}>
            <Head icon={Wifi}>Network</Head>
            <dl className="cap-kv">
              <KV k="Type" v={f.network ? f.network.type : 'not exposed by this browser'} id="net" />
              <KV k="Downlink / RTT" v={f.network ? [f.network.downlink, f.network.rtt].filter(Boolean).join(' · ') : null} />
            </dl>
          </div>

          <div className="cap-feed__panel" role="tabpanel" id="feed-pnl-trail" aria-labelledby="feed-tab-trail" hidden={tab !== 'trail'}>
            <Head icon={Radio}>Trail · site {siteText}</Head>
            {geom ? (
              <>
                <svg className="cap-trail" viewBox={`0 0 ${geom.w} ${geom.h}`} role="img" aria-label="Live GPS trail" data-testid="feed-trail">
                  {geom.site && <circle cx={geom.site.c[0]} cy={geom.site.c[1]} r={geom.site.r} className="cap-trail__site" />}
                  <path d={geom.path} className="cap-trail__path" />
                  <circle cx={geom.start[0]} cy={geom.start[1]} r="3.5" className="cap-trail__start" />
                  <circle cx={geom.end[0]} cy={geom.end[1]} r="3.5" className="cap-trail__end" />
                </svg>
                <div className="cap-muted" style={{ fontSize: 'var(--cap-text-xs)' }}>≈ {geom.spanM} m across · drawn locally, no map service</div>
              </>
            ) : (
              <div className="cap-empty"><Route size={24} className="cap-icon" aria-hidden="true" /><span>No fixes yet.</span></div>
            )}
          </div>

          <div className="cap-feed__panel" role="tabpanel" id="feed-pnl-na" aria-labelledby="feed-tab-na" hidden={tab !== 'na'}>
            <Head icon={Ban}>Not available here</Head>
            <ul className="cap-na" data-testid="feed-na">
              {NOT_AVAILABLE.map((n) => <li key={n.id}><b>{n.label}</b><span>{n.reason}</span></li>)}
            </ul>
          </div>
        </div>

        {tools && <ServerBox />}
      </div>
    </section>
  )
}
