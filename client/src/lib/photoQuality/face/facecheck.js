import { THRESHOLDS } from '../config.js'
import { STATUS, checkResult, ramp, skipped } from '../schema.js'
import { blurMetrics } from '../checks/blur.js'
import { exposureMetrics } from '../checks/exposure.js'

// A detection, normalised to the frame (0..1, may slightly overflow it):
//   { box: { x, y, w, h }, score, keypoints: [rightEye, leftEye, nose, mouth, rightEar, leftEar] }
// (BlazeFace order; "right/left" are the subject's, so right eye is on image-left.)

const area = (b) => Math.max(0, b.w) * Math.max(0, b.h)
const visibleFraction = (b) => {
  const w = Math.min(1, b.x + b.w) - Math.max(0, b.x)
  const h = Math.min(1, b.y + b.h) - Math.max(0, b.y)
  return area(b) ? (Math.max(0, w) * Math.max(0, h)) / area(b) : 0
}
const RANK = { [STATUS.PASS]: 0, [STATUS.WARN]: 1, [STATUS.FAIL]: 2 }

// Pure: detections + frame -> a check result. The detector is injected (see
// checkFace), so the geometry and policy here are tested with scripted faces.
export function evaluateFace(faces, frame, cfg = THRESHOLDS.face) {
  if (!faces.length) {
    return checkResult('face', {
      status: STATUS.FAIL,
      score: 0,
      value: 0,
      hint: 'No face found. Move closer, face the camera with your whole face in frame, and use good light.',
      details: { count: 0 },
    })
  }

  // The most confident detection is the face; the biggest box can be a spurious one.
  const sorted = [...faces].sort((a, b) => b.score - a.score || area(b.box) - area(a.box))
  const main = sorted[0]
  const b = main.box
  const W = frame.width
  const H = frame.height
  const problems = [] // { k: kind, s: status, hint }

  // Detector confidence: low when the face is covered, in shadow or heavily turned.
  if (main.score < cfg.minScoreFail) {
    problems.push({ k: 'score', s: STATUS.FAIL, hint: 'No clear face found. Remove anything covering your face, improve the light and face the camera.' })
  } else if (main.score < cfg.minScoreWarn) {
    problems.push({ k: 'score', s: STATUS.WARN, hint: 'Your face is only partly clear. Improve the light and face the camera.' })
  }

  // Cut off by the frame edge.
  const visible = visibleFraction(b)
  const kp = main.keypoints ?? []
  const [eyeR, eyeL, nose] = kp
  const inside = (p) => p && p.x >= cfg.edgeMargin && p.x <= 1 - cfg.edgeMargin && p.y >= cfg.edgeMargin && p.y <= 1 - cfg.edgeMargin
  const eyesInside = inside(eyeR) && inside(eyeL)
  if (visible < cfg.visibleFail || (kp.length >= 2 && !eyesInside)) {
    problems.push({ k: 'cut', s: STATUS.FAIL, hint: 'Your face is cut off by the edge of the photo. Move back or re-centre so the whole face is in frame.' })
  } else if (visible < cfg.visibleWarn) {
    problems.push({ k: 'cut', s: STATUS.WARN, hint: 'Part of your face touches the edge of the photo. Re-centre yourself.' })
  }

  // Too small / far away.
  if (b.h < cfg.minHeightFail) {
    problems.push({ k: 'size', s: STATUS.FAIL, hint: 'Your face is too small in the photo. Move closer to the camera.' })
  } else if (b.h < cfg.minHeightWarn) {
    problems.push({ k: 'size', s: STATUS.WARN, hint: 'Your face is quite small in the photo. Move a little closer.' })
  }

  // Pose, from the eye/nose keypoints (pixel space, so a non-square frame doesn't skew angles).
  // Pose, eyes and face-crop quality are only judged when the detection is reliable:
  // the keypoints of a low-confidence box are noise (measured: yaw 2.85 on a cut-off face).
  const reliable = main.score >= cfg.minScoreFail
  let yaw = null
  let roll = null
  if (reliable && eyeR && eyeL && nose) {
    const dx = (eyeL.x - eyeR.x) * W
    const dy = (eyeL.y - eyeR.y) * H
    const eyeDist = Math.hypot(dx, dy)
    if (eyeDist > 0) {
      yaw = ((nose.x - (eyeR.x + eyeL.x) / 2) * W) / eyeDist
      roll = (Math.atan2(dy, dx) * 180) / Math.PI
    }
  }
  if (yaw != null && Math.abs(yaw) >= cfg.yawFail) {
    problems.push({ k: 'pose', s: STATUS.FAIL, hint: 'You are looking away from the camera. Face the camera directly.' })
  } else if (yaw != null && Math.abs(yaw) >= cfg.yawWarn) {
    problems.push({ k: 'pose', s: STATUS.WARN, hint: 'Your head is turned. Face the camera directly.' })
  }
  if (roll != null && Math.abs(roll) >= cfg.rollWarn) {
    problems.push({ k: 'pose', s: STATUS.WARN, hint: 'Your head is tilted. Hold the phone level.' })
  }

  // Is the FACE itself sharp and evenly lit? (The whole-photo checks can pass while the face is blurred or in shadow.)
  // Sharpness is judged on the face plus a margin (hair, jaw and ears give edges to
  // measure; bare skin has almost none); lighting on the inner face only, so bright
  // background around a dark face cannot hide the shadow.
  const crop = reliable ? faceCrop(frame, b, cfg, cfg.cropPad) : null
  const inner = reliable ? faceCrop(frame, b, cfg, -cfg.innerShrink) : null
  let cropInfo = null
  if (crop) {
    const blur = blurMetrics(crop.gray, crop.width, crop.height, { grid: 1, minTileRange: 12, minTexturedTiles: 1 }).score
    const exp = exposureMetrics((inner ?? crop).gray)
    cropInfo = { blur, mean: exp.mean, clippedFrac: exp.clippedFrac }
    if (blur != null && blur < cfg.cropBlurFail) problems.push({ k: 'quality', s: STATUS.FAIL, hint: 'Your face is blurry. Hold steady and let the camera focus on your face.' })
    else if (blur != null && blur < cfg.cropBlurWarn) problems.push({ k: 'quality', s: STATUS.WARN, hint: 'Your face is a little soft. Hold steady.' })
    if (exp.mean < cfg.cropDarkMeanFail) problems.push({ k: 'quality', s: STATUS.FAIL, hint: 'Your face is in shadow. Face the light.' })
    else if (exp.mean < cfg.cropDarkMeanWarn) problems.push({ k: 'quality', s: STATUS.WARN, hint: 'Your face is a bit dark. Face the light.' })
    if (exp.clippedFrac > cfg.cropClippedWarn) problems.push({ k: 'quality', s: STATUS.WARN, hint: 'Your face is washed out by bright light. Move out of direct glare.' })
  }

  // Eyes hidden (sunglasses, a hand, a cap pulled down): the detector still "finds"
  // the eyes from the face shape, so look at the pixels there.
  if (eyeR && eyeL && crop) {
    const cropMean = cropInfo.mean
    const r = Math.max(2, Math.round(cfg.eyePatch * Math.hypot((eyeL.x - eyeR.x) * W, (eyeL.y - eyeR.y) * H)))
    const patchMean = (k) => {
      let s = 0
      let n = 0
      const cx = Math.round(k.x * W)
      const cy = Math.round(k.y * H)
      for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) {
        for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
          s += frame.gray[y * W + x]
          n++
        }
      }
      return n ? s / n : cropMean
    }
    const eyeMean = (patchMean(eyeR) + patchMean(eyeL)) / 2
    cropInfo.eyeRatio = cropMean > 0 ? eyeMean / cropMean : 1
    if (cropInfo.eyeRatio < cfg.eyeDarkRatio) {
      problems.push({ k: 'eyes', s: STATUS.WARN, hint: 'Your eyes look covered. Take off sunglasses or anything hiding your eyes.' })
    }
  }

  // More than one person in frame (only count confident detections).
  const others = sorted.slice(1).filter((f) => f.score >= cfg.minScoreFail && area(f.box) >= cfg.multiRatio * area(b))
  if (others.length) problems.push({ k: 'multi', s: STATUS.WARN, hint: 'More than one face is in the photo. Make sure only you are in frame.' })

  // The hint shown is the worst problem, and among equals the most specific cause
  // (a half-cut face also has a low confidence; "cut off" is the useful message).
  const order = ['cut', 'size', 'pose', 'eyes', 'quality', 'score', 'multi']
  problems.sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k))
  const status = problems.reduce((w, p) => (RANK[p.s] > RANK[w] ? p.s : w), STATUS.PASS)
  const first = problems.find((p) => p.s === status)
  const score = Math.min(
    ramp(main.score, cfg.minScoreFail - 0.2, cfg.minScoreWarn + 0.2),
    ramp(b.h, cfg.minHeightFail * 0.5, cfg.minHeightWarn + 0.1),
    ramp(visible, cfg.visibleFail - 0.2, 1),
    yaw == null ? 1 : ramp(Math.abs(yaw), cfg.yawFail + 0.3, 0.1),
  )
  return checkResult('face', {
    status,
    score,
    value: b.h,
    hint: first?.hint ?? null,
    details: {
      count: faces.length,
      score: main.score,
      heightFrac: b.h,
      visibleFrac: visible,
      eyesInside,
      yaw,
      roll,
      crop: cropInfo,
      box: { x: b.x, y: b.y, w: b.w, h: b.h },
      problems: problems.map((p) => `${p.s}: ${p.hint}`),
    },
  })
}

