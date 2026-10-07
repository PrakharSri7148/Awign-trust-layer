// Seeded demo data so the dashboard looks alive without a populated backend.
const WORKERS = ['worker_0142', 'worker_0377', 'worker_0518', 'worker_0904', 'worker_demo_1']
const SITES = ['site_blr_014', 'site_del_221', 'site_mum_087', 'site_hyd_032', 'site_demo_1']
const TASKS = ['task_shelf_audit', 'task_store_front', 'task_signage', 'task_demo_1']

const REASONS = {
  motion: 'Motion mismatch: near-zero movement despite location change',
  ambient: "Site fingerprint mismatch: ambient signal doesn't match known site",
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

let counter = 0

export function makeMock(r, ts, forceStatus) {
  const flagged = forceStatus ? forceStatus === 'flagged' : r() < 0.38
  const id = `demo-${100 + counter++}`
  const pick = (arr) => arr[Math.floor(r() * arr.length)]
  let p, reason, fi
  if (flagged) {
    p = 0.62 + r() * 0.37
    const kind = r() < 0.5 ? 'motion' : r() < 0.8 ? 'ambient' : 'photo'
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
