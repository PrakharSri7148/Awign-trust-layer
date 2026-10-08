// Rolling aggregation of the live passive signals over a camera session. Pure and small: the camera feeds it one
// reading per tick (and a landmark set every landmarker sample) and asks for the robust summary at capture time.
// Medians over the last readings, so one odd frame cannot raise (or hide) a flag.
import { THRESHOLDS } from '../config.js'
import { planarity } from './planarity.js'

const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

export function createPassiveSession({ keep = 12, cfg = THRESHOLDS.passive.planarity } = {}) {
  let series = {}
  let ring = [] // { t, pts: [[x, y], ...] }
  let verdicts = []

  const push = (k, v) => {
    if (v == null) return
    ;(series[k] ??= []).push(v)
    if (series[k].length > keep) series[k].shift()
  }

  return {
    // summary: the `passive` object analyzeLive returns each tick
    addTick(summary) {
      if (!summary) return
      push('moire', summary.moire?.score)
      push('bezel', summary.bezel?.score)
      push('banding', summary.banding?.score)
      push('glare', summary.glareFace?.overlap)
    },
    // pts: [{x, y}] normalised (the curated mesh points); t: ms
    addLandmarks(t, pts) {
      if (!pts) { ring = []; return null }
      ring.push({ t, pts: pts.map((p) => [p.x, p.y]) })
      while (ring.length && t - ring[0].t > cfg.windowMs * 1.5) ring.shift()
      const a = ring.find((r) => t - r.t <= cfg.windowMs) ?? ring[0]
      const b = ring[ring.length - 1]
      if (!a || a === b || b.t - a.t < cfg.windowMs * 0.5) return null
      const xs = b.pts.map((p) => p[0])
      const width = Math.max(...xs) - Math.min(...xs)
      const r = planarity(a.pts, b.pts, width, cfg)
      if (r.planar != null) { verdicts.push(r.planar); if (verdicts.length > 8) verdicts.shift() }
      return r
    },
    summary() {
      const m = (k) => median(series[k] ?? [])
      const falses = verdicts.filter((v) => v === false).length
      const trues = verdicts.filter((v) => v === true).length
      return {
        moire: { score: m('moire') },
        bezel: { score: m('bezel') },
        banding: { score: m('banding') },
        glareFace: m('glare') == null ? null : { overlap: m('glare') },
        // organic (3-D) motion seen even once beats "flat" readings: a person who only slid sideways looks flat
        planar: { planar: falses > 0 ? false : trues >= 2 ? true : null, windows: verdicts.length },
      }
    },
    reset() {
      series = {}
      ring = []
      verdicts = []
    },
  }
}
