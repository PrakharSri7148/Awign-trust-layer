import { checkBlur } from './blur.js'
import { checkExposure } from './exposure.js'
import { checkGlare } from './glare.js'
import { checkNoise } from './noise.js'
import { checkObstruction } from './obstruction.js'
import { checkResolution } from './resolution.js'
import { checkShake } from './shake.js'

// id -> check function. The face check is registered in Phase 3.
// Order matters only where a check reads `ctx.results` (resolution reads blur).
export const CHECKS = {
  blur: checkBlur,
  resolution: checkResolution,
  exposure: checkExposure,
  obstruction: checkObstruction,
  glare: checkGlare,
  shake: checkShake,
  noise: checkNoise,
}
