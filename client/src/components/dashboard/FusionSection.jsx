import { envComponentText, fmtDistance, scoreWord, timelineCells, trailGeometry } from '../../lib/sensorFusion/display.js'
import { flagMeta } from '../../lib/format.js'
import { isFusionFlag } from '../../lib/sensorFusion/flags.js'
import { DBIP_CREDIT } from '../../lib/ipDatabase.js'

const pct0 = (v) => `${Math.round((v ?? 0) * 100)}`

// The case file's Sensor fusion section: how the phone's movement compared with the GPS trail, and whether the network fits the
// claimed area. It states what was MEASURED and how much evidence there was; it never decides (the classifier does).
export default function FusionSection({ row, fusion }) {
  if ((row.fusion_version ?? 0) < 1) {
    return (
      <div className="panel panel--tight" data-testid="fusion-section">
        <div className="eyebrow eyebrow--cyan">Sensor fusion</div>
        <p className="dim" style={{ fontSize: 13, margin: '8px 0 0' }}>This submission was scored before sensor fusion existed (a 3-second movement average and a network speed hash). No GPS trail was compared.</p>
      </div>
    )
  }
  if (!fusion || !fusion.motion) {
    return (
      <div className="panel panel--tight" data-testid="fusion-section">
        <div className="eyebrow eyebrow--cyan">Sensor fusion</div>
        <p className="dim" style={{ fontSize: 13, margin: '8px 0 0' }}>Loading the sensor report…</p>
      </div>
    )
  }
  const m = fusion.motion
  const e = fusion.environment
  const ev = m.evidence ?? {}
  const mw = scoreWord(m.score, m.known)
  const ew = scoreWord(e.score, e.known)
  const geom = trailGeometry(fusion.trail?.points, fusion.site, ev.jumps ?? [])
  const cells = timelineCells(ev.rows)
  const flags = (fusion.flags ?? []).filter(isFusionFlag)
  const reasons = [m.reason, e.reason, ...(fusion.notes ?? [])].filter(Boolean)
  const s = fusion.sensors ?? {}
  return (
    <div className="panel panel--tight" data-testid="fusion-section">
      <div className="eyebrow eyebrow--cyan">Sensor fusion</div>

      <div className="fz-scores" style={{ marginTop: 10 }}>
        <div className={`fz-score fz-score--${mw.tone}`}>
          <span className="eyebrow">Motion vs GPS trail</span>
          <b className="num">{m.known ? pct0(m.score) : '-'}</b>
          <span>{mw.word}</span>
          <small>{m.sensor_used ? 'GPS + accelerometer / gyroscope' : 'GPS only (no motion data)'}</small>
        </div>
        <div className={`fz-score fz-score--${ew.tone}`}>
          <span className="eyebrow">Network vs claimed area</span>
          <b className="num">{e.known ? pct0(e.score) : '-'}</b>
          <span>{ew.word}</span>
          <small>{(e.components ?? []).some((c) => ['ip_location', 'asn', 'hosting', 'wifi', 'cell'].includes(c.id) && c.status !== 'unavailable') ? 'IP / provider / profile' : 'network speed class only'}</small>
        </div>
      </div>

      {reasons.length > 0 && (
        <ul className="help-list">
          {reasons.map((r) => (
            <li key={r}>{r}.</li>
          ))}
        </ul>
      )}

      {geom && (
        <div style={{ marginTop: 14 }}>
          <div className="faint num" style={{ fontSize: 12, marginBottom: 6 }}>
            Trail · {ev.fixes ?? fusion.trail.points.length} fixes · {fmtDistance(ev.distance_m)} · {Math.round(ev.duration_s ?? fusion.trail.span_s ?? 0)} s · drawing ≈ {fmtDistance(geom.spanM)} across
          </div>
          <svg className="fz-trail" viewBox={`0 0 ${geom.w} ${geom.h}`} role="img" aria-label="The recorded GPS trail relative to the site">
            {geom.site && <circle cx={geom.site.c[0]} cy={geom.site.c[1]} r={geom.site.r} className="fz-site" />}
            <path d={geom.path} className="fz-path" />
            {geom.jumps.map((j) => (
              <line key={`${j.from}-${j.to}`} x1={j.from[0]} y1={j.from[1]} x2={j.to[0]} y2={j.to[1]} className="fz-jump" />
            ))}
            <circle cx={geom.start[0]} cy={geom.start[1]} r="4" className="fz-start" />
            <circle cx={geom.end[0]} cy={geom.end[1]} r="4" className="fz-end" />
          </svg>
          <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Hollow dot = start, filled = end{geom.site ? ', circle = the site\'s radius' : ' (no site location registered)'}{geom.jumps.length ? ', dashed = a GPS jump' : ''}. Drawn locally; no map service is contacted.</div>
        </div>
      )}
      {!geom && fusion.trail?.purged && <p className="dim" style={{ fontSize: 13, margin: '10px 0 0' }}>The location points were deleted after the retention period; the scores and flags are kept.</p>}

      {cells.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="faint num" style={{ fontSize: 12, marginBottom: 6 }}>What the GPS said vs what the phone felt, every 5 s</div>
          <div className="fz-strips" role="img" aria-label="Timeline of GPS speed class against phone activity; mismatches outlined">
            <div className="fz-strip">{cells.map((c) => <i key={`g${c.t}`} className={`fz-cell fz-gps--${c.gps}${c.mismatch ? ' fz-bad' : ''}`} title={c.title} />)}</div>
            <div className="fz-strip">{cells.map((c) => <i key={`a${c.t}`} className={`fz-cell fz-act--${c.activity}${c.mismatch ? ' fz-bad' : ''}`} title={c.title} />)}</div>
          </div>
          <div className="fz-legend">
            <span><i className="fz-cell fz-gps--still" /> GPS still</span>
            <span><i className="fz-cell fz-gps--moving" /> GPS walking speed</span>
            <span><i className="fz-cell fz-gps--vehicle" /> GPS vehicle speed</span>
            <span><i className="fz-cell fz-act--still" /> phone still</span>
            <span><i className="fz-cell fz-act--walking" /> phone walking</span>
            <span><i className="fz-cell fz-bad fz-act--still" /> mismatch</span>
          </div>
        </div>
      )}

      {(e.components ?? []).length > 0 && (
        <table className="checktable" style={{ marginTop: 14 }}>
          <thead>
            <tr><th>Network check</th><th>Result</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {e.components.map((c) => {
              const t = envComponentText(c)
              return (
                <tr key={c.id}>
                  <td>{t.name}</td>
                  <td className="dim">{t.status}</td>
                  <td className="num dim">{t.detail}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {flags.length > 0 && (
        <ul className="help-list">
          {flags.map((f) => (
            <li key={f}><b>{flagMeta(f).label}.</b> {flagMeta(f).help}</li>
          ))}
        </ul>
      )}

      <dl className="kv" style={{ marginTop: 12 }}>
        <dt>Evidence</dt><dd>{fusion.source === 'trail' ? 'recorded trail' : fusion.source === 'legacy_gps' ? 'one GPS point (older app)' : 'none'}{fusion.policy && fusion.policy !== 'optional' ? ` · task policy: ${fusion.policy}` : ''}</dd>
        <dt>Phone sensors</dt><dd>location {s.geo ?? 'unknown'} · motion {s.motion ?? 'unknown'}{s.gyro ? ' · gyroscope' : ''}{s.hz_median ? ` · ${Math.round(s.hz_median)} Hz` : ''}</dd>
        {fusion.ip && (<><dt>Network</dt><dd>{[fusion.ip.city, fusion.ip.region, fusion.ip.country].filter(Boolean).join(', ') || 'unknown location'}{fusion.ip.org ? ` · ${fusion.ip.org}` : ''}{fusion.ip.ip ? ` · ${fusion.ip.ip}` : ''}{fusion.ip.provider === 'dbip-lite' && (<> · <a className="dim" href={DBIP_CREDIT.url} target="_blank" rel="noopener noreferrer" data-testid="dbip-credit-case">{DBIP_CREDIT.text}</a></>)}</dd></>)}
        {!fusion.ip && (<><dt>Network</dt><dd data-testid="net-unavailable">not available: the address was private, unreadable, or no IP database is installed</dd></>)}
        {fusion.ip?.db_date && (<><dt>IP data</dt><dd data-testid="ip-data-age">DB-IP lite · data from {fusion.ip.db_date}{Number.isFinite(fusion.ip.db_age_days) ? ` (${fusion.ip.db_age_days} days old at the time)` : ''}</dd></>)}
        {e.profile && (<><dt>Site network</dt><dd data-testid="profile-visits">{e.profile.visits >= e.profile.needed ? `learned from ${e.profile.visits} accepted visits` : `site has fewer than ${e.profile.needed} accepted visits (${e.profile.visits} so far): "new network" checks are off`}</dd></>)}
        {!fusion.site && (<><dt>Site</dt><dd data-testid="no-site">no site registered for this task</dd></>)}
        {fusion.site && (<><dt>Site</dt><dd>radius {fmtDistance(fusion.site.radius_m)}{ev.site ? ` · ended ${fmtDistance(ev.site.end_m)} away` : ''}</dd></>)}
      </dl>
    </div>
  )
}
