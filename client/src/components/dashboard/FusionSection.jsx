import { DBIP_CREDIT } from '../../lib/ipDatabase.js'
import { flagMeta } from '../../lib/format.js'
import { countryName, envComponentText, fmtDistance, fmtLatLng, scoreWord, timelineCells, trailGeometry, whereSummary } from '../../lib/sensorFusion/display.js'
import { isFusionFlag } from '../../lib/sensorFusion/flags.js'
import { Icon, Pill, cx, fmtDateTime } from './ui.jsx'

const pct0 = (v) => `${Math.round((v ?? 0) * 100)}`
const TONE = { green: 'ok', amber: 'warn', red: 'bad', muted: 'neutral' }

function Section({ title, children, testid }) {
  return <section className={cx('case-section')} data-testid={testid}><h3>{title}</h3>{children}</section>
}

const osmLink = (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`

// Where the site is, where the phone said it was, where the network resolves to: side by side, so a VPN in another country is obvious.
function WhereSection({ w }) {
  const { site, pos, start, net } = w
  return (
    <section className={cx('case-section')} data-testid="where-section">
      <h3>Where</h3>
      {w.headline && <div className={cx('review-banner', `review-banner--${w.headline.tone === 'bad' ? 'bad' : 'warn'}`)} data-testid="where-headline"><Icon name="map-pin" /><div>{w.headline.text}</div></div>}
      <dl className={cx('kv', 'where')}>
        <dt>Site</dt>
        <dd data-testid="where-site">
          {site ? <><span className={cx('num')}>{fmtLatLng(site.lat, site.lng)}</span>{site.country ? <> · {countryName(site.country)}</> : null} · radius {fmtDistance(site.radius_m)}</> : <span className={cx('text-2')}>no site registered for this task</span>}
        </dd>
        {start && (
          <>
            <dt>Phone at start</dt>
            <dd data-testid="where-start">
              <span className={cx('num')}>{fmtLatLng(start.lat, start.lng)}</span>{start.acc_m != null ? <span className={cx('text-2')}> ±{Math.round(start.acc_m)} m</span> : null}
              {w.startFromSiteM != null ? <> · {fmtDistance(w.startFromSiteM)} from the site</> : null}
              <div className={cx('text-xs', 'text-2')}>first GPS point of the visit · reported by the phone · <a href={osmLink(start.lat, start.lng)} target="_blank" rel="noopener noreferrer">open on a map</a></div>
            </dd>
          </>
        )}
        <dt>Phone at submit</dt>
        <dd data-testid="where-phone">
          {pos
            ? <>
              <span className={cx('num')}>{fmtLatLng(pos.lat, pos.lng)}</span>{pos.acc_m != null ? <span className={cx('text-2')}> ±{Math.round(pos.acc_m)} m</span> : null}
              {w.phoneFromSiteM != null ? <> · {fmtDistance(w.phoneFromSiteM)} from the site</> : null}{start && w.startToEndM != null ? <> · {fmtDistance(w.startToEndM)} from where it started</> : null}
              <div className={cx('text-xs', 'text-2')}>{pos.at ? `last GPS fix before submitting · ${fmtDateTime(new Date(pos.at).toISOString())}` : pos.source === 'legacy_gps' ? 'the only GPS point sent (older app)' : 'last saved GPS point of the trail'} · reported by the phone · <a href={osmLink(pos.lat, pos.lng)} target="_blank" rel="noopener noreferrer">open on a map</a></div>
            </>
            : <span className={cx('text-2')}>no GPS position is stored for this submission (none was sent, or it was deleted after the retention period)</span>}
        </dd>
        <dt>Network</dt>
        <dd data-testid="where-network">
          {net
            ? <>
              <b>{countryName(net.country) ?? 'unknown country'}</b>{net.place ? ` · ${net.place}` : ''}
              {net.located ? <div className={cx('num')} data-testid="where-network-coords">lat {net.lat.toFixed(2)}, lng {net.lng.toFixed(2)}</div> : null}
              {net.org ? <div className={cx('text-xs', 'text-2')}>{net.org}</div> : null}
              <div className={cx('text-xs', 'text-2')}>
                {w.netFromSiteKm != null ? `${Math.round(w.netFromSiteKm)} km from the site` : null}{w.netFromSiteKm != null && w.netFromPhoneKm != null ? ' · ' : null}{w.netFromPhoneKm != null ? `${Math.round(w.netFromPhoneKm)} km from the phone's GPS` : null}
                {w.netFromSiteKm == null && w.netFromPhoneKm == null ? (net.purged && !net.located ? 'coordinates deleted after the retention period' : 'from the IP address; city-level at best') : ' · from the IP address; city-level at best, mobile networks can resolve far away'}
              </div>
            </>
            : <span className={cx('text-2')}>not available: the address was private, unreadable, or no IP database is installed</span>}
        </dd>
      </dl>
    </section>
  )
}

