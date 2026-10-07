import { AnimatePresence, motion } from 'framer-motion'
import { Camera, CircleAlert, RefreshCw, Satellite, Send, ScanLine, Activity, Wifi, ShieldX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Analysis from '../components/capture/Analysis.jsx'
import PhotoOverlay, { overlayBoxes } from '../components/capture/PhotoOverlay.jsx'
import LiveCamera, { cameraSupported } from '../components/capture/LiveCamera.jsx'
import QualityChecklist from '../components/capture/QualityChecklist.jsx'
import SensorTile from '../components/capture/SensorTile.jsx'
import Stepper from '../components/capture/Stepper.jsx'
import Verdict from '../components/capture/Verdict.jsx'
import Gauge from '../components/ui/Gauge.jsx'
import Waveform from '../components/capture/Waveform.jsx'
import { API_BASE } from '../lib/api.js'
import { TASKS, taskConfig } from '../lib/photoQuality/config.js'
import { mediapipeDetector } from '../lib/photoQuality/face/mediapipeDetector.js'
import { runPhotoQualityBrowser } from '../lib/photoQuality/client.js'
import { compactReport } from '../lib/photoQuality/index.js'
import { VERDICT } from '../lib/photoQuality/schema.js'
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
  async function processPhoto(file, { source = 'file', sensor = null, burst = null } = {}) {
    const id = ++runId.current
    setError(null)
    setQuality(null)
    photoFile.current = file ?? null
    captureMeta.current = { source, burst }
    if (!file) return
    setPreview(URL.createObjectURL(file))
    setChecking(true)
    try {
      const report = await runPhotoQualityBrowser(file, { task, sensor, detector: needsFace ? faceDetector() : undefined })
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
      const gpsP = getGPS().then((g) => {
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
          gps,
          motion_samples: motionSamples,
          network_info: net,
        }),
      )
      if (photoFile.current) form.append('photo', photoFile.current, photoFile.current.name || 'photo.jpg')
      const [res] = await Promise.all([fetch(`${API_BASE}/submissions`, { method: 'POST', body: form }), sleep(MIN_ANALYSIS_MS)])
      if (!res.ok) throw new Error(`Server responded ${res.status}: ${await res.text()}`)
      setResult(await res.json())
      setStep('verdict')
    } catch (err) {
      clearInterval(tick)
      setError(`Submission failed: ${err.message}`)
      setStep('photo')
    }
  }

  const verdict = quality?.report.verdict
  const blocked = verdict === VERDICT.BLOCK
  const warned = verdict === VERDICT.WARN
  const canSubmit = !!quality && !blocked
  const glow = blocked ? 'red' : warned ? 'amber' : 'green'

  return (
    <div>
      <Stepper current={STEP_INDEX[step]} />

      <AnimatePresence mode="wait">
        {step === 'photo' && (
          <motion.div key="photo" className="stack stack--lg" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22 }}>
            <div className="panel panel--tight">
              <div className="eyebrow eyebrow--cyan">Mission brief</div>
              <h1 style={{ fontSize: 22, marginTop: 4 }}>Capture proof of work</h1>
              <div className="ctx">
                <span className="chip">worker · {WORKER_ID}</span>
                <span className="chip">site · {SITE_ID}</span>
              </div>
              <div className="tasks" role="group" aria-label="Task type">
                {Object.entries(TASKS).map(([id, t]) => (
                  <button key={id} type="button" className={`chip chip--btn${id === taskId ? ' chip--active' : ''}`} aria-pressed={id === taskId} onClick={() => pickTask(id)}>
                    {t.label}
                  </button>
                ))}
              </div>
              {needsFace && (
                <p className="dim" style={{ fontSize: 13, marginTop: 8 }}>
                  {task.face === 'required' ? 'This task needs a clear photo of your face.' : 'A face is optional for this task.'}
                </p>
              )}
            </div>

            {error && (
              <div className="banner banner--error" role="alert">
                <CircleAlert size={18} />
                <span>{error}</span>
                {canSubmit && (
                  <button className="btn btn--sm btn--danger" onClick={onSubmit}>
                    <RefreshCw size={14} /> Retry
                  </button>
                )}
              </div>
            )}

            {cameraNote && mode === 'file' && !preview && (
              <div className="banner banner--warn" role="status">
                <CircleAlert size={18} />
                <span>{cameraNote}</span>
              </div>
            )}

            <div className={`panel brackets${blocked ? ' shake' : ''}`} key={blocked ? 'b' : 'n'} style={{ padding: 12 }}>
              {mode === 'camera' && !preview ? (
                <div className="viewfinder viewfinder--live">
                  <LiveCamera
                    key={inputKey}
                    task={task}
                    detector={needsFace ? faceDetector() : null}
                    autoStart={autoStart}
                    onCapture={(file, meta) => processPhoto(file, meta)}
                    onUnavailable={cameraUnavailable}
                  />
                </div>
              ) : (
                <label className={`viewfinder${preview ? ' viewfinder--filled' : ''}`} style={{ display: 'grid' }}>
                  <input
                    key={inputKey}
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    capture={task.camera}
                    onChange={onPhotoChange}
                    style={{ position: 'absolute', opacity: 0, inset: 0, cursor: preview ? 'default' : 'pointer', pointerEvents: preview ? 'none' : 'auto' }}
                    aria-label="Take or choose a photo"
                  />
                  {preview ? (
                    <>
                      {quality ? (
                        <PhotoOverlay src={preview} width={quality.report.metrics.width} height={quality.report.metrics.height} boxes={overlayBoxes(quality.report)} />
                      ) : (
                        <img src={preview} alt="Captured proof" />
                      )}
                      {checking && <div className="scanline" />}
                    </>
                  ) : (
                    <div className="viewfinder__target">
                      <div className="reticle">
                        <div className="reticle__core">
                          <Camera size={28} />
                        </div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text)', fontWeight: 600 }}>Tap to capture</div>
                        <div className="eyebrow" style={{ marginTop: 4 }}>{task.camera === 'user' ? 'Front camera' : 'Rear camera'} · photo quality check</div>
                      </div>
                    </div>
                  )}
                </label>
              )}
            </div>

            {mode === 'camera' && !preview && !task.live && (
              <button type="button" className="picker-link" onClick={() => { setMode('file'); setCameraNote(null) }}>
                Use the photo picker instead
              </button>
            )}
            {mode === 'file' && !preview && cameraSupported() && (
              <button type="button" className="picker-link" onClick={() => { setMode('camera'); setCameraNote(null); setAutoStart(false) }}>
                Use the live camera
              </button>
            )}

            {checking && (
              <div className="terminal" role="status">
                <div>&gt; Checking focus, lighting, lens{needsFace ? ', face' : ''} on-device…</div>
              </div>
            )}

            {quality && (
              <motion.div className={`panel panel--glow-${glow}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <QualityChecklist report={quality.report} />
                <div className="row" style={{ marginTop: 'var(--s2)' }}>
                  {canSubmit && (
                    <button className="btn btn--primary" onClick={onSubmit}>
                      <Send size={16} /> {warned ? 'Submit anyway' : 'Submit'}
                    </button>
                  )}
                  <button className={`btn ${blocked ? 'btn--primary' : ''}`} onClick={() => reset({ reopenCamera: true })}>
                    <RefreshCw size={16} /> Retake
                  </button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}

        {step === 'sensors' && (
          <motion.div key="sensors" className="panel stack stack--lg" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22 }}>
            <div>
              <div className="eyebrow eyebrow--cyan">Sensor fusion</div>
              <h2 style={{ fontSize: 20, marginTop: 4 }}>Reading the environment</h2>
              <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>Hold the phone naturally for ~3 seconds.</p>
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
            </div>
          </motion.div>
        )}

        {step === 'analysis' && (
          <motion.div key="analysis" className="panel stack stack--lg" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
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
          <motion.div key="verdict" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Verdict result={result} onReset={() => reset({ reopenCamera: true })} />
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
  )
}
