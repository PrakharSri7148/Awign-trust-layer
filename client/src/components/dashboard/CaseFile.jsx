import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from '../../lib/api.js'
import { authHeaders, withToken } from '../../lib/auth.js'
import { FACTORS, flagMeta, pct } from '../../lib/format.js'
import { CHECK_IDS, CHECK_LABELS } from '../../lib/photoQuality/schema.js'
import { isFusionFlag } from '../../lib/sensorFusion/flags.js'
import { caseTitle, decisionMeta, isDemoRow, pctText, severity, whyList } from '../../lib/dashboard/model.js'
import DecisionBar from './DecisionBar.jsx'
import FusionSection from './FusionSection.jsx'
import { Icon, PhotoPill, Pill, SevPill, Skeleton, StatusDot, cx, fmtDateTime, relTime } from './ui.jsx'
import { useFocusTrap } from './useFocusTrap.js'

const TABS = [['summary', 'Summary'], ['photo', 'Photo'], ['sensors', 'Sensors & trail'], ['timeline', 'Timeline']]
const ST = { pass: 'ok', warn: 'warn', fail: 'bad', skip: 'neutral' }
const ST_WORD = { pass: 'Pass', warn: 'Warning', fail: 'Failed', skip: 'Skipped' }
const SEV_COLOR = { critical: 'var(--color-crit)', high: 'var(--color-high)', medium: 'var(--color-warn)', low: 'var(--color-neutral)' }

function Section({ title, children, testid, right }) {
  return (
    <section className={cx('case-section')} data-testid={testid}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><h3>{title}</h3>{right}</div>
      {children}
    </section>
  )
}

/* ---------- Summary ---------- */
function Summary({ row, review, history, siteName }) {
  const rows = FACTORS.map((f) => ({ ...f, v: row.feature_importances?.[f.key] ?? 0 })).sort((a, b) => b.v - a.v)
  const top = rows[0]?.v || 1
  const why = whyList(row)
  const earlier = history.slice(0, -1).reverse()
  return (
    <>
      {review && (
        <div className={cx('review-banner', `review-banner--${decisionMeta(review.decision).tone}`)}>
          <Icon name={decisionMeta(review.decision).icon} />
          <div><strong>{decisionMeta(review.decision).label}</strong> by {review.reviewer} · {relTime(review.at)}{review.reason && <div className={cx('text-2')}>“{review.reason}”</div>}</div>
        </div>
      )}
      {!review && why.length > 0 && (
        <div className={cx('review-banner', 'review-banner--warn')}><Icon name="clipboard-list" /><div><strong>Waiting for a reviewer</strong><div className={cx('text-2')}>{why.join(' · ')}</div></div></div>
      )}
      <Section title="Why this score">
        <div className={cx('why')}>
          <p className={cx('why__sentence')}>{row.top_reason}</p>
          <div className={cx('drivers')} role="list" aria-label="Signal groups behind the score">
            {rows.map((r, i) => (
              <div key={r.key} className={cx('driver')} role="listitem">
                <div className={cx('driver__label')}><span>{r.label}{i === 0 && r.v > 0 && <span className={cx('text-xs', 'text-2')}> · top driver</span>}</span></div>
                <div className={cx('driver__track')}><span className={cx('driver__fill')} style={{ width: `${(r.v / top) * 100}%` }} /></div>
                <span className={cx('driver__value')}>{pct(r.v)}</span>
              </div>
            ))}
          </div>
          <p className={cx('drivers__legend')}>Share of the score each group of signals explains. Higher means it mattered more.</p>
        </div>
      </Section>
      <Section title="Details">
        <dl className={cx('kv')}>
          <dt>Worker</dt><dd className={cx('mono')}>{row.worker_id}</dd>
          <dt>Task</dt><dd className={cx('mono')}>{row.task_id}</dd>
          <dt>Site</dt><dd>{siteName(row.site_id)} <span className={cx('mono', 'text-2')}>{row.site_id}</span></dd>
          <dt>Submitted</dt><dd>{fmtDateTime(row.timestamp)} <span className={cx('text-2')}>({relTime(row.timestamp)})</span></dd>
          <dt>Photo</dt><dd><div className={cx('flag-list')}><PhotoPill verdict={row.photo_verdict ?? 'unverified'} />{(row.quality_flags ?? []).filter((f) => !isFusionFlag(f)).map((f) => <Pill key={f} tone="plain">{flagMeta(f).label}</Pill>)}</div></dd>
        </dl>
      </Section>
      {earlier.length > 0 && (
        <Section title="Earlier decisions">
          <ul className={cx('history')}>{earlier.map((h) => <li key={h.id}><Pill tone={decisionMeta(h.decision).tone}>{decisionMeta(h.decision).label}</Pill> by {h.reviewer} · {fmtDateTime(h.at)}{h.reason && <div className={cx('text-2')}>“{h.reason}”</div>}</li>)}</ul>
        </Section>
      )}
    </>
  )
}

