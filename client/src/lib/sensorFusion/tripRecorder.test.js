import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTripRecorder } from './tripRecorder.js'
import { signal } from './testing/signals.js'

const T0 = 1_760_000_000_000

// A fake world: a clock, a motion target and a geolocation.
function world({ permission = 'granted', ctor = true, geo = true, storage } = {}) {
  let t = T0
  const listeners = new Set()
  const target = { addEventListener: (_n, f) => listeners.add(f), removeEventListener: (_n, f) => listeners.delete(f) }
  let geoCb = null
  const geolocation = geo ? { watchPosition: (ok, err) => ((geoCb = { ok, err }), 7), clearWatch: () => (geoCb = null) } : undefined
  const mem = new Map()
  const store = storage ?? { get: (k) => mem.get(k) ?? null, set: (k, v) => (mem.set(k, v), true), remove: (k) => mem.delete(k) }
  const Ctor = ctor ? (permission === 'none' ? function Dm() {} : Object.assign(function Dm() {}, { requestPermission: async () => permission })) : undefined
  const timers = []
  const rec = createTripRecorder({
    geolocation, motionTarget: target, DeviceMotionEventCtor: Ctor, now: () => t, storage: store, wakeLockApi: undefined,
    timeOrigin: () => T0 - 100_000, setIntervalFn: (f) => timers.push(f), clearIntervalFn: () => {}, env: () => ({ tz: 'Asia/Kolkata', tz_offset_min: 330, locale: 'en-IN' }),
  })
  return {
    rec, store, mem, listeners,
    advance: (ms) => (t += ms),
    now: () => t,
    motion: (ev) => listeners.forEach((f) => f(ev)),
    pos: (lat, lng, acc = 8, dt = 0) => geoCb?.ok({ coords: { latitude: lat, longitude: lng, accuracy: acc, speed: 1.2, heading: 90, altitude: 900 }, timestamp: t + dt }),
    geoError: (code) => geoCb?.err({ code }),
    // feed secs of a scripted signal as devicemotion events at its own sample times, advancing the fake clock
    feed(samples) {
      for (const s of samples) {
        t = s.t
        this.motion({ acceleration: { x: s.x, y: s.y, z: s.z }, rotationRate: { alpha: s.alpha, beta: s.beta, gamma: s.gamma } })
      }
    },
  }
}

test('records fixes at the downsampled rate, 5 s windows with a walking rhythm, and the wire format', async () => {
  const w = world()
  assert.deepEqual(await w.rec.start(), { geo: null, motion: null })
  w.rec.setVisit({ visitId: 'v1', clockOffsetMs: 0 })
  for (let i = 0; i < 4; i++) {
    w.feed(signal({ f: 1.9, amp: 2, noise: 0.2, gyro: 30, t0: T0 + i * 5000, seed: i + 1 }))
    w.advance(0)
    for (let s = 0; s < 5; s++) { // GPS fixes at 1 Hz: only one per 5 s is kept
      w.pos(12.97, 77.59 + (i * 5 + s) * 1e-5)
      w.advance(1000)
    }
    w.rec.tick()
  }
  const t = w.rec.snapshot({ includePartial: false })
  assert.equal(t.v, 1)
  assert.ok(t.fixes.length >= 3 && t.fixes.length <= 5, `fixes ${t.fixes.length}`)
  assert.ok(t.windows.length >= 3)
  assert.ok(t.windows.every((x) => x.t1 - x.t0 === 5000 && x.acc_rms > 1))
  assert.ok(t.windows.slice(0, 3).every((x) => Math.abs(x.cad_hz - 1.9) < 0.3))
  assert.equal(t.sensors.motion, 'granted')
  assert.equal(t.sensors.geo, 'granted')
  assert.equal(t.sensors.gyro, true)
  assert.equal(t.sensors.linear_accel, true)
  assert.equal(t.env.tz_offset_min, 330)
  assert.equal(t.time_origin, T0 - 100_000)
  assert.ok(t.started_at <= t.fixes[0].t && t.ended_at >= t.fixes.at(-1).t)
})

test('every emitted time is corrected by the server-clock offset', async () => {
  const w = world()
  await w.rec.start()
  w.rec.setVisit({ visitId: 'v1', clockOffsetMs: 90_000 }) // the phone clock is 90 s behind the server's; learned AFTER the recording began
  w.pos(12.97, 77.59)
  w.feed(signal({ f: 1.9, amp: 2, t0: T0 }))
  w.advance(1000)
  w.rec.tick()
  const t = w.rec.snapshot({ includePartial: false })
  assert.equal(t.fixes[0].t, T0 + 90_000)
  assert.equal(t.windows[0].t0, T0 + 90_000)
  assert.equal(t.started_at, T0 + 90_000)
  assert.equal(t.time_origin, T0 - 100_000 + 90_000)
})

test('desktop Chrome fires devicemotion with every field null: that is "null_events", never still', async () => {
  const w = world()
  await w.rec.start()
  for (let i = 0; i < 100; i++) {
    w.advance(50)
    w.motion({ acceleration: { x: null, y: null, z: null }, accelerationIncludingGravity: { x: null, y: null, z: null }, rotationRate: { alpha: null, beta: null, gamma: null } })
  }
  w.rec.tick()
  const t = w.rec.snapshot()
  assert.equal(t.sensors.motion, 'null_events')
  assert.deepEqual(t.windows, [])
})

