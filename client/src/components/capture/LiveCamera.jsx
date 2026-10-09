import { Camera, Check, CircleX, Loader2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { THRESHOLDS } from '../../lib/photoQuality/config.js'
import { analyzeLiveInWorker } from '../../lib/photoQuality/client.js'
import { evaluateFace } from '../../lib/photoQuality/face/facecheck.js'
import { frameSharpness, pickBest } from '../../lib/photoQuality/burst.js'
import { buildFrame, rgbaToGray } from '../../lib/photoQuality/frame.js'
import { LIVE_LABELS, LIVE_PRIORITY, createReadyTracker } from '../../lib/photoQuality/live.js'
import { createMotionBuffer } from '../../lib/photoQuality/motionBuffer.js'
import { STATUS } from '../../lib/photoQuality/schema.js'
import FaceMesh from './FaceMesh.jsx'
import { mediapipeLandmarker } from '../../lib/photoQuality/face/mediapipeLandmarker.js'
import { selectMeshPoints } from '../../lib/photoQuality/face/meshGraph.js'
import { createLivenessSession } from '../../lib/photoQuality/face/liveness.js'
import { toSample } from '../../lib/photoQuality/face/livenessSignals.js'
import { createPassiveSession } from '../../lib/photoQuality/passive/session.js'
import { combinePassive } from '../../lib/photoQuality/checks/liveness.js'
import LivenessOverlay from './LivenessOverlay.jsx'
import LiveHud, { hudRaw, useHudMode } from './LiveHud.jsx'
import { initialHudState } from '../../lib/photoQuality/liveMetrics.js'
import { fetchLivenessChallenge } from '../../lib/api.js'
import { useContainFit } from './useContainFit.js'
import { useLayoutMode } from './useLayoutMode.js'

const LIVE = THRESHOLDS.live
const HUD = LIVE.hud
const OFFLINE_RETRY_MS = 4000
const LIVENESS = THRESHOLDS.liveness
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

// A centre crop at the camera's NATIVE resolution (noise is only visible there). Own canvas,
// created once. The gray array is NEW each read on purpose: it is transferred to the worker, which
// detaches it, so reusing it would make the next transfer throw (and freeze the noise reading).
function createCropReader() {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  return (video) => {
    const size = Math.min(HUD.nativeCrop, video.videoWidth, video.videoHeight)
    if (size < 16) return null
    if (canvas.width !== size) {
      canvas.width = size
      canvas.height = size
    }
    const gray = new Float32Array(size * size)
    ctx.drawImage(video, Math.floor((video.videoWidth - size) / 2), Math.floor((video.videoHeight - size) / 2), size, size, 0, 0, size, size)
    const d = ctx.getImageData(0, 0, size, size).data
    for (let i = 0, p = 0; p < gray.length; i += 4, p++) gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    return { gray, width: size, height: size }
  }
}

// The HUD's Liveness row from the session state (plain data: it travels to the worker with the tick).
function livenessRow(st, passive = null) {
  if (!st || !st.snapshot) return { display: 'waiting for face', score: null, pct: 0, reason: 'Position your face in the frame' }
  const snap = st.snapshot
  const spoofy = passive?.status === 'warn' || passive?.status === 'fail'
  if (st.valid) return spoofy ? { display: 'passed · screen?', status: 'warn', score: 0.5, pct: 50, reason: 'The picture looks like it may show a screen or a print' } : { display: 'passed', status: 'pass', score: 1, pct: 100, reason: null }
  if (st.reviewRequested) return { display: 'review', status: 'warn', score: 0.3, pct: 30, reason: 'The live check could not be completed' }
  if (snap.phase === 'running') return { display: `${snap.current.label} ${Math.ceil(snap.current.remainingMs / 1000)}s`, score: null, pct: 0, reason: snap.current.prompt }
  if (snap.phase === 'failed') return { display: 'failed', status: 'fail', score: 0, pct: 0, reason: snap.reason }
  return { display: 'expired', status: 'warn', score: 0.3, pct: 30, reason: 'Do the live check again' }
}

export const cameraSupported = () =>
  typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia

// An in-app viewfinder: live guidance while framing, then a burst on the shutter
// that keeps the sharpest frame (and how steady the phone was when it was taken).
export default function LiveCamera({ task, taskId = null, workerId = null, detector, autoStart = false, onCapture, onUnavailable, onUsePicker }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const bufRef = useRef(null)
  const small = useRef(null)
  const attempt = useRef(0)
  const faceBusy = useRef(false)
  const lastFace = useRef(null)
  const tickN = useRef(0)
  const hudState = useRef(initialHudState())
  const faceSeq = useRef(0)
  const cropReader = useRef(null)
  const hudTick = useRef(0)
  const tickBusy = useRef(false)
  const meshTarget = useRef(null)
  const accentRef = useRef(false)
  const passiveRef = useRef(null)
  const sessionRef = useRef(null)
  const faceSince = useRef(null)
  const challengePending = useRef(false)
  const liveKey = useRef('')
  const raw = hudRaw()
  const ready = useRef(createReadyTracker())

  const [state, setState] = useState('idle') // idle | starting | live
  const [hud, setHud] = useState(null)
  const [isReady, setIsReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dims, setDims] = useState(null)
  const layout = useLayoutMode()
  const [wrap, fit] = useContainFit(dims?.w, dims?.h, layout === 'overlay' ? 'cover' : 'contain')
  const mirrored = task.camera === 'user'
  const needsFace = task.face !== 'off'
  // Active liveness (a random blink / turn / smile / mouth challenge) only for tasks that REQUIRE a face.
  const needsLive = task.face === 'required'
  const [live, setLive] = useState(null)
  const [offline, setOffline] = useState(false) // the server could not be reached for the challenge
  const [hudMode, toggleHud] = useHudMode(layout)

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

  // The immersive camera's close button: stop the stream and go back to the idle "tap to open" state.
  function closeCamera() {
    attempt.current++
    stop()
    setHud(null)
    setIsReady(false)
    hudState.current = initialHudState()
    ready.current = createReadyTracker()
    sessionRef.current = null
    passiveRef.current = null
    faceSince.current = null
    setLive(null)
    setState('idle')
  }

  const passiveSession = () => (passiveRef.current ??= createPassiveSession())

  function liveSession() {
    sessionRef.current ??= createLivenessSession()
    return sessionRef.current
  }
  const retryLive = () => {
    const ses = liveSession()
    ses.reset()
    faceSince.current = null
    liveKey.current = ''
    passiveRef.current?.reset()
    challengePending.current = false
    setOffline(false)
    setLive(ses.state())
  }
  const reviewLive = () => {
    const ses = liveSession()
    ses.requestReview()
    setLive(ses.state())
  }

  const open = state === 'starting' || state === 'live'
  const immersive = layout === 'overlay' && open
  // While the phone camera is full-screen the page behind it must not scroll.
  useEffect(() => {
    if (!immersive) return
    document.documentElement.classList.add('cam-lock')
    return () => document.documentElement.classList.remove('cam-lock')
  }, [immersive])

  // On tablets and desktops the page can be taller than the screen: when the camera opens, make sure the
  // shutter is on screen (a worker must never have to scroll to find it).
  useEffect(() => {
    if (state !== 'live' || layout === 'overlay') return
    const sh = document.querySelector('.live__shutter')
    const b = sh?.getBoundingClientRect()
    if (b && (b.bottom > window.innerHeight || b.top < 0)) sh.scrollIntoView({ block: 'nearest' })
  }, [state, layout])

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
    cropReader.current ??= createCropReader()
    let alive = true
    const id = setInterval(() => {
      const v = videoRef.current
      // Skip (never queue) a tick while the worker is still on the previous frame.
      if (!v || v.readyState < 2 || busy || tickBusy.current) return
      const t0 = performance.now()
      const px = readSmall(v, v.videoWidth, v.videoHeight, LIVE.size, small.current)

      // The face detector needs the pixels on this thread (WASM); it gets its own copy, since the
      // worker takes ownership of `px.rgba`. Every Nth tick, without queueing.
      if (needsFace && detector && !faceBusy.current && tickN.current++ % LIVE.faceEvery === 0) {
        faceBusy.current = true
        const faceFrame = buildFrame({ rgba: px.rgba.slice(), width: px.width, height: px.height })
        detector
          .detect(faceFrame)
          .then((faces) => {
            lastFace.current = evaluateFace(faces, faceFrame)
            faceSeq.current++ // lets the HUD count consecutive EMPTY detections, not ticks
          })
          .catch(() => (lastFace.current = null))
          .finally(() => (faceBusy.current = false))
      }

      // The native crop (noise) is read every other tick; in between the last σ is kept.
      const nativeCrop = hudTick.current++ % HUD.cropEvery === 0 ? cropReader.current(v) : null
      const tMain = performance.now() - t0 // what the UI thread paid for this tick

      tickBusy.current = true
      analyzeLiveInWorker(px, {
        motion: bufRef.current?.recent(LIVE.motionWindowMs) ?? null,
        face: lastFace.current,
        faceSeq: faceSeq.current,
        task: { face: task.face },
        video: { width: v.videoWidth, height: v.videoHeight },
        nativeCrop,
        liveness: needsLive ? livenessRow(sessionRef.current?.state() ?? null, combinePassive({ live: passiveRef.current?.summary() })) : null,
        now: performance.now(),
        prev: hudState.current,
      })
        .then((summary) => {
          if (!alive) return
          hudState.current = summary.state
          if (raw) {
            // Dev view (?hud=raw): main-thread cost per tick (the performance budget) and total latency.
            ;(window.__liveTickMs ??= []).push(tMain)
            ;(window.__liveTickLatency ??= []).push(performance.now() - t0)
            ;(window.__liveTickAt ??= []).push(performance.now())
            summary.tickMs = tMain
          }
          if (needsFace && summary.passive) passiveSession().addTick(summary.passive)
          if (raw && needsFace) window.__passiveNow = { tick: summary.passive, session: passiveRef.current?.summary() } // dev view (?hud=raw)
          setHud(summary)
          setIsReady(ready.current(summary))
          if (needsLive && sessionRef.current) setLive(sessionRef.current.state()) // also re-evaluates how long the pass stays valid
        })
        .catch((err) => console.warn('[hud] live tick failed:', err)) // never swallow: a silent failure here froze the numbers once
        .finally(() => (tickBusy.current = false))
    }, TICK_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [state, busy, needsFace, needsLive, detector, task.face, raw])

  // Face mesh: landmarks at ~8 Hz on their own loop (never queued, face tasks only). It only draws.
  useEffect(() => {
    if (state !== 'live' || !needsFace) {
      meshTarget.current = null
      return
    }
    const landmarker = mediapipeLandmarker({ base: `${import.meta.env.BASE_URL}mediapipe` })
    landmarker.warmUp()
    const canvas = document.createElement('canvas')
    let alive = true
    let working = false
    const id = setInterval(async () => {
      const v = videoRef.current
      if (!v || v.readyState < 2 || working || busy) return
      working = true
      try {
        const px = readSmall(v, v.videoWidth, v.videoHeight, LIVE.size, canvas)
        const full = await landmarker.detectFull({ width: px.width, height: px.height, rgba: px.rgba })
        if (!alive) return
        meshTarget.current = selectMeshPoints(full.points)
        if (needsFace) passiveSession().addLandmarks(performance.now(), meshTarget.current)
        if (needsLive) stepLiveness(toSample(performance.now(), full))
      } catch (err) {
        if (alive) meshTarget.current = null
        if (!landmarker.failed) { landmarker.failed = true; console.warn('[mesh] face landmarks unavailable:', err) }
      } finally {
        working = false
      }
    }, needsLive ? LIVENESS.sampleEveryMs : 120)
    return () => {
      alive = false
      clearInterval(id)
      meshTarget.current = null
      accentRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, needsFace, needsLive, busy])

  // One landmarker sample into the liveness session. The session starts once a face has been steady for a moment
  // (so the countdown does not run while the worker is still framing themselves).
  function stepLiveness(sample) {
    const ses = liveSession()
    const snap = ses.snapshot()
    if (!snap) {
      if (!sample.face) faceSince.current = null
      else {
        faceSince.current ??= sample.t
        if (sample.t - faceSince.current >= 600 && !challengePending.current) {
          // Ask the server for the challenge + a single-use nonce for this attempt (it re-checks the evidence against it).
          // If it cannot be reached, fall back to local random challenges: the server will flag them as unverified.
          challengePending.current = true
          const id = attempt.current
          fetchLivenessChallenge({ workerId, taskId }).then((ch) => {
            if (id !== attempt.current || ses.snapshot()) { challengePending.current = false; return } // the camera was closed or restarted meanwhile
            if (!ch) {
              // The server could not be reached: say so (the live check needs it, and so does the upload) and try again shortly.
              setOffline(true)
              setTimeout(() => { challengePending.current = false }, OFFLINE_RETRY_MS)
              return
            }
            challengePending.current = false
            setOffline(false)
            ses.start({ challenges: ch.challenges, nonce: ch.id, startT: performance.now() })
            liveKey.current = ''
            setLive(ses.state())
          })
        }
      }
    } else if (snap.phase === 'running') {
      ses.push(sample)
    }
    const cur = ses.snapshot()
    accentRef.current = cur?.phase === 'running' && cur.current.state === 'active'
    // re-render only when something the worker can see changed (phase, step, state); the 5 Hz tick refreshes the countdown
    const key = `${cur?.phase}|${cur?.index}|${cur?.current?.state}|${cur?.current?.faceLost}`
    if (key !== liveKey.current) {
      liveKey.current = key
      setLive(ses.state())
    }
  }

  const liveOk = !needsLive || !!(live?.valid || live?.reviewRequested)

  async function capture() {
    const v = videoRef.current
    if (!v || busy || !liveOk) return
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
        liveness: needsLive ? livenessEvidence() : null,
        livePassive: needsFace ? passiveRef.current?.summary() ?? null : null,
      })
    } finally {
      shots.forEach((s) => s.bmp.close?.())
      setBusy(false)
    }
  }

  // What travels with the photo: the passed challenge (ids, per-challenge result, a compact signal timeline, the
  // nonce) or an explicit "review" when the worker used up the attempts. The server re-checks all of it.
  function livenessEvidence() {
    const st = sessionRef.current?.state()
    if (!st) return null
    if (st.valid && st.evidence) return { ...st.evidence, status: 'passed', capturedAfterMs: Math.round(Date.now() - st.passedAt), passive: passiveRef.current?.summary() ?? null }
    if (st.reviewRequested) return { ...(st.evidence ?? {}), status: 'review', attempts: st.attempts }
    return st.evidence ? { ...st.evidence, status: 'failed' } : null
  }

  const chips = hud ? LIVE_PRIORITY.filter((id) => hud.checks[id]) : []
  const face = hud?.checks.face
  const box = face?.box
  const faceBox = box && fit ? { left: fit.x + (mirrored ? 1 - box.x - box.w : box.x) * fit.w, top: fit.y + box.y * fit.h, width: box.w * fit.w, height: box.h * fit.h } : null
  const faceTone = face?.status === STATUS.PASS ? 'ok' : face?.status === STATUS.FAIL ? 'bad' : 'warn'

  const ar = state === 'live' && dims ? dims.w / dims.h : 4 / 3
  const overlayLayout = layout === 'overlay'
  const hudEl = <LiveHud summary={hud} mode={hudMode} onToggle={toggleHud} raw={raw} variant={overlayLayout ? 'overlay' : 'side'} faceMode={task.face} />
  const chipIcon = { pass: Check, warn: TriangleAlert, fail: CircleX }
  const hint = busy ? 'Hold still…' : !liveOk ? 'Complete the live check to enable the shutter.' : isReady ? 'Looks good. Tap to capture.' : hud?.hint ?? 'Frame your photo.'

  return (
    <>
      <div className="cap-grid__stage">
        <div className={`cap-stage cap-on-camera${immersive ? ' cap-stage--immersive' : ''}`} ref={wrap} data-layout={layout} data-immersive={immersive ? '1' : '0'} data-cam={state} style={{ '--cap-ar': `${ar}`, '--cap-ar-num': ar }}>
          <video ref={videoRef} playsInline muted className={`cap-stage__video${mirrored ? ' cap-stage__video--mirror' : ''}`} aria-label="Camera preview" />

          {state !== 'live' && (
            <button type="button" className="cap-start" onClick={start} disabled={state === 'starting'}>
              <span className="cap-start__icon">{state === 'starting' ? <Loader2 size={28} className="cap-icon cap-spin" aria-hidden="true" /> : <Camera size={28} className="cap-icon" aria-hidden="true" />}</span>
              <strong className="cap-start__title">{state === 'starting' ? 'Opening camera…' : 'Tap to open camera'}</strong>
              <span className="cap-start__cap">{task.camera === 'user' ? 'Front camera' : 'Rear camera'} · live guidance</span>
            </button>
          )}

          {immersive && <div className="cap-minisp" role="img" aria-label="Step 1 of 4: Photo"><i /><i /><i /><i /></div>}

          {state === 'live' && needsFace && <FaceMesh targetRef={meshTarget} fit={fit} mirrored={mirrored} accentRef={accentRef} />}
          {state === 'live' && faceBox && <div className={`cap-facebox cap-facebox--${faceTone}`} style={faceBox}><span className="cap-facebox__label">face</span></div>}

          {(immersive || state === 'live') && (
            <div className="cap-stage__top">
              <div className="cap-stage__topline">
                {state === 'live' && hudMode === 'compact' && overlayLayout ? (
                  <div className="cap-chips" aria-label="Live checks">
                    {chips.map((id) => {
                      const st = hud.checks[id].status
                      const I = chipIcon[st] ?? Check
                      return (
                        <span key={id} className={`cap-chk cap-chk--${st}`} data-check={id}>
                          <I size={12} className="cap-icon" aria-hidden="true" /><span className="cap-chk__txt">{LIVE_LABELS[id]}</span><span className="cap-sr"> {st === 'pass' ? 'passed' : st === 'fail' ? 'failed' : 'warning'}</span>
                        </span>
                      )
                    })}
                  </div>
                ) : <span />}
                {immersive && (
                  <button type="button" className="cap-stage__close" onClick={closeCamera} aria-label="Close camera"><X size={20} className="cap-icon" aria-hidden="true" /></button>
                )}
              </div>
              {state === 'live' && needsLive && <LivenessOverlay live={live ?? sessionRef.current?.state() ?? { snapshot: null, valid: false, canRetry: true, attempts: 0 }} offline={offline} onRetry={retryLive} onReview={reviewLive} />}
            </div>
          )}

          {state === 'live' && (
            <div className="cap-stage__dock">
              {overlayLayout && hudEl}
              <div className={`cap-hint${isReady && liveOk && !busy ? ' cap-hint--ready' : ''}`} role="status" data-testid="live-hint">{hint}</div>
              <button type="button" className={`cap-shutter${isReady && liveOk ? ' cap-shutter--ready' : ''}${busy ? ' cap-shutter--busy' : ''}`} onClick={capture} disabled={busy || !liveOk} aria-label={liveOk ? 'Take photo' : 'Take photo (complete the live check first)'} data-live-ok={liveOk ? '1' : '0'}>
                {busy ? <Loader2 size={26} className="cap-icon cap-spin" aria-hidden="true" /> : <span className="cap-shutter__core" />}
              </button>
            </div>
          )}
        </div>
        {!task.live && onUsePicker && (
          <button type="button" className="cap-link" onClick={onUsePicker}>Use the photo picker instead</button>
        )}
      </div>
      {!overlayLayout && (
        <div className="cap-grid__hud">
          <section className="cap-card"><div className="cap-card__body cap-card__body--hud">{hudEl}</div></section>
        </div>
      )}
    </>
  )
}