/* ---------- Photo ---------- */
const CHALLENGE_WORDS = { blink: 'blink', turn_left: 'turn head left', turn_right: 'turn head right', smile: 'smile', open_mouth: 'open mouth' }
const fx = (v, d = 2) => (v == null ? '-' : Number(v).toFixed(d))

function LivenessSection({ server, ev }) {
  const check = server?.checks?.liveness
  const live = ev?.liveness
  const passive = server?.passive
  if (!check && !live && !passive) return null
  const v = live?.validation
  const e = live?.evidence
  const cp = live?.client_passive
  return (
    <Section title="Live check" testid="liveness-section" right={check && <Pill tone={ST[check.status]}>{ST_WORD[check.status]}</Pill>}>
      {check?.hint && <p className={cx('text-2', 'text-sm')}>{check.hint}</p>}
      <dl className={cx('kv')}>
        {check?.details?.reason && <><dt>Result</dt><dd>{check.details.reason.replace(/_/g, ' ')}</dd></>}
        {e?.challenges && <><dt>Challenges</dt><dd>{e.challenges.map((c) => CHALLENGE_WORDS[c] ?? c).join(' + ')}{e.attempts ? ` · attempt ${e.attempts}` : ''}</dd></>}
        {e?.results?.length > 0 && <><dt>Device says</dt><dd>{e.results.map((r) => `${CHALLENGE_WORDS[r.id] ?? r.id}: ${r.status} (${((r.t1 - r.t0) / 1000).toFixed(1)}s)`).join(', ')}</dd></>}
        {v?.replay && <><dt>Server replay</dt><dd>{v.replay.phase === 'passed' ? 'the signal timeline shows the challenges being performed' : `timeline does not show it (${v.replay.phase})`}</dd></>}
        {live && <><dt>Nonce</dt><dd>{live.nonce_claimed === true ? 'issued by the server, used once' : live.nonce_claimed === false ? 'already used (replay)' : 'not consumed'}</dd></>}
        {v?.reasons?.length > 0 && <><dt>Rejected because</dt><dd>{v.reasons.join('; ')}</dd></>}
        {passive?.score != null && <><dt>Screen / print</dt><dd>{passive.status} · score {fx(passive.score)} (moire {fx(passive.moire?.score, 1)}, frame {fx(passive.bezel?.score)}), recomputed on the stored photo</dd></>}
        {cp && <><dt>Camera session</dt><dd>banding {fx(cp.banding?.score)} · planar {String(cp.planar?.planar)} · glare on face {fx(cp.glareFace?.overlap)} (device-reported)</dd></>}
      </dl>
    </Section>
  )
}

