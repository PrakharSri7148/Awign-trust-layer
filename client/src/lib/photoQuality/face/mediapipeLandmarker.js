// Face landmarks (478 points) for the face-mesh overlay. MediaPipe FaceLandmarker, served from our
// own origin like the detector (3.7 MB model + the same WASM runtime), loaded lazily and only
// for tasks that have a face. It only DRAWS; the face check is still done by the BlazeFace detector.
import { blendshapeMap } from './livenessSignals.js'

let shared = null

export function mediapipeLandmarker({ base = '/mediapipe' } = {}) {
  if (shared) return shared
  let loading = null
  const load = () =>
    (loading ??= (async () => {
      const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision')
      const fileset = await FilesetResolver.forVisionTasks(base)
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}/face_landmarker.task`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
        minFaceDetectionConfidence: 0.4,
        minFacePresenceConfidence: 0.4,
        // Liveness (Phase 7c): eye blink / smile / jaw blendshapes and the head-pose matrix. Same model, small extra cost.
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      })
    })().catch((err) => {
      loading = null
      throw err
    }))

  shared = {
    // frame: { width, height, rgba } -> the 478 landmarks of the main face as normalised {x, y}, or null
    async detect(frame) {
      return (await shared.detectFull(frame)).points
    },
    // Landmarks + blendshapes (name -> score) + the 4x4 head-pose matrix (column-major array, as MediaPipe JS delivers it), for liveness.
    // Dev builds only: window.__landmarkerMock(frame) -> { blendshapes?, matrix? } replaces the model's blendshapes/pose
    // so the end-to-end test can script a blink the fake camera cannot perform (the landmarks stay real). Never in production.
    async detectFull(frame) {
      const lm = await load()
      const res = lm.detect(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height))
      const pts = res.faceLandmarks?.[0]
      let out = {
        points: pts ? pts.map((p) => ({ x: p.x, y: p.y })) : null,
        blendshapes: blendshapeMap(res.faceBlendshapes?.[0]?.categories),
        matrix: res.facialTransformationMatrixes?.[0]?.data ? Array.from(res.facialTransformationMatrixes[0].data) : null,
      }
      if (import.meta.env?.DEV && typeof window !== 'undefined' && typeof window.__landmarkerMock === 'function') {
        const m = window.__landmarkerMock(frame)
        if (m) out = { ...out, ...m, mocked: true }
      }
      return out
    },
    warmUp: () => load().then(() => true, () => false),
  }
  return shared
}
