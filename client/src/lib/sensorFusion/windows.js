// Per-window motion features and activity. A line-for-line port of backend/fusion/windows.py (same algorithm, same thresholds
// from fusion.json); client/tools/fusion-parity.mjs checks that the two agree.
//
// A sample is flat: { t (ms), x, y, z (linear acceleration m/s^2, gravity removed, or null), alpha, beta, gamma (rotationRate deg/s, or null) }.
import { ACTIVITY } from './config.js'

const num = (v) => typeof v === 'number' && Number.isFinite(v)

// -> { n, hz, acc_rms, acc_peak, gyro_rms, cad_hz, cad_pw }. A missing signal is null (never 0): "no sensor" is not "perfectly still".
export function windowFeatures(samples, a = ACTIVITY) {
  const accT = []
  const ax = []
  const ay = []
  const az = []
  const accM = []
  const gyroM = []
  const ts = []
  for (const s of samples ?? []) {
    if (!num(s?.t)) continue
    const hasAcc = num(s.x) && num(s.y) && num(s.z)
    const hasGyro = num(s.alpha) && num(s.beta) && num(s.gamma)
    if (!hasAcc && !hasGyro) continue
    ts.push(s.t)
    if (hasAcc) {
      accT.push(s.t)
      ax.push(s.x)
      ay.push(s.y)
      az.push(s.z)
      accM.push(Math.sqrt(s.x ** 2 + s.y ** 2 + s.z ** 2))
    }
    if (hasGyro) gyroM.push(Math.sqrt(s.alpha ** 2 + s.beta ** 2 + s.gamma ** 2))
  }
  const out = { n: ts.length, hz: null, acc_rms: null, acc_peak: null, gyro_rms: null, cad_hz: null, cad_pw: null }
  if (ts.length >= 2 && ts[ts.length - 1] > ts[0]) out.hz = (ts.length - 1) / ((ts[ts.length - 1] - ts[0]) / 1000)
  if (accM.length) {
    out.acc_rms = Math.sqrt(accM.reduce((s, m) => s + m * m, 0) / accM.length)
    out.acc_peak = Math.max(...accM)
  }
  if (gyroM.length) out.gyro_rms = Math.sqrt(gyroM.reduce((s, m) => s + m * m, 0) / gyroM.length)
  ;[out.cad_hz, out.cad_pw] = cadence(accT, [ax, ay, az], out.hz, a)
  return out
}

// Walking rhythm: the strongest autocorrelation peak between cadHzMin and cadHzMax, SUMMED over the three axes. (Not the
// magnitude: the magnitude of a gravity-free vector is rectified, so a 2 Hz step would show up at 4 Hz; summing the per-axis
// autocorrelations does not care how the phone is held.) -> [Hz, strength 0..1], or [null, null] when it cannot be judged.
export function cadence(ts, axes, hz, a = ACTIVITY) {
  if (ts.length < 2 || hz == null || hz < a.minHzForCadence || ts[ts.length - 1] - ts[0] < 3000) return [null, null]
  const fs = a.cadenceFs
  const step = 1000 / fs
  const n = Math.floor((ts[ts.length - 1] - ts[0]) / step) + 1
  const xs = axes.map((ax) => {
    const x = new Float64Array(n)
    let j = 0
    for (let k = 0; k < n; k++) {
      const g = ts[0] + k * step
      while (j < ts.length - 2 && ts[j + 1] < g) j++
      // linear interpolation, clamped at both ends (numpy.interp)
      const t0 = ts[j]
      const t1 = ts[j + 1]
      let v
      if (g <= ts[0]) v = ax[0]
      else if (g >= ts[ts.length - 1]) v = ax[ts.length - 1]
      else v = t1 === t0 ? ax[j] : ax[j] + ((ax[j + 1] - ax[j]) * (g - t0)) / (t1 - t0)
      x[k] = v
    }
    let mean = 0
    for (let k = 0; k < n; k++) mean += x[k]
    mean /= n
    for (let k = 0; k < n; k++) x[k] -= mean
    return x
  })
  const dot = (x, off, len, lag) => {
    let s = 0
    for (let i = 0; i < len; i++) s += x[i + off] * x[i + off + lag]
    return s
  }
  let r0 = 0
  for (const x of xs) for (let i = 0; i < n; i++) r0 += x[i] * x[i]
  if (r0 < 1e-9) return [null, null]
  const lo = Math.ceil(fs / a.walking.cadHzMax)
  const hi = Math.floor(fs / a.walking.cadHzMin)
  let bestLag = null
  let bestR = -2
  for (let lag = lo; lag <= Math.min(hi, n - 2); lag++) {
    let s = 0
    for (const x of xs) s += dot(x, 0, n - lag, lag)
    const r = ((s / r0) * n) / (n - lag)
    if (r > bestR) {
      bestLag = lag
      bestR = r
    }
  }
  if (bestLag == null) return [null, null]
  return [fs / bestLag, Math.max(0, Math.min(1, bestR))]
}

// still | walking | moving | unknown, from rules (not ML). 'moving' = energy without a walking rhythm (vehicle, running,
// handling the phone): sensors alone cannot reliably tell a vehicle, so there is no such class.
export function activity(w, a = ACTIVITY) {
  const acc = w.acc_rms ?? null
  const gyro = w.gyro_rms ?? null
  if (acc == null && gyro == null) return 'unknown'
  const quietAcc = acc == null || acc < a.still.accRms
  const quietGyro = gyro == null || gyro < a.still.gyroRms
  if (quietAcc && quietGyro) return 'still'
  const wk = a.walking
  const pw = w.cad_pw ?? null
  const hz = w.cad_hz ?? null
  if (acc != null && pw != null && hz != null && pw >= wk.cadPw && hz >= wk.cadHzMin && hz <= wk.cadHzMax && acc >= wk.accRms) return 'walking'
  return 'moving'
}

// What goes on the wire: rounded, so a 2-hour-old phone does not send 17-digit floats.
export function roundWindow(t0, t1, f) {
  const r = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d)
  return { t0, t1, n: f.n, hz: r(f.hz, 1), acc_rms: r(f.acc_rms, 3), acc_peak: r(f.acc_peak, 2), gyro_rms: r(f.gyro_rms, 2), cad_hz: r(f.cad_hz, 3), cad_pw: r(f.cad_pw, 3) }
}
