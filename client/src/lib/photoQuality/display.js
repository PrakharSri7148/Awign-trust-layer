// How quality numbers are written, shared by the live HUD and the post-capture checklist so
// "Focus 78%" means the same thing in both places.
import { THRESHOLDS } from './config.js'
import { ramp } from './schema.js'

export const pct0 = (x) => `${Math.round(x)}%`

// Live focus: the coarse blur score (0.05 = hopeless, `focusFull` = a sharp frame) as 0..1.
// A relative score, not a physical unit. See edge-validator/iteration-2.md §2.1.
export const focusScore = (blurScore, full = THRESHOLDS.live.hud.focusFull) => ramp(blurScore, 0.05, full)

export const fmtSigma = (s) => `σ ${s.toFixed(1)}`
export const fmtMotion = (p) => `motion ${p.toFixed(1)}%`
export const fmtRot = (r) => `${Math.round(r)}°/s`
export const fmtArea = (a) => `${(a * 100).toFixed(a < 0.1 ? 1 : 0)}%`
export const fmtSize = (w, h) => `${w}×${h}`
export const fmtFace = (conf, heightFrac) => `${Math.round(conf * 100)}% · ${Math.round(heightFrac * 100)}%`
export const fmtQuality = (score) => `${Math.round(score * 100)}%`

// Lens: nothing in the way / a part of the frame covered / the whole lens covered.
export function lensText(area, fullCover, t = THRESHOLDS.obstruction) {
  if (fullCover || area >= t.failArea) return 'covered'
  if (area >= t.warnArea) return `partly ${Math.round(area * 100)}%`
  return 'clear'
}
