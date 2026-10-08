// Seeded demo data so the dashboard looks alive without a populated backend.
const WORKERS = ['worker_0142', 'worker_0377', 'worker_0518', 'worker_0904', 'worker_demo_1']
const SITES = ['site_blr_014', 'site_del_221', 'site_mum_087', 'site_hyd_032', 'site_demo_1']
const TASKS = ['task_shelf_audit', 'task_store_front', 'task_signage', 'task_demo_1']

const REASONS = {
  motion: 'GPS jumped 14.2 km in 5 s while the phone stayed still',
  ambient: 'The network resolves 840 km from the site',
  photo: 'Photo quality flagged',
  none: 'No issues detected',
}

function rng(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function norm(a, b, c) {
  const t = a + b + c
  return { photo_quality: a / t, motion_consistency: b / t, ambient_fingerprint: c / t }
}

// A demo sensor-fusion report in the shape the server sends (fusion/pipeline.py). Invented data, for the demo mode only.
function mockFusion(r, kind, flagged) {
  const t0 = 12.9716
  const l0 = 77.5946
  const walk = (n) => Array.from({ length: n }, (_, i) => [i * 5, +(t0 + 0.0001 * Math.sin(i / 5)).toFixed(6), +(l0 - 0.002 + (0.002 * i) / (n - 1)).toFixed(6), 8])
  const spoof = kind === 'motion'
  const points = spoof ? [...Array.from({ length: 12 }, (_, i) => [i * 5, 13.03, 77.65, 8]), ...Array.from({ length: 12 }, (_, i) => [60 + i * 5, t0, l0, 8])] : walk(30)
  const rows = Array.from({ length: spoof ? 24 : 30 }, (_, i) => ({
    t: i * 5,
    gps: spoof ? (i === 11 ? 'jump' : 'still') : i > 24 ? 'still' : 'moving',
    gps_ms: spoof ? null : i > 24 ? 0.1 : +(1.1 + r() * 0.5).toFixed(2),
    activity: spoof ? 'still' : i > 24 ? 'still' : 'walking',
    acc_rms: spoof ? 0.06 : i > 24 ? 0.08 : +(1.4 + r()).toFixed(2),
    verdict: spoof ? 'skip' : i > 24 ? 'ok' : 'rhythm',
  }))
  const netBad = kind === 'ambient'
  return {
    version: 1, source: 'trail', policy: 'optional', flags: spoof ? ['gps_jump', 'gps_jump_flat_motion', 'arrival_without_approach'] : netBad ? ['ip_region_mismatch', 'network_unseen_at_site'] : [],
    motion: { score: spoof ? 0.16 : 0.97, known: true, sensor_used: true, penalties: {}, reason: spoof ? REASONS.motion : null,
      evidence: { fixes: points.length, reliable_fixes: points.length, duration_s: points.length * 5, distance_m: spoof ? 0 : 280, windows: rows.length, jumps: spoof ? [{ t0: 0, t1: 5, dist_m: 14200, dt_s: 5, from: [13.03, 77.65], to: [t0, l0], verdict: 'flat' }] : [], rows, site: { start_m: spoof ? 14200 : 220, end_m: 12, radius_m: 60 } } },
    environment: { score: netBad ? 0.55 : 1, known: true, penalties: {}, reason: netBad ? REASONS.ambient : null,
      components: [{ id: 'link', status: netBad ? 'unseen' : 'match', detail: '4g|3|<50' }, { id: 'ip_location', status: netBad ? 'far' : 'near', detail: netBad ? '840 km from the site' : '6 km from the site' }] },
    ip: { country: 'IN', region: netBad ? 'Maharashtra' : 'Karnataka', city: netBad ? 'Mumbai' : 'Bengaluru', asn: 55836, org: 'Reliance Jio Infocomm', ip: '49.36.1.0', provider: 'demo' },
    sensors: { geo: 'granted', motion: 'granted', gyro: true, hz_median: 58 },
    trail: { points, span_s: points.length * 5 }, site: { lat: t0, lng: l0, radius_m: 60 }, notes: [],
  }
}

let counter = 0

export function makeMock(r, ts, forceStatus) {
  const flagged = forceStatus ? forceStatus === 'flagged' : r() < 0.38
  const id = `demo-${100 + counter++}`
  const pick = (arr) => arr[Math.floor(r() * arr.length)]
  let p, reason, fi, kindOf = 'ok'
  if (flagged) {
    p = 0.62 + r() * 0.37
    const kind = r() < 0.5 ? 'motion' : r() < 0.8 ? 'ambient' : 'photo'
    kindOf = kind
    reason = REASONS[kind]
    fi =
      kind === 'motion'
        ? norm(0.04 + r() * 0.04, 0.6 + r() * 0.25, 0.15 + r() * 0.2)
        : kind === 'ambient'
          ? norm(0.04 + r() * 0.04, 0.2 + r() * 0.2, 0.6 + r() * 0.25)
          : norm(0.55 + r() * 0.2, 0.2, 0.2)
  } else {
    p = 0.002 + r() * 0.14
    reason = REASONS.none
    fi = norm(0.02, 0.35 + r() * 0.2, 0.4 + r() * 0.2)
  }
  // Photo-quality fields as the server reports them. Demo rows carry no stored photo.
  const photoBad = flagged && reason === REASONS.photo
  const roll = r()
  const flags = photoBad
    ? [pick(['blur', 'exposure', 'obstruction']), ...(r() < 0.4 ? ['glare'] : [])]
    : roll < 0.12 ? [pick(['glare', 'noise', 'shake'])] : roll < 0.16 ? ['duplicate_photo'] : roll < 0.2 ? ['client_verdict_mismatch'] : []
  const verdict = photoBad ? 'block' : flags.some((f) => ['glare', 'noise', 'shake'].includes(f)) ? 'warn' : 'pass'
  if (photoBad) reason = 'Photo quality problem: ' + flags.map((f) => ({ blur: 'blurry', exposure: 'exposure', obstruction: 'lens covered', glare: 'glare' })[f]).join(', ')
  return {
    id,
    photo_verdict: verdict,
    photo_quality_score: verdict === 'block' ? 0.15 + r() * 0.25 : verdict === 'warn' ? 0.5 + r() * 0.2 : 0.78 + r() * 0.2,
    quality_flags: flags,
    photo_override: verdict === 'warn' && r() < 0.5,
    client_mismatch: flags.includes('client_verdict_mismatch'),
    has_photo: false,
    photo_url: null,
    worker_id: pick(WORKERS),
    task_id: pick(TASKS),
    site_id: pick(SITES),
    timestamp: new Date(ts).toISOString(),
    fusion_version: 1,
    motion_known: true,
    env_known: true,
    fusion: mockFusion(r, flagged ? kindOf : 'ok', flagged),
    status: flagged ? 'flagged' : 'accepted',
    fraud_probability: p,
    top_reason: reason,
    feature_importances: fi,
  }
}

export function seedMock(n = 40) {
  const r = rng(7)
  const now = Date.now()
  return Array.from({ length: n }, (_, i) => makeMock(r, now - i * 8.5 * 60 * 1000 - r() * 4 * 60 * 1000))
}