// pad > 0 grows the face box by that share of its size on every side, pad < 0 shrinks it.
function faceCrop(frame, b, cfg, pad) {
  const W = frame.width
  const H = frame.height
  const x0 = Math.max(0, Math.floor((b.x - pad * b.w) * W))
  const y0 = Math.max(0, Math.floor((b.y - pad * b.h) * H))
  const x1 = Math.min(W, Math.ceil((b.x + b.w * (1 + pad)) * W))
  const y1 = Math.min(H, Math.ceil((b.y + b.h * (1 + pad)) * H))
  const w = x1 - x0
  const h = y1 - y0
  if (w <= 0 || h <= 0 || Math.min(w, h) < cfg.cropMinSide) return null
  const gray = new Float32Array(w * h)
  for (let y = 0; y < h; y++) gray.set(frame.gray.subarray((y0 + y) * W + x0, (y0 + y) * W + x0 + w), y * w)
  return { gray, width: w, height: h }
}

// Async: run the injected detector, then evaluate. `detector.detect(frame)` must
// resolve to normalised detections. Any detector failure (model could not load
// offline, WASM unsupported) is reported as a non-blocking warning: a worker
// without network must not be stranded, and the server re-checks anyway.
export async function checkFace(frame, { task, detector } = {}) {
  if (!task || task.face === 'off') return skipped('face', 'task_does_not_need_a_face')
  if (!detector) return unchecked('no_detector')
  let faces
  try {
    faces = await detector.detect(frame)
  } catch (err) {
    return unchecked(String(err?.message ?? err))
  }
  return evaluateFace(faces, frame)
}

const unchecked = (reason) =>
  checkResult('face', {
    status: STATUS.WARN,
    score: 0.5,
    value: null,
    hint: "Couldn't check your face on this device. The photo will be reviewed.",
    details: { unchecked: true, reason },
  })
