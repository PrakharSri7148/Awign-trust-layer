import { Activity, Ban, Gauge as GaugeIcon, Radio, Satellite, Server, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import { API_BASE, API_SOURCE, checkServer, setApiBase } from '../../lib/api.js'
import { NOT_AVAILABLE, liveFeed, trailGeometry } from '../../lib/sensorFusion/display.js'
import { demoToolsOn, isNativeApp } from '../../lib/sensorFusion/exportTrace.js'
import { SITE_EVENT, getSite } from '../../lib/sensorFusion/sites.js'
import { useRecorderState } from '../../lib/sensorFusion/useRecorder.js'
import { getNetworkInfo } from '../../lib/sensors.js'
import Waveform from './Waveform.jsx'

const STATE_WORD = { granted: 'allowed', denied: 'denied', prompt: 'not asked yet', absent: 'no sensor', null_events: 'no sensor (empty events)', waiting: 'waiting for data' }
const word = (v) => (v == null ? 'not started' : (STATE_WORD[v] ?? v))
const SOURCE_WORD = { url: 'from ?api=', saved: 'saved on this device', build: 'set at build time', default: 'default' }

// One "label: value" line. A missing value prints "-" (never a made-up number).
function KV({ k, v, id, tone }) {
  return (
    <div className="feed__kv">
      <span>{k}</span>
      <b className={`num${tone ? ` feed--${tone}` : ''}`} data-testid={id ? `feed-${id}` : undefined}>{v ?? '-'}</b>
    </div>
  )
}

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
    <div className="feed__server" data-testid="server-box">
      <div className="feed__head"><Server size={13} /> Server</div>
      <div className="faint" style={{ fontSize: 12 }}>Now: <span className="num" data-testid="server-now">{API_BASE}</span> ({SOURCE_WORD[API_SOURCE] ?? API_SOURCE})</div>
      <div className="feed__row">
        <input className="chip" value={val} onChange={(e) => setVal(e.target.value)} placeholder="http://192.168.1.20:8000" aria-label="Backend address" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <button type="button" className="btn btn--sm" onClick={test}>Test connection</button>
        <button type="button" className="btn btn--sm" onClick={save}>Save</button>
      </div>
      {msg && <div className={`feed--${msg.tone}`} role="status" data-testid="server-msg" style={{ fontSize: 12 }}>{msg.text}</div>}
    </div>
  )
}