test('a phone that only reports acceleration including gravity is still read (gravity stripped)', async () => {
  const w = world()
  await w.rec.start()
  for (let i = 0; i < 250; i++) {
    w.advance(20)
    w.motion({ acceleration: null, accelerationIncludingGravity: { x: 0.02 * Math.sin(i), y: 0, z: 9.81 }, rotationRate: null })
  }
  w.advance(1000)
  w.rec.tick()
  const t = w.rec.snapshot({ includePartial: false })
  assert.equal(t.sensors.linear_accel, false)
  assert.ok(t.windows.length >= 1 && t.windows[0].acc_rms < 0.5, `acc_rms ${t.windows[0]?.acc_rms}`) // ~0, not 9.8
})

test('permission states: denied motion, no motion API, no geolocation, denied location', async () => {
  const denied = world({ permission: 'denied' })
  assert.equal((await denied.rec.start()).motion, 'denied')
  assert.equal(denied.listeners.size, 1) // it still listens: a denial means no events, and real events (if any) are used
  assert.equal(denied.rec.snapshot().sensors.motion, 'denied')
  denied.feed(signal({ f: 1.9, amp: 2, secs: 1 }))
  assert.equal(denied.rec.snapshot().sensors.motion, 'granted') // events arrived after all: the evidence wins over the label

  const absent = world({ ctor: false, geo: false })
  assert.deepEqual(await absent.rec.start(), { geo: 'absent', motion: 'absent' })

  const noGeo = world()
  await noGeo.rec.start()
  noGeo.geoError(1)
  assert.equal(noGeo.rec.snapshot().sensors.geo, 'denied')
})

test('caps: at most maxFixes fixes and maxWindows windows, and nothing older than maxTrailS', async () => {
  const w = world()
  await w.rec.start()
  for (let i = 0; i < 300; i++) {
    w.pos(12.97, 77.59 + i * 1e-5)
    w.advance(5000)
  }
  const t = w.rec.snapshot({ includePartial: false })
  assert.ok(t.fixes.length <= 240)
  assert.ok(t.ended_at - t.fixes[0].t <= 600_000 + 5000)
})

test('the recording survives a reload (same device, fresh enough), and storage that throws changes nothing', async () => {
  const w = world()
  await w.rec.start()
  w.rec.setVisit({ visitId: 'v1', clockOffsetMs: 4000 })
  for (let i = 0; i < 4; i++) {
    w.pos(12.97, 77.59 + i * 1e-4)
    w.advance(5000)
  }
  w.advance(11_000)
  w.rec.tick() // saves
  const saved = w.mem.get('fusion.trail.v1')
  assert.ok(saved)
  assert.equal(JSON.parse(saved).visitId, 'v1')
  const reload = (ms) => {
    const x = world({ storage: { get: () => saved, set: () => true, remove: () => {} } })
    x.advance(ms)
    return x
  }

  const w2 = reload(60_000)
  assert.equal(w2.rec.hasResumable(), true)
  await w2.rec.start({ resume: true }) // the page was reloaded: carry on
  assert.equal(w2.rec.getState().fixes, 4)
  assert.equal(w2.rec.getState().visitId, 'v1')
  assert.equal(w2.rec.snapshot({ includePartial: false }).started_at, T0 + 4000) // the saved offset came back too

  const fresh = reload(60_000)
  await fresh.rec.start() // not asked to resume: starts empty
  assert.equal(fresh.rec.getState().fixes, 0)

  assert.equal(reload(30 * 60_000).rec.hasResumable(), false) // too old to continue

  const blocked = () => { throw new Error('blocked') }
  const broken = world({ storage: { get: blocked, set: blocked, remove: blocked } })
  await broken.rec.start()
  assert.equal(broken.rec.hasResumable(), false)
  broken.pos(12.97, 77.59)
  broken.advance(20_000)
  assert.doesNotThrow(() => broken.rec.tick())
  assert.equal(broken.rec.getState().fixes, 1)
})

test('state summary for the UI: distance, span, accuracy, recent activity', async () => {
  const w = world()
  await w.rec.start()
  for (let i = 0; i < 5; i++) {
    w.pos(12.97, 77.59 + i * 5e-4, 6 + i)
    w.advance(5000)
  }
  const s = w.rec.getState()
  assert.equal(s.running, true)
  assert.ok(s.distanceM > 150 && s.distanceM < 250, `distance ${s.distanceM}`)
  assert.equal(s.fixes, 5)
  assert.equal(s.accuracyM, 10)
  assert.ok(s.spanS >= 19)
  w.rec.stop()
  assert.equal(w.rec.getState().running, false)
})

test('malformed GPS callbacks are ignored', async () => {
  const w = world()
  await w.rec.start()
  w.pos(NaN, 1)
  w.pos(undefined, undefined)
  assert.equal(w.rec.getState().fixes, 0)
})

test('reset clears everything and the stored copy', async () => {
  const w = world()
  await w.rec.start()
  w.pos(12.97, 77.59)
  w.advance(20_000)
  w.rec.tick()
  w.rec.reset()
  assert.equal(w.rec.getState().fixes, 0)
  assert.equal(w.mem.get('fusion.trail.v1'), undefined)
})
