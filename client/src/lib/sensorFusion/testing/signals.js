// Scripted sensor signals for tests and the JS/Python parity check. Deterministic (a small seeded generator), plain data.
export function rng(seed = 1) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r())

// secs of samples at hz: a sinusoid at f Hz of amplitude amp on x (+ phase-shifted copies on y, z), noise, constant gyro noise.
export function signal({ f = 0, amp = 0, noise = 0.0, hz = 50, secs = 5, gyro = 3, seed = 1, t0 = 1_760_000_000_000, nulls = false } = {}) {
  const r = rng(seed)
  const out = []
  const n = Math.round(hz * secs)
  for (let i = 0; i < n; i++) {
    const t = i / hz
    const w = 2 * Math.PI * f * t
    out.push(
      nulls
        ? { t: t0 + t * 1000, x: null, y: null, z: null, alpha: null, beta: null, gamma: null }
        : {
            t: t0 + t * 1000,
            x: amp * 0.5 * Math.sin(w / 2) + noise * gauss(r),
            y: amp * 0.4 * Math.sin(w + 1) + noise * gauss(r),
            z: amp * Math.sin(w + 2) + 0.3 * amp * Math.sin(2 * w) + noise * gauss(r),
            alpha: gyro * gauss(r),
            beta: gyro * gauss(r),
            gamma: gyro * gauss(r),
          },
    )
  }
  return out
}

export function scriptedCases() {
  return {
    walking_1_9hz: signal({ f: 1.9, amp: 2.0, noise: 0.2, gyro: 30 }),
    walking_1_4hz_pocket: signal({ f: 1.4, amp: 1.2, noise: 0.15, gyro: 12, seed: 2 }),
    walking_2_6hz_fast: signal({ f: 2.6, amp: 3.0, noise: 0.3, gyro: 50, seed: 3 }),
    still_hand_tremor: signal({ noise: 0.04, gyro: 2, seed: 4 }),
    perfectly_flat: signal({ noise: 0, gyro: 0, seed: 5 }),
    vehicle_vibration: signal({ noise: 0.3, gyro: 4, seed: 6 }),
    low_rate_10hz_walk: signal({ f: 1.9, amp: 2.0, hz: 10, noise: 0.1, seed: 7 }),
    high_rate_100hz_walk: signal({ f: 1.8, amp: 2.2, hz: 100, noise: 0.2, seed: 8 }),
    short_2s_walk: signal({ f: 1.9, amp: 2.0, secs: 2, seed: 9 }),
    all_null_events: signal({ nulls: true, seed: 10 }),
    accel_only_no_gyro: signal({ f: 1.9, amp: 2.0, noise: 0.1, seed: 11 }).map((s) => ({ ...s, alpha: null, beta: null, gamma: null })),
    gyro_only_no_accel: signal({ f: 1.9, amp: 2.0, gyro: 40, seed: 12 }).map((s) => ({ ...s, x: null, y: null, z: null })),
    empty: [],
  }
}
