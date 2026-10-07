import { Camera, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { THRESHOLDS } from '../../lib/photoQuality/config.js'
import { evaluateFace } from '../../lib/photoQuality/face/facecheck.js'
import { frameSharpness, pickBest } from '../../lib/photoQuality/burst.js'
import { buildFrame, rgbaToGray } from '../../lib/photoQuality/frame.js'
import { LIVE_LABELS, LIVE_PRIORITY, analyzeLive, createReadyTracker } from '../../lib/photoQuality/live.js'
import { createMotionBuffer } from '../../lib/photoQuality/motionBuffer.js'
import { STATUS } from '../../lib/photoQuality/schema.js'
import { useContainFit } from './useContainFit.js'

const LIVE = THRESHOLDS.live
const TICK_MS = 200 // ~5 fps of live guidance
// Resolves when the video shows a NEW frame, so consecutive burst shots are really different
// frames (the camera delivers ~30/s; reading faster than that would just repeat one).
const nextVideoFrame = (video) =>
  new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback !== 'function') return setTimeout(resolve, 40)
    const guard = setTimeout(resolve, 150)
    video.requestVideoFrameCallback(() => {
      clearTimeout(guard)
      resolve()
    })
  })

// Draw `source` into a canvas no larger than `max` on its longer side and read the pixels.
function readSmall(source, sw, sh, max, canvas) {
  const scale = Math.min(1, max / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, w, h)
  return { rgba: ctx.getImageData(0, 0, w, h).data, width: w, height: h }
}

export const cameraSupported = () =>
  typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia

