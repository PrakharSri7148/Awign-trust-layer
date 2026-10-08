// FaceLandmarker output -> the sample the liveness state machine consumes. Pure.

export const blendshapeMap = (categories) => {
  const out = {}
  for (const c of categories ?? []) out[c.categoryName] = c.score
  return out
}

const mean = (a, b) => ((a ?? 0) + (b ?? 0)) / 2

// Head yaw in degrees from the 4x4 facial transformation matrix. POSITIVE = the user turned to THEIR left (the nose
// moves towards the right of the unmirrored camera image). Verified on real photos in headless Chrome (progress.md,
// Phase 7c): a photo whose face visibly points to the right of the image reads +46 degrees (Python: +46.0). The
// browser's `facialTransformationMatrixes[0].data` is COLUMN-major (reading it row-major gave -38 for that photo);
// Python's array is row-major. Pass rowMajor=true only for the Python layout.
export function yawFromMatrix(data, rowMajor = false) {
  if (!data || data.length < 16) return null
  const r20 = rowMajor ? data[8] : data[2]
  return (Math.asin(Math.max(-1, Math.min(1, -r20))) * 180) / Math.PI
}

// A cheap cross-check from the landmark geometry: where the nose tip sits between the two cheek landmarks, -1..1
// (positive = towards the right of the unmirrored image, like the matrix yaw). Used as evidence, not as the signal.
export function noseRatio(points) {
  if (!points?.[1] || !points[234] || !points[454]) return null
  const mid = (points[234].x + points[454].x) / 2
  const half = (points[454].x - points[234].x) / 2
  return half > 0 ? (points[1].x - mid) / half : null
}

export function toSample(t, { points, blendshapes, matrix, yawDeg } = {}) {
  const b = blendshapes ?? {}
  const yaw = yawDeg ?? yawFromMatrix(matrix) // yawDeg: only the dev-build test mock supplies it
  return {
    t,
    face: !!points,
    blink: mean(b.eyeBlinkLeft, b.eyeBlinkRight),
    smile: mean(b.mouthSmileLeft, b.mouthSmileRight),
    jaw: b.jawOpen ?? 0,
    yaw: yaw ?? 0,
  }
}
