// Back-compat shim. The validator now lives in ./photoQuality/ (one pure check
// per issue); this keeps the original sharpness API that Capture.jsx and the
// first test file use.
import { laplacianVariance } from './photoQuality/checks/blur.js'
import { runPhotoQuality } from './photoQuality/index.js'

export { laplacianVariance }
// Legacy Laplacian-variance threshold. The engine itself no longer uses it.
export const SHARPNESS_THRESHOLD = 50
export const MAX_DIMENSION = 300

// Legacy shape plus the full report under `report`.
export async function checkPhotoQuality(imageFile, opts) {
  const report = await runPhotoQuality(imageFile, opts)
  const blur = report.checks.blur
  return { isSharp: blur.status !== 'fail', sharpnessScore: blur.value ?? 0, report }
}