// An in-app viewfinder: live guidance while framing, then a burst on the shutter
// that keeps the sharpest frame (and how steady the phone was when it was taken).
export default function LiveCamera({ task, detector, autoStart = false, onCapture, onUnavailable }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const bufRef = useRef(null)
  const small = useRef(null)
  const attempt = useRef(0)
  const faceBusy = useRef(false)
  const lastFace = useRef(null)
  const tickN = useRef(0)
  const ready = useRef(createReadyTracker())

  const [state, setState] = useState('idle') // idle | starting | live
  const [hud, setHud] = useState(null)
  const [isReady, setIsReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dims, setDims] = useState(null)
  const [wrap, fit] = useContainFit(dims?.w, dims?.h)
  const mirrored = task.camera === 'user'
  const needsFace = task.face !== 'off'

  // Every start gets an id; if the component unmounts or starts again meanwhile (React
  // StrictMode runs effects twice in development), the older attempt must quietly stand
  // down instead of reporting "camera unavailable" because ITS play() was interrupted.
  async function start() {
    if (state !== 'idle') return
    const id = ++attempt.current
    setState('starting')
    // iOS only grants motion access from inside a tap, so ask before any other await.
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        await DeviceMotionEvent.requestPermission()
      }
    } catch {
      /* denied: steadiness just won't be measured */
    }
    bufRef.current ??= createMotionBuffer()
    bufRef.current.start()
    let stream = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: task.camera }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      })
      if (id !== attempt.current) return stream.getTracks().forEach((t) => t.stop()) // superseded
      streamRef.current = stream
      const v = videoRef.current
      v.srcObject = stream
      await v.play()
      if (id !== attempt.current) return
      setDims({ w: v.videoWidth, h: v.videoHeight })
      setState('live')
    } catch (err) {
      if (id !== attempt.current) return
      console.warn('[camera] could not start:', err)
      stop()
      setState('idle')
      onUnavailable?.(err?.name === 'NotAllowedError' ? 'denied' : 'unsupported')
    }
  }

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    bufRef.current?.stop()
  }

  useEffect(() => {
    if (autoStart) start()
    return () => {
      attempt.current++ // cancels any start still in flight
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live guidance loop.
  useEffect(() => {
    if (state !== 'live') return
    small.current ??= document.createElement('canvas')
    const id = setInterval(() => {
      const v = videoRef.current
      if (!v || v.readyState < 2 || busy) return
      const px = readSmall(v, v.videoWidth, v.videoHeight, LIVE.size, small.current)
      const frame = buildFrame(px)

      // The face detector is heavier than the pixel checks: run it every Nth tick, without queueing.
      if (needsFace && detector && !faceBusy.current && tickN.current++ % LIVE.faceEvery === 0) {
        faceBusy.current = true
        detector
          .detect(frame)
          .then((faces) => (lastFace.current = evaluateFace(faces, frame)))
          .catch(() => (lastFace.current = null))
          .finally(() => (faceBusy.current = false))
      }

      const summary = analyzeLive(frame, { motion: bufRef.current?.recent(LIVE.motionWindowMs) ?? null, face: lastFace.current })
      setHud(summary)
      setIsReady(ready.current(summary))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [state, busy, needsFace, detector])

  async function capture() {
    const v = videoRef.current
    if (!v || busy) return
    setBusy(true)
    const { frames, scoreSize } = LIVE.burst
    const buf = bufRef.current
    const canvas = document.createElement('canvas')
    const shots = []
    try {
      for (let i = 0; i < frames; i++) {
        if (i) await nextVideoFrame(v)
        const t = performance.now()
        const bmp = await createImageBitmap(v) // full-resolution frame
        const px = readSmall(bmp, bmp.width, bmp.height, scoreSize, canvas)
        const sharpness = frameSharpness(rgbaToGray(px.rgba, px.width * px.height), px.width, px.height, scoreSize)
        shots.push({ bmp, t, sharpness, motion: buf ? buf.window(t - 150, t + 50) : null })
      }
      const best = pickBest(shots)
      console.debug('[burst]', JSON.stringify({ frames: shots.map((x) => ({ t: Math.round(x.t - shots[0].t), s: Number(x.sharpness.toFixed(3)) })), picked: best.index }))
      const full = document.createElement('canvas')
      full.width = best.bmp.width
      full.height = best.bmp.height
      full.getContext('2d').drawImage(best.bmp, 0, 0)
      const blob = await new Promise((r) => full.toBlob(r, 'image/jpeg', 0.95))
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })
      onCapture(file, {
        source: 'camera',
        // The sensor window around the picked frame is what the shake check judges.
        sensor: buf ? buf.window(best.t - 700, best.t + 100) : null,
        burst: { frames: shots.length, picked: best.index, sharpness: shots.map((s) => Number(s.sharpness.toFixed(3))) },
      })
    } finally {
      shots.forEach((s) => s.bmp.close?.())
      setBusy(false)
    }
  }

  const chips = hud ? LIVE_PRIORITY.filter((id) => hud.checks[id]) : []
  const face = hud?.checks.face
  const box = face?.box
  const faceBox = box && fit ? { left: fit.x + (mirrored ? 1 - box.x - box.w : box.x) * fit.w, top: fit.y + box.y * fit.h, width: box.w * fit.w, height: box.h * fit.h } : null

  return (
    <div className="live" ref={wrap}>
      <video ref={videoRef} playsInline muted className={`live__video${mirrored ? ' live__video--mirror' : ''}`} aria-label="Camera preview" />

      {state !== 'live' && (
        <button type="button" className="live__start" onClick={start} disabled={state === 'starting'}>
          {state === 'starting' ? <Loader2 size={28} className="spin" /> : <Camera size={28} />}
          <strong>{state === 'starting' ? 'Opening camera…' : 'Tap to open camera'}</strong>
          <span className="eyebrow">{task.camera === 'user' ? 'Front camera' : 'Rear camera'} · live guidance</span>
        </button>
      )}

      {state === 'live' && (
        <>
          {faceBox && <div className={`ovl ovl--${face.status === STATUS.PASS ? 'ok' : face.status === STATUS.FAIL ? 'bad' : 'warn'}`} style={faceBox}><span>face</span></div>}
          <div className="live__chips" aria-label="Live checks">
            {chips.map((id) => (
              <span key={id} className={`live__chip live__chip--${hud.checks[id].status}`} data-check={id}>{LIVE_LABELS[id]}</span>
            ))}
          </div>
          <div className={`live__hint${isReady ? ' live__hint--ready' : ''}`} role="status">
            {busy ? 'Hold still…' : isReady ? 'Looks good. Tap to capture.' : hud?.hint ?? 'Frame your photo.'}
          </div>
          <button type="button" className={`live__shutter${isReady ? ' live__shutter--ready' : ''}`} onClick={capture} disabled={busy} aria-label="Take photo">
            {busy ? <Loader2 size={26} className="spin" /> : <i />}
          </button>
        </>
      )}
    </div>
  )
}
