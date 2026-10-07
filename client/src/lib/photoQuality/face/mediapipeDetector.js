// On-device face detector (MediaPipe BlazeFace short-range, ~230 KB model + a
// ~13 MB WASM runtime). Everything is served from our own origin and the photo
// never leaves the device for this. Loaded lazily, only for tasks that need a
// face, and cached in the HTTP cache after the first use.

// Lets the browser reuse one detector across photos.
let shared = null

export function mediapipeDetector({ base = '/mediapipe', minDetectionConfidence = 0.3 } = {}) {
  if (shared) return shared
  let loading = null
  const load = () =>
    (loading ??= (async () => {
      const { FilesetResolver, FaceDetector } = await import('@mediapipe/tasks-vision')
      const fileset = await FilesetResolver.forVisionTasks(base)
      return FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}/blaze_face_short_range.tflite`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence,
      })
    })().catch((err) => {
      loading = null // allow a retry (e.g. network came back)
      throw err
    }))

  shared = {
    // frame: { width, height, rgba } -> normalised detections (see facecheck.js)
    async detect(frame) {
      const det = await load()
      const res = det.detect(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height))
      return res.detections.map((d) => ({
        box: {
          x: d.boundingBox.originX / frame.width,
          y: d.boundingBox.originY / frame.height,
          w: d.boundingBox.width / frame.width,
          h: d.boundingBox.height / frame.height,
        },
        score: d.categories?.[0]?.score ?? 0,
        keypoints: (d.keypoints ?? []).map((k) => ({ x: k.x, y: k.y })),
      }))
    },
    // Start downloading the runtime before the user takes the photo.
    warmUp: () => load().then(() => true, () => false),
  }
  return shared
}
