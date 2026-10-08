// The face-analysis mesh drawn over a face: a SPARSE set of key points (not all 478 landmarks)
// joined into a triangulated net, like a face-recognition diagram. Indices are MediaPipe
// FaceLandmarker / FaceMesh canonical landmark numbers.
// Names say which side of the PERSON (r = the person's right = image left).
export const MESH_POINTS = {
  forehead: 10,
  rBrowOuter: 70, rBrowMid: 105, rBrowInner: 107,
  lBrowInner: 336, lBrowMid: 334, lBrowOuter: 300,
  rEyeOuter: 33, rEyeInner: 133,
  lEyeInner: 362, lEyeOuter: 263,
  noseBridge: 168, noseTip: 1, rNostril: 98, lNostril: 327,
  rFaceEdge: 234, lFaceEdge: 454,
  rCheek: 205, lCheek: 425,
  rJawUpper: 58, lJawUpper: 288,
  rMouth: 61, lMouth: 291, upperLip: 0, lowerLip: 17,
  rJaw: 172, lJaw: 397, chin: 152,
}

export const MESH_NAMES = Object.keys(MESH_POINTS)
export const MESH_INDICES = MESH_NAMES.map((n) => MESH_POINTS[n])

// Lines between points (by name).
export const MESH_EDGES = [
  // brows and forehead
  ['forehead', 'rBrowMid'], ['forehead', 'lBrowMid'],
  ['rBrowOuter', 'rBrowMid'], ['rBrowMid', 'rBrowInner'],
  ['lBrowInner', 'lBrowMid'], ['lBrowMid', 'lBrowOuter'],
  ['rBrowInner', 'noseBridge'], ['lBrowInner', 'noseBridge'],
  ['rBrowOuter', 'rFaceEdge'], ['lBrowOuter', 'lFaceEdge'],
  // eyes
  ['rEyeOuter', 'rEyeInner'], ['lEyeInner', 'lEyeOuter'],
  ['rBrowInner', 'rEyeInner'], ['lBrowInner', 'lEyeInner'],
  ['rBrowOuter', 'rEyeOuter'], ['lBrowOuter', 'lEyeOuter'],
  ['rEyeInner', 'noseBridge'], ['lEyeInner', 'noseBridge'],
  ['rFaceEdge', 'rEyeOuter'], ['lFaceEdge', 'lEyeOuter'],
  // nose
  ['noseBridge', 'noseTip'], ['noseTip', 'rNostril'], ['noseTip', 'lNostril'],
  ['rEyeInner', 'rCheek'], ['lEyeInner', 'lCheek'],
  ['rCheek', 'rNostril'], ['lCheek', 'lNostril'],
  // cheeks and jaw line
  ['rFaceEdge', 'rCheek'], ['lFaceEdge', 'lCheek'],
  ['rCheek', 'rJawUpper'], ['lCheek', 'lJawUpper'],
  ['rJawUpper', 'rJaw'], ['lJawUpper', 'lJaw'],
  ['rJaw', 'chin'], ['lJaw', 'chin'],
  // mouth
  ['rNostril', 'rMouth'], ['lNostril', 'lMouth'],
  ['noseTip', 'upperLip'], ['upperLip', 'rMouth'], ['upperLip', 'lMouth'],
  ['rMouth', 'lowerLip'], ['lMouth', 'lowerLip'],
  ['lowerLip', 'chin'],
  ['rMouth', 'rJaw'], ['lMouth', 'lJaw'],
]

const idx = Object.fromEntries(MESH_NAMES.map((n, i) => [n, i]))
// Same edges as index pairs into the points array.
export const MESH_EDGE_INDEX = MESH_EDGES.map(([a, b]) => [idx[a], idx[b]])

// All 478 landmarks -> just the mesh points (normalised {x, y} of the frame), or null.
export function selectMeshPoints(landmarks) {
  if (!landmarks || landmarks.length < 468) return null
  return MESH_INDICES.map((i) => ({ x: landmarks[i].x, y: landmarks[i].y }))
}

// Normalised points -> pixels in a box, mirrored for the front camera (the preview is mirrored).
export function projectPoints(points, width, height, mirrored = false) {
  return points.map((p) => [(mirrored ? 1 - p.x : p.x) * width, p.y * height])
}

// Move `cur` a fraction `a` of the way to `target` (landmarks arrive ~8x a second, the screen
// redraws 60x: this is what makes the dots glide instead of hop). Starts AT the target.
export function lerpPoints(cur, target, a) {
  if (!target) return null
  if (!cur || cur.length !== target.length) return target.map((p) => ({ ...p }))
  return cur.map((p, i) => ({ x: p.x + (target[i].x - p.x) * a, y: p.y + (target[i].y - p.y) * a }))
}