// The live Sensor feed: everything the visit recording is fetching right now, and what it cannot fetch (with the reason). Sits
// BELOW the camera so the camera keeps its shutter-in-view height budget.
export default function SensorFeed({ recorder, siteId }) {
  const s = useRecorderState(recorder)
  const perms = usePermissions()
  const [site, setSite] = useState({ loading: true })
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

  return (
    <section className="panel panel--tight feed" data-testid="sensor-feed" aria-label="Live sensor feed">
      <div className="feed__title">
        <span className="eyebrow eyebrow--cyan">Sensor feed</span>
        {s.running ? <span className="fz-live"><i aria-hidden="true" /> live</span> : <span className="faint" style={{ fontSize: 12 }}>start the visit recording above to see live values</span>}
      </div>
      {native && API_SOURCE === 'default' && (
        <p className="feed--amber" role="note" style={{ fontSize: 13, margin: '6px 0 0' }}>Inside the app the backend address must be set: enter the laptop's address under Server below.</p>
      )}

      <div className="feed__grid">
        <div className="feed__group">
          <div className="feed__head"><Satellite size={13} /> GPS · {word(f.gps.state)}</div>
          <KV k="Latitude" v={f.gps.lat} id="lat" />
          <KV k="Longitude" v={f.gps.lng} id="lng" />
          <KV k="Accuracy" v={f.gps.accuracy && `±${f.gps.accuracy}`} id="accuracy" />
          <KV k="Speed (reported)" v={f.gps.speed} />
          <KV k="Heading" v={f.gps.heading} />
          <KV k="Altitude" v={f.gps.altitude} />
          <KV k="Fixes kept" v={f.gps.fixes} id="fixes" />
          <KV k="Last fix" v={f.gps.agoS == null ? null : `${f.gps.agoS} s ago`} id="fix-ago" tone={f.gps.agoS > 15 ? 'amber' : null} />
          <KV k="Distance" v={f.gps.distance} />
        </div>

        <div className="feed__group">
          <div className="feed__head"><Activity size={13} /> Motion · {word(f.motion.state)}</div>
          <KV k="|Acceleration|" v={f.motion.acc} id="acc" />
          <KV k="|Rotation|" v={f.motion.gyro} id="gyro" />
          <KV k="Sensor rate" v={f.motion.rateHz} id="rate" />
          <Waveform active={s.running && s.motion === 'granted'} />
          <KV k="Activity now" v={f.activity.now} id="activity" tone={f.activity.now === 'walking' ? 'green' : null} />
          <KV k="Step rhythm" v={f.activity.rhythm} id="rhythm" />
          <KV k="5 s windows" v={f.motion.windows} id="windows" />
          {f.activity.recent.length > 0 && (
            <div className="fz-strip" style={{ marginTop: 6 }} role="img" aria-label="Phone activity, last two minutes">
              {f.activity.recent.map((a, i) => <i key={i} className={`fz-cell fz-act--${a}`} title={a} />)}
            </div>
          )}
        </div>

        <div className="feed__group">
          <div className="feed__head"><GaugeIcon size={13} /> Session</div>
          <KV k="Visit" v={f.session.visit} id="visit" />
          <KV k="Server clock offset" v={f.session.offset} id="offset" />
          <KV k="Recording for" v={f.session.recordingS == null ? null : `${f.session.recordingS} s`} />
          <KV k="Screen wake lock" v={native && f.session.wakeLock === 'not held' ? 'kept on by the app' : f.session.wakeLock} id="wakelock" tone={!native && f.session.wakeLock === 'not held' ? 'amber' : null} />
          <KV k="Time hidden" v={`${f.session.hiddenS} s (${f.session.hiddenCount}×)`} id="hidden" tone={f.session.hiddenS ? 'amber' : null} />
          <KV k="GPS restarts" v={f.session.watchRestarts} id="restarts" />
          <KV k="Location permission" v={word(s.geo ?? perms.geolocation)} />
          <KV k="Camera permission" v={word(perms.camera)} />
          <div className="feed__head" style={{ marginTop: 8 }}><Wifi size={13} /> Network</div>
          <KV k="Type" v={f.network ? f.network.type : 'not exposed by this browser'} id="net" />
          <KV k="Downlink / RTT" v={f.network ? [f.network.downlink, f.network.rtt].filter(Boolean).join(' · ') : null} />
        </div>

        <div className="feed__group">
          <div className="feed__head"><Radio size={13} /> Trail · site {siteText}</div>
          {geom ? (
            <svg className="fz-trail" viewBox={`0 0 ${geom.w} ${geom.h}`} role="img" aria-label="Live GPS trail" data-testid="feed-trail">
              {geom.site && <circle cx={geom.site.c[0]} cy={geom.site.c[1]} r={geom.site.r} className="fz-site" />}
              <path d={geom.path} className="fz-path" />
              <circle cx={geom.start[0]} cy={geom.start[1]} r="3.5" className="fz-start" />
              <circle cx={geom.end[0]} cy={geom.end[1]} r="3.5" className="fz-end" />
            </svg>
          ) : (
            <p className="faint" style={{ fontSize: 12, margin: '4px 0 0' }}>No fixes yet.</p>
          )}
          {geom && <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>≈ {geom.spanM} m across · drawn locally, no map service</div>}
        </div>
      </div>

      <div className="feed__na" data-testid="feed-na">
        <div className="feed__head"><Ban size={13} /> Not available here</div>
        <ul>
          {NOT_AVAILABLE.map((n) => <li key={n.id}><b>{n.label}</b>: {n.reason}</li>)}
        </ul>
      </div>

      {tools && <ServerBox />}
    </section>
  )
}