function Photo({ row, detail }) {
  const server = detail?.server
  const client = detail?.client
  const ev = detail?.evidence
  const flags = (row.quality_flags ?? []).filter((f) => !isFusionFlag(f))
  const checks = server ? CHECK_IDS.filter((id) => server.checks[id]) : []
  const fmt = (c) => (c?.value == null ? '-' : Number(c.value).toFixed(2))
  const verdict = row.photo_verdict ?? 'unverified'
  return (
    <>
      <div className={cx('photo-frame')}>
        {row.has_photo
          ? <a href={withToken(`${API_BASE}${row.photo_url}`)} target="_blank" rel="noreferrer"><img className={cx('photo-img')} src={withToken(`${API_BASE}${row.photo_url}`)} alt={`Photo submitted for case ${row.id}`} loading="lazy" /></a>
          : <div className={cx('photo-none')}><Icon name="image" size={28} /><span>No photo is stored for this submission.</span></div>}
      </div>
      <Section title="Photo check" right={<span className={cx('flag-list')}><span className={cx('text-xs', 'text-2', 'num')}>quality {Math.round((row.photo_quality_score ?? 0) * 100)}/100</span><PhotoPill verdict={verdict} /></span>}>
        {flags.length > 0 ? (
          <>
            <div className={cx('flag-list')}>{flags.map((f) => <Pill key={f} tone="plain">{flagMeta(f).label}</Pill>)}</div>
            <ul className={cx('help-list')}>{flags.map((f) => <li key={f}><b>{flagMeta(f).label}.</b> {flagMeta(f).help}</li>)}</ul>
          </>
        ) : <span className={cx('text-2', 'text-sm')}>No quality flags</span>}
        {checks.length > 0 && (
          <div className={cx('table-wrap')}>
            <table className={cx('table')}>
              <caption className={cx('sr-only')}>Photo checks, server and device</caption>
              <thead><tr><th scope="col">Check</th><th scope="col">Server</th><th scope="col">Value</th><th scope="col">Device</th></tr></thead>
              <tbody>
                {checks.map((id) => {
                  const s = server.checks[id]
                  const c = client?.checks?.[id]
                  const differs = c && s.status !== c.status && s.status !== 'skip'
                  return (
                    <tr key={id} className={cx(differs && 'is-differs')} title={s.hint ?? ''}>
                      <td>{CHECK_LABELS[id]}</td>
                      <td><Pill tone={ST[s.status]}>{ST_WORD[s.status]}</Pill></td>
                      <td className={cx('num', 'text-2')}>{fmt(s)}</td>
                      <td>{c ? <Pill tone={ST[c.status] ?? 'neutral'}>{ST_WORD[c.status] ?? c.status}</Pill> : <span className={cx('text-2')}>-</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {checks.length > 0 && client?.checks && <p className={cx('text-xs', 'text-2')}>Highlighted rows: the device and the server disagree.</p>}
      </Section>
      <LivenessSection server={server} ev={ev} />
      {ev && (
        <Section title="Capture">
          <dl className={cx('kv')}>
            <dt>Source</dt><dd>{ev.capture?.source === 'camera' ? 'In-app live camera' : 'Picked file'}{ev.capture?.burst ? ` · burst ${ev.capture.burst.picked + 1}/${ev.capture.burst.frames}` : ''}</dd>
            <dt>Camera</dt><dd>{[ev.exif?.make, ev.exif?.model].filter(Boolean).join(' ') || 'unknown'}</dd>
            <dt>EXIF time</dt><dd>{ev.exif?.taken_at ? new Date(ev.exif.taken_at).toLocaleString() : 'none'}</dd>
            {client?.sensor && <><dt>Steadiness</dt><dd>{client.sensor.rotation_rms}°/s rot · {client.sensor.accel_rms} m/s² (device-reported)</dd></>}
            {server?.metrics && <><dt>Size</dt><dd>{server.metrics.width}×{server.metrics.height}</dd></>}
          </dl>
        </Section>
      )}
    </>
  )
}

/* ---------- Timeline ---------- */
function Timeline({ row, history }) {
  const verdict = row.photo_verdict ?? 'unverified'
  const steps = [
    ['send', 'Submitted', fmtDateTime(row.timestamp), row.timestamp],
    ['camera', 'Photo checked on device', 'edge validation · focus, light, lens, glare, shake, noise, face'],
    ['image', 'Photo re-checked by server', verdict === 'unverified' ? 'no photo to check' : `verdict: ${verdict}${row.client_mismatch ? ' · device report contradicted' : ''}`],
    ['satellite', 'Sensors read', row.fusion_version >= 1 ? 'GPS trail · accelerometer / gyroscope · network' : 'GPS · motion · network'],
    ['activity', 'Scored by classifier', `p = ${pct(row.fraud_probability)}`],
    [row.status === 'flagged' ? 'shield-alert' : 'shield-check', row.status === 'flagged' ? 'Flagged for review' : 'Accepted automatically', whyList(row).join(' · ')],
    ...history.map((h) => [decisionMeta(h.decision).icon, `${decisionMeta(h.decision).label} by ${h.reviewer}`, h.reason ?? '', h.at]),
  ]
  return (
    <ol className={cx('timeline')}>
      {steps.map(([icon, title, sub, at], i) => (
        <li key={`${title}-${i}`}>
          <span className={cx('timeline__icon')}><Icon name={icon} /></span>
          <div>
            <div className={cx('timeline__title')}>{title}</div>
            {sub ? <div className={cx('timeline__sub')}>{sub}</div> : null}
            {at ? <div className={cx('timeline__time')}>{fmtDateTime(at)}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

/* ---------- The slide-over ---------- */
export default function CaseFile({ row, list, onClose, onNavigate, onSaved, siteName, initialDecision }) {
  const rootRef = useRef(null)
  const titleRef = useRef(null)
  const [tab, setTab] = useState('summary')
  const [full, setFull] = useState(null)
  const [history, setHistory] = useState([])
  const [review, setReview] = useState(row.review ?? null)
  const demo = isDemoRow(row)
  useFocusTrap(rootRef, onClose)

  // The list endpoint leaves the per-check and sensor reports out; fetch them for this case.
  useEffect(() => {
    setTab('summary'); setFull(null); setReview(row.review ?? null)
    if ((!row.has_photo && !(row.fusion_version >= 1)) || demo) return undefined
    let alive = true
    fetch(`${API_BASE}/submissions/${row.id}`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)).then((d) => alive && setFull(d ?? false)).catch(() => alive && setFull(false))
    return () => { alive = false }
  }, [row.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadHistory = useCallback(() => {
    if (demo) { setHistory([]); return () => {} }
    let alive = true
    fetch(`${API_BASE}/submissions/${row.id}/reviews`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : [])).then((h) => alive && setHistory(h)).catch(() => {})
    return () => { alive = false }
  }, [row.id, demo])
  useEffect(() => loadHistory(), [loadHistory, review])

  useEffect(() => { titleRef.current?.focus() }, [row.id])
  useEffect(() => { const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = prev } }, [])

  const sev = severity(row.fraud_probability)
  const i = list.indexOf(row.id)
  const detail = full ? full.photo_quality ?? null : null
  const onTabKey = (e) => {
    const idx = TABS.findIndex(([k]) => k === tab)
    const n = e.key === 'ArrowRight' ? idx + 1 : e.key === 'ArrowLeft' ? idx - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null
    if (n === null) return
    e.preventDefault()
    const k = TABS[(n + TABS.length) % TABS.length][0]
    setTab(k)
    requestAnimationFrame(() => document.getElementById(`case-tab-${k}`)?.focus())
  }

  return (
    <>
      <div className={cx('scrim')} onClick={onClose} />
      <aside ref={rootRef} className={cx('slide-over')} role="dialog" aria-modal="true" aria-labelledby="case-title" data-testid="case-file">
        <header className={cx('case-head')}>
          <div className={cx('case-head__top')}>
            <span className={cx('case-head__id')}>Case #{row.id}</span>
            <StatusDot row={{ ...row, review }} />
            <div className={cx('case-head__nav')}>
              <button type="button" className={cx('icon-btn')} aria-label="Previous case" disabled={i <= 0} onClick={() => onNavigate(list[i - 1])}><Icon name="chevron-up" /></button>
              <button type="button" className={cx('icon-btn')} aria-label="Next case" disabled={i < 0 || i >= list.length - 1} onClick={() => onNavigate(list[i + 1])}><Icon name="chevron-down" /></button>
              <button type="button" className={cx('icon-btn')} aria-label="Close case file" onClick={onClose}><Icon name="x" /></button>
            </div>
          </div>
          <div className={cx('case-head__title')}>
            <h2 id="case-title" tabIndex={-1} ref={titleRef}>{caseTitle(row)}</h2>
            <div className={cx('case-head__score')}><strong style={{ color: SEV_COLOR[sev.key] }}>{pctText(row.fraud_probability)}</strong><small>fraud probability</small></div>
          </div>
          <div className={cx('case-head__pills')}><SevPill p={row.fraud_probability} /><PhotoPill verdict={row.photo_verdict ?? 'unverified'} /></div>
          <p className={cx('case-head__meta')}><span className={cx('mono')}>{row.worker_id}</span> · {siteName(row.site_id)} · {fmtDateTime(row.timestamp)}</p>
        </header>

        <div className={cx('tabs')} role="tablist" aria-label="Case sections" onKeyDown={onTabKey}>
          {TABS.map(([k, l]) => <button key={k} id={`case-tab-${k}`} type="button" role="tab" className={cx('tab')} aria-selected={tab === k} aria-controls="case-panel" tabIndex={tab === k ? 0 : -1} onClick={() => setTab(k)}>{l}</button>)}
        </div>

        <div className={cx('case-body')} id="case-panel" role="tabpanel" tabIndex={0} aria-labelledby={`case-tab-${tab}`}>
          {tab === 'summary' && <Summary row={row} review={review} history={history} siteName={siteName} />}
          {tab === 'photo' && <Photo row={row} detail={detail} />}
          {tab === 'sensors' && (row.fusion_version >= 1 && !demo && full === null ? <Skeleton h={180} /> : full === false && !row.fusion ? <p className={cx('text-2', 'text-sm')} role="alert">Could not load the sensor report for this case. Close it and open it again to retry.</p> : <FusionSection row={row} fusion={full?.fusion ?? row.fusion} />)}
          {tab === 'timeline' && <Timeline row={row} history={history.length ? history : review ? [review] : []} />}
        </div>

        <DecisionBar key={row.id} row={row} review={review} initialDecision={initialDecision} onSaved={(r) => { setReview(r); onSaved?.(r) }} />
      </aside>
    </>
  )
}
