export function getGPS() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 10000, enableHighAccuracy: true },
    )
  })
}

const GRAVITY_ALPHA = 0.8 // low-pass factor for estimating gravity

export async function captureMotionSample(durationMs = 3000) {
  if (typeof DeviceMotionEvent === 'undefined') return []

  // iOS: must be the first await so it still runs inside the user gesture.
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const state = await DeviceMotionEvent.requestPermission()
      if (state !== 'granted') return []
    } catch {
      return []
    }
  }

  return new Promise((resolve) => {
    const samples = []
    let gravity = null

    const onMotion = (event) => {
      const a = event.acceleration
      let x, y, z
      if (a && a.x != null) {
        ;({ x, y, z } = a)
      } else {
        const g = event.accelerationIncludingGravity
        if (!g || g.x == null) return
        // Strip gravity so a still phone reads ~0 instead of ~9.8 m/s^2.
        if (!gravity) gravity = { x: g.x, y: g.y, z: g.z }
        for (const k of ['x', 'y', 'z']) {
          gravity[k] = GRAVITY_ALPHA * gravity[k] + (1 - GRAVITY_ALPHA) * g[k]
        }
        x = g.x - gravity.x
        y = g.y - gravity.y
        z = g.z - gravity.z
      }
      samples.push({ x, y, z, t: event.timeStamp })
    }

    window.addEventListener('devicemotion', onMotion)
    setTimeout(() => {
      window.removeEventListener('devicemotion', onMotion)
      resolve(samples)
    }, durationMs)
  })
}

export function getNetworkInfo() {
  const c = navigator.connection
  if (!c) return { effectiveType: null, downlink: null, rtt: null }
  return {
    effectiveType: c.effectiveType ?? null,
    downlink: c.downlink ?? null,
    rtt: c.rtt ?? null,
  }
}
