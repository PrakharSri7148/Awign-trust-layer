// The trip recorder: while the app is open before a submission it keeps a light GPS track and 5-second motion summaries, so the
// server can compare how the phone MOVED with where the GPS says it WENT (backend/fusion/). Everything is injectable so it is
// unit-tested with a fake clock and a fake sensor target; nothing here touches the network.
//
// What it can and cannot do (a web page, not a native app): it records only while the page is open and the screen is on (a
// wake lock is requested where supported); it keeps at most `trail.maxTrailS` seconds; it sends 5 s summaries (RMS, cadence),
// not raw samples; and a modified client can send anything, so the server treats the result as untrusted evidence.
import { ACTIVITY, TRAIL } from './config.js'
import { activity, roundWindow, windowFeatures } from './windows.js'

const GRAVITY_ALPHA = 0.8 // low-pass factor for estimating gravity (same as lib/sensors.js)
const STORE_KEY = 'fusion.trail.v1'

const hav = (a, b) => {
  const R = 6371008.8
  const p1 = (a.lat * Math.PI) / 180
  const p2 = (b.lat * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((b.lng - a.lng) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// localStorage that never throws (blocked storage, private windows).
export const safeStorage = {
  get(k) {
    try {
      return globalThis.localStorage?.getItem(k) ?? null
    } catch {
      return null
    }
  },
  set(k, v) {
    try {
      globalThis.localStorage?.setItem(k, v)
      return true
    } catch {
      return false
    }
  },
  remove(k) {
    try {
      globalThis.localStorage?.removeItem(k)
    } catch {
      /* nothing to do */
    }
  },
}

export function createTripRecorder({
  geolocation = globalThis.navigator?.geolocation,
  motionTarget = globalThis.window,
  DeviceMotionEventCtor = globalThis.DeviceMotionEvent,
  now = () => Date.now(),
  storage = safeStorage,
  wakeLockApi = globalThis.navigator?.wakeLock,
  timeOrigin = () => globalThis.performance?.timeOrigin ?? null,
  visibilityTarget = globalThis.document,
  setIntervalFn = (f, ms) => setInterval(f, ms),
  clearIntervalFn = (h) => clearInterval(h),
  env = () => ({
    tz: (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
      } catch {
        return null
      }
    })(),
    tz_offset_min: -new Date().getTimezoneOffset(),
    locale: globalThis.navigator?.language ?? null,
  }),
  cfg = TRAIL,
  act = ACTIVITY,
} = {}) {
  const winMs = cfg.windowS * 1000
  let running = false
  let visitId = null
  let offset = 0 // server clock minus device clock, ms: internal times stay on the device clock; snapshot() corrects them
  let startedAt = null
  let watchId = null
  let timer = null
  let lock = null
  let handler = null
  let gravity = null
  let samples = [] // raw samples of the windows not closed yet
  let winStart = null
  let fixes = []
  let windows = []
  let lastKept = -Infinity
  const st = { geo: null, motion: null, gyro: false, linearAccel: false, nullEvents: 0, validEvents: 0, hz: [] }
  const subs = new Set()
  let lastSave = 0
  let lastFix = null
  let lastMotion = null // { acc: |linear acceleration| m/s^2, gyro: |rotation rate| deg/s, t }
  let lastWindow = null
  let lastEmit = 0
  let hiddenSince = null
  let hiddenTotalMs = 0
  let hiddenCount = 0
  let watchRestarts = 0
  let lastWatchStart = 0

  const emit = () => subs.forEach((f) => f(getState()))

  function trim() {
    const cutoff = now() - cfg.maxTrailS * 1000
    fixes = fixes.filter((f) => f.t >= cutoff).slice(-cfg.maxFixes)
    windows = windows.filter((w) => w.t1 >= cutoff).slice(-cfg.maxWindows)
  }

  function closeWindows(t, includePartial = false) {
    if (winStart == null) return
    while (winStart + winMs <= t) {
      const chunk = samples.filter((s) => s.t >= winStart && s.t < winStart + winMs)
      const f = windowFeatures(chunk, act)
      lastWindow = roundWindow(winStart, winStart + winMs, f)
      windows.push(lastWindow)
      if (f.hz != null) st.hz.push(f.hz)
      samples = samples.filter((s) => s.t >= winStart + winMs)
      winStart += winMs
    }
    if (includePartial && t - winStart >= 1000) {
      const chunk = samples.filter((s) => s.t >= winStart && s.t <= t)
      const f = windowFeatures(chunk, act)
      if (f.n > 0) windows.push(roundWindow(winStart, t, f))
    }
    trim()
  }

  function onMotion(ev) {
    const t = now()
    const r = ev.rotationRate
    const rot = r && (r.alpha != null || r.beta != null || r.gamma != null) ? { alpha: r.alpha ?? 0, beta: r.beta ?? 0, gamma: r.gamma ?? 0 } : null
    let acc = ev.acceleration && ev.acceleration.x != null ? { x: ev.acceleration.x, y: ev.acceleration.y, z: ev.acceleration.z } : null
    if (acc) st.linearAccel = true
    if (!acc) {
      // Some Android browsers only report acceleration INCLUDING gravity: strip it with a low-pass estimate of gravity.
      const g = ev.accelerationIncludingGravity
      if (g && g.x != null) {
        if (!gravity) gravity = { x: g.x, y: g.y, z: g.z }
        for (const k of ['x', 'y', 'z']) gravity[k] = GRAVITY_ALPHA * gravity[k] + (1 - GRAVITY_ALPHA) * g[k]
        acc = { x: g.x - gravity.x, y: g.y - gravity.y, z: g.z - gravity.z }
      }
    }
    if (!rot && !acc) {
      st.nullEvents++ // desktop Chrome fires devicemotion with every field null: that is "no sensor", not "perfectly still"
      return
    }
    st.validEvents++
    lastMotion = { acc: acc ? Math.hypot(acc.x, acc.y, acc.z) : null, gyro: rot ? Math.hypot(rot.alpha, rot.beta, rot.gamma) : null, t }
    if (rot) st.gyro = true
    if (winStart == null) winStart = t
    samples.push({ t, x: acc?.x ?? null, y: acc?.y ?? null, z: acc?.z ?? null, alpha: rot?.alpha ?? null, beta: rot?.beta ?? null, gamma: rot?.gamma ?? null })
    if (t - lastEmit >= 250) {
      lastEmit = t // the numbers on screen refresh about 4 times a second, not at the sensor rate
      emit()
    }
  }

  function onPosition(pos) {
    const c = pos?.coords
    if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return
    st.geo = 'granted'
    lastFix = { t: Number.isFinite(pos.timestamp) ? pos.timestamp : now(), lat: c.latitude, lng: c.longitude, acc: Number.isFinite(c.accuracy) ? c.accuracy : null, speed: Number.isFinite(c.speed) ? c.speed : null, heading: Number.isFinite(c.heading) ? c.heading : null, alt: Number.isFinite(c.altitude) ? c.altitude : null }
    const t = Number.isFinite(pos.timestamp) ? pos.timestamp : now()
    // Keep one fix per fixIntervalS (a little slack so a 5.0 s cadence is not dropped by 4.99 s of jitter).
    if (fixes.length && t - lastKept < cfg.fixIntervalS * 1000 - 500) return
    lastKept = t
    const r = (v, d) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
    fixes.push({ t, lat: Math.round(c.latitude * 1e6) / 1e6, lng: Math.round(c.longitude * 1e6) / 1e6, acc: r(c.accuracy, 1), speed: r(c.speed, 2), heading: r(c.heading, 0), alt: r(c.altitude, 0) })
    trim()
    emit()
  }

  function onGeoError(err) {
    if (err?.code === 1) st.geo = 'denied'
    emit()
  }

  function startWatch() {
    if (!geolocation?.watchPosition) return
    lastWatchStart = now()
    watchId = geolocation.watchPosition(onPosition, onGeoError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 })
  }

  // Phones stop delivering fixes now and then (a lost GPS lock, a throttled tab): if none arrived for a while while the page is
  // visible, restart the watch instead of recording a silent gap.
  function watchdog(t) {
    if (!running || hiddenSince != null || st.geo === 'denied' || st.geo === 'absent') return
    const lastT = lastFix ? lastFix.t : lastWatchStart
    if (t - Math.max(lastT, lastWatchStart) > cfg.watchdogS * 1000) {
      if (watchId != null) geolocation?.clearWatch?.(watchId)
      watchRestarts++
      startWatch()
    }
  }

  async function takeWakeLock() {
    try {
      const l = (await wakeLockApi?.request?.('screen')) ?? null
      if (!running) {
        l?.release?.() // stopped while the request was pending
        return
      }
      lock = l
      // The system can drop the lock without hiding the page (battery saver, a system dialog): show it instead of claiming it.
      l?.addEventListener?.('release', () => {
        if (lock === l) {
          lock = null
          emit()
        }
      })
    } catch {
      lock = null // unsupported (some WebViews) or refused: the recording works while the screen stays on
    }
  }

  // The screen wake lock is RELEASED whenever the page is hidden (screen off, app switched): note the gap and take it again on return.
  function onVisibility() {
    const hidden = visibilityTarget?.visibilityState === 'hidden'
    const t = now()
    if (hidden && hiddenSince == null) {
      hiddenSince = t
      hiddenCount++
    } else if (!hidden && hiddenSince != null) {
      hiddenTotalMs += t - hiddenSince
      hiddenSince = null
      if (running) {
        lock = null
        takeWakeLock().then(emit)
        lastWatchStart = t // give the GPS a moment to deliver again before the watchdog judges it
      }
    }
    emit()
  }

  function tick() {
    const t = now()
    watchdog(t)
    closeWindows(t)
    if (t - lastSave > 10_000) {
      lastSave = t
      save()
    }
    emit()
  }

  function save() {
    try {
      storage.set(STORE_KEY, JSON.stringify({ visitId, offset, startedAt, fixes, windows, savedAt: now() }))
    } catch {
      /* storage is a convenience only */
    }
  }

  // A recording that survived a reload of the page (same device, fresh enough). Returns it without applying it.
  function stored() {
    try {
      const raw = storage.get(STORE_KEY)
      if (!raw) return null
      const d = JSON.parse(raw)
      if (!d || now() - d.savedAt > cfg.maxTrailS * 1000 || !Array.isArray(d.fixes)) return null
      return d
    } catch {
      return null
    }
  }

  function restore() {
    const d = stored()
    if (!d) return false
    visitId = d.visitId ?? null
    offset = d.offset ?? 0
    fixes = d.fixes ?? []
    windows = d.windows ?? []
    startedAt = d.startedAt ?? null
    lastKept = fixes.length ? fixes[fixes.length - 1].t : -Infinity
    return true
  }

  // Must be called straight from a tap on iOS (motion permission has to be the first await in the gesture), so it does NOT wait
  // for the server: call setVisit() once the visit is open. `resume: true` continues a recording that survived a page reload.
  async function start({ resume = false } = {}) {
    if (running) return { geo: st.geo, motion: st.motion }
    if (!(resume && restore())) startedAt = now()
    running = true

    if (!motionTarget?.addEventListener || typeof DeviceMotionEventCtor === 'undefined') {
      st.motion = 'absent'
    } else {
      let ok = true
      if (typeof DeviceMotionEventCtor.requestPermission === 'function') {
        try {
          ok = (await DeviceMotionEventCtor.requestPermission()) === 'granted'
        } catch {
          ok = false
        }
      }
      if (!ok) st.motion = 'denied'
      // Listen either way. Chrome now exposes requestPermission on desktop too and answers 'denied' when there is no sensor; a
      // denial means no events arrive (the state stays 'denied'), and if events DO arrive they are real and used.
      handler = onMotion
      motionTarget.addEventListener('devicemotion', handler)
    }
    if (!geolocation?.watchPosition) st.geo = 'absent'
    else startWatch()
    visibilityTarget?.addEventListener?.('visibilitychange', onVisibility)
    await takeWakeLock()
    timer = setIntervalFn(tick, 1000)
    emit()
    return { geo: st.geo, motion: st.motion }
  }

  // The visit the server opened for this recording, and its clock minus the device's (so a phone with a wrong clock does not
  // look like a trail "from the future").
  function setVisit({ visitId: id = null, clockOffsetMs = 0 } = {}) {
    visitId = id
    offset = clockOffsetMs
    save()
    emit()
  }

  function stop() {
    running = false
    if (handler) motionTarget?.removeEventListener?.('devicemotion', handler)
    handler = null
    if (watchId != null) geolocation?.clearWatch?.(watchId)
    watchId = null
    visibilityTarget?.removeEventListener?.('visibilitychange', onVisibility)
    if (timer != null) clearIntervalFn(timer)
    timer = null
    try {
      lock?.release?.()
    } catch {
      /* already released */
    }
    lock = null
    emit()
  }

  function reset() {
    stop()
    samples = []
    winStart = null
    fixes = []
    windows = []
    lastKept = -Infinity
    gravity = null
    startedAt = null
    visitId = null
    lastFix = lastMotion = lastWindow = null
    hiddenSince = null
    hiddenTotalMs = 0
    hiddenCount = 0
    watchRestarts = 0
    Object.assign(st, { geo: null, motion: null, gyro: false, linearAccel: false, nullEvents: 0, validEvents: 0, hz: [] })
    storage.remove(STORE_KEY)
    emit()
  }

  // The trail in the wire format (backend/fusion/trail.py). Closes the windows that are complete and, with includePartial,
  // the half-finished one, so the last seconds (the 3 s snippet the app also sends) are covered.
  function snapshot({ includePartial = true } = {}) {
    const t = now()
    closeWindows(t, includePartial)
    const hz = [...st.hz].sort((a, b) => a - b)
    const motion = st.validEvents ? 'granted' : (st.motion ?? (st.nullEvents ? 'null_events' : 'absent'))
    const origin = timeOrigin()
    const o = offset
    return {
      v: 1,
      started_at: startedAt == null ? null : startedAt + o,
      ended_at: t + o,
      time_origin: origin == null ? null : origin + o,
      fixes: fixes.slice(-cfg.maxFixes).map((f) => ({ ...f, t: f.t + o })),
      windows: windows.slice(-cfg.maxWindows).map((w) => ({ ...w, t0: w.t0 + o, t1: w.t1 + o })),
      sensors: { geo: st.geo, motion, gyro: st.gyro, linear_accel: st.linearAccel, hz_median: hz.length ? hz[Math.floor(hz.length / 2)] : null, hidden_s: Math.round((hiddenTotalMs + (hiddenSince != null ? t - hiddenSince : 0)) / 1000), hidden_count: hiddenCount, watch_restarts: watchRestarts },
      env: env(),
    }
  }

  function getState() {
    let dist = 0
    for (let i = 1; i < fixes.length; i++) dist += hav(fixes[i - 1], fixes[i])
    const last = fixes[fixes.length - 1]
    return {
      running,
      geo: st.geo,
      motion: st.validEvents ? 'granted' : (st.motion ?? (st.nullEvents ? 'null_events' : running ? 'waiting' : null)),
      fixes: fixes.length,
      windows: windows.length,
      distanceM: Math.round(dist),
      accuracyM: last?.acc ?? null,
      spanS: fixes.length > 1 ? Math.round((fixes[fixes.length - 1].t - fixes[0].t) / 1000) : 0,
      activities: windows.slice(-24).map((w) => activity(w, act)),
      visitId,
      // live readout (what is on the phone right now)
      lastFix,
      lastFixAgoS: lastFix ? Math.max(0, Math.round((now() - lastFix.t) / 1000)) : null,
      lastMotion,
      lastWindow: lastWindow ? { ...lastWindow, activity: activity(lastWindow, act) } : null,
      hz: st.hz.length ? Math.round(st.hz[st.hz.length - 1]) : null,
      gyro: st.gyro,
      wakeLock: !!lock,
      hiddenS: Math.round((hiddenTotalMs + (hiddenSince != null ? now() - hiddenSince : 0)) / 1000),
      hiddenCount,
      watchRestarts,
      visible: hiddenSince == null,
      offsetMs: offset,
      startedAt,
      points: fixes.map((f) => [0, f.lat, f.lng, f.acc]),
    }
  }

  return {
    start,
    setVisit,
    hasResumable: () => !!stored(),
    stop,
    reset,
    tick,
    snapshot,
    getState,
    subscribe(f) {
      subs.add(f)
      return () => subs.delete(f)
    },
    // test seams
    _onMotion: onMotion,
    _onPosition: onPosition,
  }
}
