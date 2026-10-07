export const pct = (v, d = 1) => `${((v ?? 0) * 100).toFixed(d)}%`

export function relTime(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export const FACTORS = [
  { key: 'photo_quality', label: 'Photo quality', color: '#8b5cf6' },
  { key: 'motion_consistency', label: 'Motion consistency', color: '#22d3ee' },
  { key: 'ambient_fingerprint', label: 'Ambient fingerprint', color: '#fbbf24' },
]

export const isFlagged = (s) => s.status === 'flagged'

// ---- photo quality ---------------------------------------------------------
// Every flag the server can attach to a submission, in plain language. `kind`:
//   quality   - a problem with the photo itself (a quality check id)
//   integrity - something that makes the photo's provenance doubtful
//   info      - context a reviewer may want, not a problem
export const FLAG_META = {
  blur: { label: 'Blurry', kind: 'quality', help: 'Out of focus or soft.' },
  exposure: { label: 'Lighting', kind: 'quality', help: 'Too dark, over-exposed or washed out.' },
  glare: { label: 'Glare', kind: 'quality', help: 'Reflection or bright source blowing out part of the photo.' },
  resolution: { label: 'Low resolution', kind: 'quality', help: 'Too few pixels to be useful.' },
  obstruction: { label: 'Lens covered', kind: 'quality', help: 'A finger, cloth or dirt over part or all of the lens.' },
  noise: { label: 'Noise / compression', kind: 'quality', help: 'Grainy (low light) or heavily compressed.' },
  shake: { label: 'Camera shake', kind: 'quality', help: 'Directional motion blur from camera movement.' },
  face: { label: 'Face not clear', kind: 'quality', help: 'Face missing, cut off, too small, blurred, in shadow or hidden.' },
  photo_missing: { label: 'No photo', kind: 'integrity', help: 'The submission arrived without a photo, so it could not be verified.' },
  photo_unverified: { label: 'Photo unverified', kind: 'integrity', help: 'Accepted on the device\'s word (legacy mode).' },
  face_unchecked: { label: 'Face unchecked', kind: 'info', help: 'The server could not check the face (detector unavailable).' },
  duplicate_photo: { label: 'Duplicate photo', kind: 'integrity', help: 'The identical photo was submitted by another worker, task or site.' },
  near_duplicate_photo: { label: 'Near-duplicate', kind: 'integrity', help: 'A re-compressed or resized copy of an earlier photo.' },
  old_photo: { label: 'Old photo', kind: 'integrity', help: 'EXIF says it was taken more than two days before submission.' },
  no_exif: { label: 'No EXIF', kind: 'info', help: 'No camera metadata: a screenshot, edited or forwarded copy (expected for in-app camera shots).' },
  not_live_capture: { label: 'Not live capture', kind: 'integrity', help: 'This task needs the live camera but a picked file was sent.' },
  camera_shake_reported: { label: 'Shake (sensor)', kind: 'info', help: 'The phone\'s motion sensors say it was moving at capture (device-reported).' },
  submitted_anyway: { label: 'Submitted anyway', kind: 'info', help: 'The worker overrode a quality warning.' },
  client_verdict_mismatch: { label: 'Device report mismatch', kind: 'integrity', help: 'The device said the photo was fine; the server measured otherwise.' },
  client_dimensions_mismatch: { label: 'Device size mismatch', kind: 'integrity', help: 'The photo size the device reported is not the real size.' },
  client_report_missing: { label: 'No device report', kind: 'info', help: 'The device sent no quality report.' },
}

export function flagMeta(flag) {
  if (FLAG_META[flag]) return FLAG_META[flag]
  const missed = /^client_missed_(.+)$/.exec(flag)
  if (missed) return { label: `Device missed: ${missed[1]}`, kind: 'integrity', help: `The device reported "${missed[1]}" as fine; the server measured a failure.` }
  return { label: flag.replace(/_/g, ' '), kind: 'info', help: '' }
}

export const VERDICT_META = {
  pass: { label: 'Photo OK', tone: 'green' },
  warn: { label: 'Photo warning', tone: 'amber' },
  block: { label: 'Photo poor', tone: 'red' },
  unverified: { label: 'Unverified', tone: 'muted' },
}

// Feed filter: 'all' | 'any' (any photo issue) | 'unverified' | a specific flag id.
export const matchesPhoto = (r, f) =>
  f === 'all' ||
  (f === 'any' && ((r.quality_flags ?? []).length > 0 || r.photo_verdict === 'block')) ||
  (f === 'unverified' && r.photo_verdict === 'unverified') ||
  (r.quality_flags ?? []).includes(f)