// The case file's Sensor fusion section: how the phone's movement compared with the GPS trail, and whether the network fits the claimed area.
// It states what was MEASURED and how much evidence there was; it never decides (the classifier does).
export default function FusionSection({ row, fusion }) {
  if ((row.fusion_version ?? 0) < 1) {
    return <Section title="Sensor fusion" testid="fusion-section"><p className={cx('text-2', 'text-sm')}>This submission was scored before sensor fusion existed (a 3-second movement average and a network speed hash). No GPS trail was compared.</p></Section>
  }
  if (!fusion || !fusion.motion) {
    return <Section title="Sensor fusion" testid="fusion-section"><p className={cx('text-2', 'text-sm')}>Loading the sensor report…</p></Section>
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
  const where = whereSummary(fusion)
  const netKnown = (e.components ?? []).some((c) => ['ip_location', 'asn', 'hosting', 'wifi', 'cell'].includes(c.id) && c.status !== 'unavailable')

  return (
    <div data-testid="fusion-section" className={cx('fusion')}>
      {where?.any && <WhereSection w={where} />}
      <section className={cx('case-section')}>
        <h3>Sensor fusion</h3>
        <div className={cx('fz-scores')}>
          <div className={cx('fz-score', `fz-score--${mw.tone}`)}>
            <span className={cx('text-xs', 'text-2')}>Motion vs GPS trail</span>
            <b className={cx('num')}>{m.known ? pct0(m.score) : '-'}</b>
            <Pill tone={TONE[mw.tone]}>{mw.word}</Pill>
            <small>{m.sensor_used ? 'GPS + accelerometer / gyroscope' : 'GPS only (no motion data)'}</small>
          </div>
          <div className={cx('fz-score', `fz-score--${ew.tone}`)}>
            <span className={cx('text-xs', 'text-2')}>Network vs claimed area</span>
            <b className={cx('num')}>{e.known ? pct0(e.score) : '-'}</b>
            <Pill tone={TONE[ew.tone]}>{ew.word}</Pill>
            <small>{netKnown ? 'IP / provider / profile' : 'network speed class only'}</small>
          </div>
        </div>
        {reasons.length > 0 && <ul className={cx('help-list')}>{reasons.map((r) => <li key={r}>{r}.</li>)}</ul>}
      </section>

      {geom && (
        <section className={cx('case-section')}>
          <h3>Approach trail</h3>
          <div className={cx('trail')}>
            <p className={cx('text-xs', 'text-2', 'num')} style={{ marginBottom: 6 }}>
              {ev.fixes ?? fusion.trail.points.length} fixes · {fmtDistance(ev.distance_m)} · {Math.round(ev.duration_s ?? fusion.trail.span_s ?? 0)} s · drawing ≈ {fmtDistance(geom.spanM)} across
            </p>
            <svg className={cx('fz-trail')} viewBox={`0 0 ${geom.w} ${geom.h}`} role="img" aria-label="The recorded GPS trail relative to the site">
              {geom.site && <circle cx={geom.site.c[0]} cy={geom.site.c[1]} r={geom.site.r} className={cx('fz-site')} />}
              <path d={geom.path} className={cx('fz-path')} />
              {geom.jumps.map((j) => <line key={`${j.from}-${j.to}`} x1={j.from[0]} y1={j.from[1]} x2={j.to[0]} y2={j.to[1]} className={cx('fz-jump')} />)}
              <circle cx={geom.start[0]} cy={geom.start[1]} r="4.5" className={cx('fz-start')} />
              <circle cx={geom.end[0]} cy={geom.end[1]} r="5" className={cx('fz-end')} />
            </svg>
            <p className={cx('text-xs', 'text-2')} style={{ marginTop: 6 }}>
              Hollow dot = start, filled = end{geom.site ? ', circle = the site’s radius' : ' (no site location registered)'}{geom.jumps.length ? ', dashed = a GPS jump' : ''}. Drawn locally; no map service is contacted.
            </p>
          </div>
        </section>
      )}
      {!geom && fusion.trail?.purged && <p className={cx('text-2', 'text-sm')}>The location points were deleted after the retention period; the scores and flags are kept.</p>}

      {cells.length > 0 && (
        <section className={cx('case-section')}>
          <h3>What the GPS said vs what the phone felt, every 5 s</h3>
          <div className={cx('fz-strips')} role="img" aria-label="Timeline of GPS speed class against phone activity; mismatches outlined">
            <div className={cx('fz-strip')}><span className={cx('fz-strip__label')}>GPS</span>{cells.map((c) => <i key={`g${c.t}`} className={cx('fz-cell', `fz-gps--${c.gps}`, c.mismatch && 'fz-bad')} title={c.title} />)}</div>
            <div className={cx('fz-strip')}><span className={cx('fz-strip__label')}>Phone</span>{cells.map((c) => <i key={`a${c.t}`} className={cx('fz-cell', `fz-act--${c.activity}`, c.mismatch && 'fz-bad')} title={c.title} />)}</div>
          </div>
          <div className={cx('fz-legend')}>
            <span><i className={cx('fz-cell', 'fz-gps--still')} /> GPS still</span><span><i className={cx('fz-cell', 'fz-gps--moving')} /> GPS walking speed</span><span><i className={cx('fz-cell', 'fz-gps--vehicle')} /> GPS vehicle speed</span>
            <span><i className={cx('fz-cell', 'fz-act--still')} /> phone still</span><span><i className={cx('fz-cell', 'fz-act--walking')} /> phone walking</span><span><i className={cx('fz-cell', 'fz-bad', 'fz-act--still')} /> mismatch</span>
          </div>
        </section>
      )}

      {(e.components ?? []).length > 0 && (
        <section className={cx('case-section')}>
          <h3>Network checks</h3>
          <div className={cx('table-wrap')}>
            <table className={cx('table')}>
              <thead><tr><th scope="col">Network check</th><th scope="col">Result</th><th scope="col">Detail</th></tr></thead>
              <tbody>
                {e.components.map((c) => { const t = envComponentText(c); return <tr key={c.id}><td>{t.name}</td><td className={cx('text-2')}>{t.status}</td><td className={cx('num', 'text-2')}>{t.detail}</td></tr> })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {flags.length > 0 && (
        <section className={cx('case-section')}>
          <h3>Sensor flags</h3>
          <div className={cx('flag-list')}>{flags.map((f) => <span key={f} className={cx('pill', 'pill--plain')}>{flagMeta(f).label}</span>)}</div>
          <ul className={cx('help-list')}>{flags.map((f) => <li key={f}><b>{flagMeta(f).label}.</b> {flagMeta(f).help}</li>)}</ul>
        </section>
      )}

      <section className={cx('case-section')}>
        <h3>Evidence</h3>
        <dl className={cx('kv')}>
          <dt>Evidence</dt><dd>{fusion.source === 'trail' ? 'recorded trail' : fusion.source === 'legacy_gps' ? 'one GPS point (older app)' : 'none'}{fusion.policy && fusion.policy !== 'optional' ? ` · task policy: ${fusion.policy}` : ''}</dd>
          <dt>Phone sensors</dt><dd>location {s.geo ?? 'unknown'} · motion {s.motion ?? 'unknown'}{s.gyro ? ' · gyroscope' : ''}{s.hz_median ? ` · ${Math.round(s.hz_median)} Hz` : ''}</dd>
          {fusion.ip && (
            <><dt>Network</dt><dd>
              {[fusion.ip.city, fusion.ip.region, fusion.ip.country].filter(Boolean).join(', ') || 'unknown location'}{fusion.ip.org ? ` · ${fusion.ip.org}` : ''}{fusion.ip.ip ? ` · ${fusion.ip.ip}` : ''}
              {fusion.ip.provider === 'dbip-lite' && <> · <a href={DBIP_CREDIT.url} target="_blank" rel="noopener noreferrer" data-testid="dbip-credit-case">{DBIP_CREDIT.text}</a></>}
            </dd></>
          )}
          {!fusion.ip && <><dt>Network</dt><dd data-testid="net-unavailable">not available: the address was private, unreadable, or no IP database is installed</dd></>}
          {fusion.ip?.db_date && <><dt>IP data</dt><dd data-testid="ip-data-age">DB-IP lite · data from {fusion.ip.db_date}{Number.isFinite(fusion.ip.db_age_days) ? ` (${fusion.ip.db_age_days} days old at the time)` : ''}</dd></>}
          {e.profile && <><dt>Site network</dt><dd data-testid="profile-visits">{e.profile.visits >= e.profile.needed ? `learned from ${e.profile.visits} accepted visits` : `site has fewer than ${e.profile.needed} accepted visits (${e.profile.visits} so far): "new network" checks are off`}</dd></>}
          {!fusion.site && <><dt>Site</dt><dd data-testid="no-site">no site registered for this task</dd></>}
          {fusion.site && <><dt>Site</dt><dd>radius {fmtDistance(fusion.site.radius_m)}{ev.site ? ` · ended ${fmtDistance(ev.site.end_m)} away` : ''}</dd></>}
        </dl>
      </section>
    </div>
  )
}
