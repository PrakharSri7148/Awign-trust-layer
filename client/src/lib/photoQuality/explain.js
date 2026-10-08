// "Why was my photo refused?" in plain words: for every check that is not a pass, which
// check it was, the number that was measured, and the line it was judged against.
// Pure (report -> list), shared by the checklist, the ?debug=checks panel and the tests.
//
//   explainReport(report) -> [{ id, label, status, blocking, text, numbers }]
//     text    one sentence a worker can act on
//     numbers "measured vs needed", e.g. "Focus 19% — needs at least 31%"
//
// Blocking items come first. Focus is written in the same "Focus NN%" the camera shows
// (see display.js), so the number on the screen is the number in the message.
import { THRESHOLDS } from './config.js'
import { focusScore, fmtSize, pct0 } from './display.js'
import { CHECK_LABELS, STATUS } from './schema.js'

const pct = (x) => `${Math.round(x * 100)}%`
const f2 = (x) => Number(x).toFixed(2)
const f3 = (x) => Number(x).toFixed(3)
const focusPct = (score) => pct0(focusScore(score) * 100)

// face sub-problem -> how to write its number and its limit
const FACE_NUMBERS = {
  confidence: (v, l) => `face confidence ${pct(v)} — needs at least ${pct(l)}`,
  visible: (v, l) => `${pct(v)} of the face visible — needs at least ${pct(l)}`,
  eyesInside: () => 'an eye is outside the frame',
  height: (v, l) => `face is ${pct(v)} of the frame height — needs at least ${pct(l)}`,
  yaw: (v, l) => `head turn ${f2(v)} — must stay under ${f2(l)}`,
  roll: (v, l) => `head tilt ${Math.round(v)}° — must stay under ${Math.round(l)}°`,
  cropBlur: (v, l) => `face sharpness ${f3(v)} — needs at least ${f3(l)}`,
  cropMean: (v, l) => `face brightness ${Math.round(v)}/255 — needs at least ${Math.round(l)}`,
  cropClipped: (v, l) => `${pct(v)} of the face is blown out — must stay under ${pct(l)}`,
  eyeRatio: (v, l) => `eyes are ${pct(v)} as bright as the face — needs at least ${pct(l)}`,
}

function numbersFor(id, c, t = THRESHOLDS) {
  const d = c.details ?? {}
  switch (id) {
    case 'blur': {
      if (c.value == null) return null
      const limit = c.status === STATUS.FAIL ? t.blur.failBelow : t.blur.warnBelow
      return `Focus ${focusPct(c.value)} — needs at least ${focusPct(limit)}`
    }
    case 'face': {
      if (d.unchecked) return null
      const r = (d.reasons ?? []).find((x) => x.status === c.status && x.metric)
      return r && r.value != null && FACE_NUMBERS[r.metric] ? FACE_NUMBERS[r.metric](r.value, r.limit) : null
    }
    case 'exposure': {
      if (c.value == null) return null
      const mean = `Brightness ${pct0((c.value / 255) * 100)}`
      if (d.kind === 'dark') return `${mean} — needs at least ${pct0((t.exposure.darkMeanFail / 255) * 100)}`
      if (d.kind === 'over') return `${mean} — must stay under ${pct0((t.exposure.overMeanFail / 255) * 100)}`
      return mean
    }
    case 'resolution':
      return d.width ? `${fmtSize(d.width, d.height)} — needs at least ${t.resolution.failShortSide} px on the short side` : null
    case 'obstruction':
      return c.value == null ? null : `${pct(c.value)} of the frame covered — must stay under ${pct(t.obstruction.failArea)}`
    case 'glare':
      return c.value == null ? null : `${pct(c.value)} of the frame blown out`
    default:
      return null
  }
}

export function explainReport(report, { thresholds = THRESHOLDS } = {}) {
  const blocking = new Set((report.issues ?? []).filter((i) => i.blocking).map((i) => i.id))
  return (report.issues ?? []).map((i) => {
    const c = report.checks[i.id]
    return {
      id: i.id,
      label: CHECK_LABELS[i.id] ?? i.id,
      status: i.status,
      blocking: blocking.has(i.id),
      text: c?.hint ?? '',
      numbers: c ? numbersFor(i.id, c, thresholds) : null,
    }
  })
}
