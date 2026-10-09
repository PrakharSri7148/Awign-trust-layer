import { AnimatePresence, motion } from 'framer-motion'
import { CircleAlert, RefreshCw, Satellite, ScanFace, ScanLine, Activity, Wifi, ShieldX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Analysis from '../components/capture/Analysis.jsx'
import PhotoOverlay, { overlayBoxes } from '../components/capture/PhotoOverlay.jsx'
import LiveCamera, { cameraSupported } from '../components/capture/LiveCamera.jsx'
import QualityChecklist from '../components/capture/QualityChecklist.jsx'
import SensorFeed from '../components/capture/SensorFeed.jsx'
import SensorTile from '../components/capture/SensorTile.jsx'
import Stepper from '../components/capture/Stepper.jsx'
import LegacyStepper from '../components/capture/LegacyStepper.jsx'
import CapShell from '../components/capture/CapShell.jsx'
import FilePicker from '../components/capture/FilePicker.jsx'
import { useCapTheme } from '../components/capture/useCapTheme.js'
import { useLayoutMode } from '../components/capture/useLayoutMode.js'
import { ChromeShell } from '../components/Shell.jsx'
import TrailTile from '../components/capture/TrailTile.jsx'
import Verdict from '../components/capture/Verdict.jsx'
import VisitPanel from '../components/capture/VisitPanel.jsx'
import Gauge from '../components/ui/Gauge.jsx'
import Waveform from '../components/capture/Waveform.jsx'
import { API_BASE, startVisit } from '../lib/api.js'
import { TASKS, taskConfig } from '../lib/photoQuality/config.js'
import { mediapipeDetector } from '../lib/photoQuality/face/mediapipeDetector.js'
import { runPhotoQualityBrowser } from '../lib/photoQuality/client.js'
import { compactReport } from '../lib/photoQuality/index.js'
import { VERDICT } from '../lib/photoQuality/schema.js'
import { CONSENT_KEY } from '../lib/sensorFusion/consent.js'
import { recentFix } from '../lib/sensorFusion/display.js'
import { createTripRecorder, safeStorage } from '../lib/sensorFusion/tripRecorder.js'
import { captureMotionSample, getGPS, getNetworkInfo } from '../lib/sensors.js'

const WORKER_ID = 'worker_demo_1'
const DEFAULT_TASK_ID = 'task_demo_1'
const SITE_ID = 'site_demo_1'
const MOTION_MS = 3000
const MIN_ANALYSIS_MS = 2600

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const STEP_INDEX = { photo: 0, sensors: 1, analysis: 2, verdict: 3 }
const BARS = { slow: 1, '3g': 2, '2g': 1, 'slow-2g': 1, '4g': 4 }

function signalBars(type) {
  const n = BARS[type] ?? 0
  return (
    <span className="signal" aria-hidden="true" style={{ marginLeft: 'auto' }}>
      {[6, 10, 14, 18].map((h, i) => (
        <i key={h} className={i < n ? 'on' : ''} style={{ height: h }} />
      ))}
    </span>
  )
}

export default function Capture() {
  const [theme, setTheme] = useCapTheme()
  const layout = useLayoutMode()
  const [step, setStep] = useState('photo')
  const [taskId, setTaskId] = useState(DEFAULT_TASK_ID)
  // 'camera' = in-app live viewfinder, 'file' = the system picker / camera app.
  const [mode, setMode] = useState(() => (cameraSupported() ? 'camera' : 'file'))
  const [cameraNote, setCameraNote] = useState(null)
  const [autoStart, setAutoStart] = useState(false)
  const [inputKey, setInputKey] = useState(0)
  const [preview, setPreview] = useState(null)
  const [quality, setQuality] = useState(null)
  const [checking, setChecking] = useState(false)
  const [sensors, setSensors] = useState({ gps: 'wait', motion: 'wait', net: 'wait' })
  const [readout, setReadout] = useState({})
  const [left, setLeft] = useState(MOTION_MS)
  const [result, setResult] = useState(null)
  const [sensorNotes, setSensorNotes] = useState([])
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const runId = useRef(0)
  const photoFile = useRef(null)
  const captureMeta = useRef({ source: 'file' })

  // Sensor fusion: the approach trail (GPS fixes + 5 s motion summaries) recorded while this page is open. Components that show it
  // subscribe themselves, so this page does not re-render every second.
  const recRef = useRef(null)
  if (!recRef.current) recRef.current = createTripRecorder()
  const recorder = recRef.current
  const [visitNote, setVisitNote] = useState(null)

  // A tap (iOS needs it for the motion permission, so the recorder starts BEFORE anything is awaited); the server visit is opened
  // right after and tied to the recording.
  async function startRecording() {
    if (recorder.getState().running) return
    setVisitNote(null)
    safeStorage.set(CONSENT_KEY, '1')
    await recorder.start({ resume: recorder.hasResumable() })
    if (!recorder.getState().visitId) {
      const v = await startVisit({ workerId: WORKER_ID, taskId, siteId: SITE_ID })
      if (v) recorder.setVisit({ visitId: v.visitId, clockOffsetMs: v.offsetMs })
      else setVisitNote('Could not reach the server to open the visit. The trail is still recorded, but it cannot be checked against the server clock.')
    }
  }

  // Already agreed on an earlier visit: start by itself where no tap is needed (iOS asks for motion access only from a tap).
  useEffect(() => {
    // Only iOS insists on a tap for the motion permission. (Chrome now exposes requestPermission too, so "has the function" is not iOS.)
    const ua = globalThis.navigator ?? {}
    const iOS = /iPad|iPhone|iPod/.test(ua.userAgent ?? '') || (ua.platform === 'MacIntel' && (ua.maxTouchPoints ?? 0) > 1)
    const needsTap = iOS && typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function'
    if (safeStorage.get(CONSENT_KEY) === '1' && !needsTap) startRecording()
    return () => recorder.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  // What this task needs from the photo (e.g. a face) and which camera to open.
  const task = taskConfig(taskId)
  const needsFace = task.face !== 'off'
  const faceDetector = () => mediapipeDetector({ base: `${import.meta.env.BASE_URL}mediapipe` })

  // The face model is ~13 MB: start fetching it as soon as a face task is chosen,
  // so it is usually ready by the time the photo has been taken.
  useEffect(() => {
    if (needsFace) faceDetector().warmUp()
  }, [needsFace])

  function pickTask(id) {
    if (id === taskId) return
    reset() // a photo checked for one task says nothing about another (no camera auto-open: the worker only chose a task)
    setTaskId(id)
  }

  // `reopenCamera`: after Retake / New submission the worker just tapped, which counts as the
  // gesture, so the camera can reopen straight away. Switching task must not pop a permission prompt.
  function reset({ reopenCamera = false } = {}) {
    runId.current++ // drop any quality check still running
    setAutoStart(reopenCamera && mode === 'camera')
    setStep('photo')
    setQuality(null)
    setPreview(null)
    setResult(null)
    setSensorNotes([])
    setError(null)
    setSensors({ gps: 'wait', motion: 'wait', net: 'wait' })
    setReadout({})
    setInputKey((k) => k + 1)
  }

  // Check a photo from either source. `sensor` = motion window around the shutter (camera only).
  async function processPhoto(file, { source = 'file', sensor = null, burst = null, liveness = null, livePassive = null } = {}) {
    const id = ++runId.current
    setError(null)
    setQuality(null)
    photoFile.current = file ?? null
    captureMeta.current = { source, burst, liveness, livePassive }
    if (!file) return
    setPreview(URL.createObjectURL(file))
    setChecking(true)
    try {
      const report = await runPhotoQualityBrowser(file, { task, sensor, liveness, livePassive, source, detector: needsFace ? faceDetector() : undefined })
      if (id === runId.current) setQuality({ report }) // ignore results from a superseded photo
    } catch (err) {
      if (id !== runId.current) return
      setError(`Could not read photo: ${err.message}`)
      setPreview(null)
    } finally {
      if (id === runId.current) setChecking(false)
    }
  }

  const onPhotoChange = (e) => processPhoto(e.target.files?.[0], { source: 'file' })

  function cameraUnavailable(reason) {
    setMode('file')
    setCameraNote(
      (reason === 'denied' ? 'Camera permission was denied. ' : 'The live camera is not available here. ') +
        (task.live ? 'You can still pick a photo, but it will be flagged for review.' : 'Use the photo picker instead.'),
    )
  }

  async function onSubmit() {
    if (!quality || quality.report.verdict === VERDICT.BLOCK) return
    setError(null)
    setResult(null)
    setStep('sensors')
    setSensors({ gps: 'acq', motion: 'acq', net: 'acq' })
    setLeft(MOTION_MS)

    const t0 = performance.now()
    const tick = setInterval(() => setLeft(Math.max(0, MOTION_MS - (performance.now() - t0))), 100)

    try {
      // Motion first: iOS needs requestPermission() inside the tap gesture, before any await.
      const motionP = captureMotionSample(MOTION_MS).then((m) => {
        clearInterval(tick)
        setLeft(0)
        const mean = m.length ? m.reduce((a, s) => a + Math.hypot(s.x, s.y, s.z), 0) / m.length : 0
        setSensors((s) => ({ ...s, motion: m.length ? 'ok' : 'na' }))
        setReadout((r) => ({ ...r, motion: m.length ? `${m.length} samples · mean ${mean.toFixed(2)} m/s²` : 'No samples (sensor unavailable or denied)' }))
        return m
      })
      // A cold one-shot fix often times out on phones; the visit recording's own fresh fix (same device) stands in for it.
      const gpsP = getGPS().then((g) => g ?? recentFix(recorder.getState())).then((g) => {
        setSensors((s) => ({ ...s, gps: g ? 'ok' : 'na' }))
        setReadout((r) => ({ ...r, gps: g ? `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}` : 'Location unavailable or denied' }))
        return g
      })
      const net = getNetworkInfo()
      const hasNet = !!net.effectiveType
      setSensors((s) => ({ ...s, net: hasNet ? 'ok' : 'na' }))
      setReadout((r) => ({
        ...r,
        net: hasNet ? `${net.effectiveType} · ${net.downlink} Mbps · ${net.rtt} ms` : 'Network info not exposed by this browser',
      }))

      const [motionSamples, gps] = await Promise.all([motionP, gpsP])
      // The approach trail up to now (including the seconds just spent on the 3 s sample above, so the server can cross-check them).
      const rec = recorder.getState()
      const trail = rec.running ? recorder.snapshot() : null

      const notes = []
      if (!gps) notes.push('GPS unavailable or denied')
      if (motionSamples.length === 0) notes.push('no motion samples (sensor unavailable or denied)')
      if (!hasNet) notes.push('network info unavailable in this browser')
      setSensorNotes(notes)

      await sleep(500)
      setStep('analysis')
      // Multipart: the photo itself (so the server can re-check it, never trusting
      // this device's verdict) plus everything else as a JSON `payload` field.
      const form = new FormData()
      form.append(
        'payload',
        JSON.stringify({
          worker_id: WORKER_ID,
          task_id: taskId,
          site_id: SITE_ID,
          photo_quality_pass: quality.report.verdict !== VERDICT.BLOCK,
          photo_quality: compactReport(quality.report),
          photo_override: quality.report.verdict === VERDICT.WARN, // worker chose "Submit anyway"
          capture_source: captureMeta.current.source, // 'camera' (live, in-app) or 'file' (picker)
          capture_burst: captureMeta.current.burst ?? null,
          passive_evidence: captureMeta.current.livePassive ?? null, // banding / planarity / glare-on-face from the camera session
          liveness_evidence: captureMeta.current.liveness ?? null, // the live challenge: ids, results, signal timeline, nonce (the server re-checks it)
          gps,
          motion_samples: motionSamples,
          network_info: net,
          visit_id: trail ? rec.visitId : null, // the server-issued visit this trail must fit inside
          trail,
        }),
      )
      if (photoFile.current) form.append('photo', photoFile.current, photoFile.current.name || 'photo.jpg')
      const [res] = await Promise.all([fetch(`${API_BASE}/submissions`, { method: 'POST', body: form }), sleep(MIN_ANALYSIS_MS)])
      if (!res.ok) throw new Error(`Server responded ${res.status}: ${await res.text()}`)
      setResult(await res.json())
      recorder.reset() // a visit carries one submission
      setStep('verdict')
    } catch (err) {
      clearInterval(tick)
      setError(`Submission failed: ${err.message}`)
      setStep('photo')
    }
  }

  const verdict = quality?.report.verdict
  const blocked = verdict === VERDICT.BLOCK
  const canSubmit = !!quality && !blocked
  const report = quality?.report

  // Steps 2-4 (Arrival, AI scan, Verdict) keep the old chrome and look; only the Photo step is redesigned.
  if (step !== 'photo') {
    return (
      <ChromeShell>
        <div>
          <div className="capture-narrow"><LegacyStepper current={STEP_INDEX[step]} /></div>
          <AnimatePresence mode="wait">
        {step === 'sensors' && (
          <motion.div key="sensors" className="panel stack stack--lg capture-narrow" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22 }}>
            <div>
              <div className="eyebrow eyebrow--cyan">Verifying your arrival</div>
              <h2 style={{ fontSize: 20, marginTop: 4 }}>Sending your location</h2>
              <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>Your photo is verified. Hold the phone naturally for ~3 seconds while we send your GPS location and the movement recorded on the way, and check you reached the site.</p>
            </div>
            <div className="sensors">
              <SensorTile icon={Satellite} title="GPS" state={sensors.gps} value={readout.gps} />
              <SensorTile
                icon={Activity}
                title="Motion"
                state={sensors.motion}
                value={readout.motion}
                aside={
                  sensors.motion === 'acq' && (
                    <Gauge value={1 - left / MOTION_MS} color="var(--cyan)" size={52} stroke={5}>
                      <span className="num" style={{ fontSize: 13 }}>{(left / 1000).toFixed(1)}</span>
                    </Gauge>
                  )
                }
              >
                <Waveform active={sensors.motion === 'acq'} />
              </SensorTile>
              <SensorTile icon={Wifi} title="Network" state={sensors.net} value={readout.net} aside={sensors.net === 'ok' ? signalBars(getNetworkInfo().effectiveType) : null} />
              <TrailTile recorder={recorder} />
            </div>
          </motion.div>
        )}

        {step === 'analysis' && (
          <motion.div key="analysis" className="panel stack stack--lg capture-narrow" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <div style={{ textAlign: 'center' }}>
              <div className="eyebrow eyebrow--cyan">AI analysis</div>
              <h2 style={{ fontSize: 20, marginTop: 4 }}>Neural scan in progress</h2>
            </div>
            <Analysis />
            {sensorNotes.length > 0 && (
              <div className="banner banner--warn">
                <ShieldX size={18} />
                <span>Note: {sensorNotes.join('; ')}. Submitted anyway.</span>
              </div>
            )}
          </motion.div>
        )}

        {step === 'verdict' && result && (
          <motion.div key="verdict" className="capture-narrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Verdict result={result} onReset={() => { globalThis.scrollTo?.({ top: 0 }); reset({ reopenCamera: true }); if (safeStorage.get(CONSENT_KEY) === '1') startRecording() }} />
            {sensorNotes.length > 0 && (
              <div className="banner banner--warn" style={{ marginTop: 'var(--s2)' }}>
                <ScanLine size={18} />
                <span>Note: {sensorNotes.join('; ')}. Submitted anyway.</span>
              </div>
            )}
          </motion.div>
        )}
          </AnimatePresence>
        </div>
      </ChromeShell>
    )
  }

  const recording = recorder.getState().running
  return (
    <CapShell theme={theme} onTheme={setTheme}>
      <Stepper current={STEP_INDEX[step]} />

      <section className="cap-card cap-brief" aria-label="Task">
        <div className="cap-brief__tasks" role="group" aria-label="Task type">
          {Object.entries(TASKS).map(([id, t]) => (
            <button key={id} type="button" className="cap-chip cap-chip--toggle" aria-pressed={id === taskId} onClick={() => pickTask(id)}>
              {t.label}
            </button>
          ))}
        </div>
        {needsFace && (
          <p className="cap-brief__note">
            <ScanFace size={16} className="cap-icon" aria-hidden="true" />
            <span>{task.face === 'required' ? 'This task needs a clear photo of your face and a short live check (blink, turn your head, smile or open your mouth). They are used only to verify this submission.' : 'A face is optional for this task.'}</span>
          </p>
        )}
      </section>

      {error && (
        <div className="cap-banner cap-banner--error" role="alert">
          <CircleAlert size={18} className="cap-icon" aria-hidden="true" />
          <span className="cap-banner__text">{error}</span>
          {canSubmit && (
            <button type="button" className="cap-btn cap-btn--sm cap-btn--danger" onClick={onSubmit}>
              <RefreshCw size={14} className="cap-icon" aria-hidden="true" /> Retry
            </button>
          )}
        </div>
      )}

      {cameraNote && mode === 'file' && !preview && (
        <div className="cap-banner cap-banner--warn" role="status">
          <CircleAlert size={18} className="cap-icon" aria-hidden="true" />
          <span className="cap-banner__text">{cameraNote}</span>
        </div>
      )}

      <div className="cap-grid">
        {mode === 'camera' && !preview ? (
          <LiveCamera
            key={inputKey}
            task={task}
            taskId={taskId}
            workerId={WORKER_ID}
            detector={needsFace ? faceDetector() : null}
            autoStart={autoStart}
            onCapture={(file, meta) => processPhoto(file, meta)}
            onUnavailable={cameraUnavailable}
            onUsePicker={() => { setMode('file'); setCameraNote(null) }}
          />
        ) : (
          <>
            <div className="cap-grid__stage">
              {preview ? (
                <PhotoOverlay
                  src={preview}
                  width={report?.metrics.width}
                  height={report?.metrics.height}
                  boxes={overlayBoxes(report)}
                  checking={checking}
                  needsFace={needsFace}
                  blocked={blocked}
                />
              ) : (
                <FilePicker task={task} inputKey={inputKey} inputRef={fileRef} onChange={onPhotoChange} />
              )}
              {mode === 'file' && !preview && cameraSupported() && (
                <button type="button" className="cap-link" onClick={() => { setMode('camera'); setCameraNote(null); setAutoStart(false) }}>
                  Use the live camera
                </button>
              )}
            </div>
            <div className="cap-grid__hud">
              {report ? (
                <QualityChecklist report={report} recording={recording} shake onSend={onSubmit} onRetake={() => reset({ reopenCamera: true })} />
              ) : checking ? (
                <section className="cap-card" aria-label="Photo check" aria-busy="true">
                  <div className="cap-card__head"><div><div className="cap-eyebrow">Photo result</div><h2 className="cap-card__title">Checking your photo</h2></div></div>
                  <div className="cap-card__body"><span className="cap-skeleton" style={{ height: 16 }} /><span className="cap-skeleton" style={{ height: 16, width: '80%' }} /><span className="cap-skeleton" style={{ height: 16, width: '60%' }} /></div>
                </section>
              ) : layout !== 'overlay' ? (
                <section className="cap-card" aria-label="Live quality">
                  <div className="cap-card__head"><div className="cap-eyebrow">Live quality</div></div>
                  <div className="cap-card__body"><p className="cap-hud__empty">Live numbers are available with the live camera. Your photo is checked right after you take it.</p></div>
                </section>
              ) : null}
            </div>
          </>
        )}

        <div className="cap-grid__visit">
          <VisitPanel recorder={recorder} onStart={startRecording} onStop={() => recorder.reset()} note={visitNote} siteId={SITE_ID} />
        </div>
        <div className="cap-grid__feed">
          <SensorFeed recorder={recorder} siteId={SITE_ID} />
        </div>
      </div>
    </CapShell>
  )
}
