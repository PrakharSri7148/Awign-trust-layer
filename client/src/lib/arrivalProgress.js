// "n of 4 readings done" and the progress bar of the Arrival step. A reading is done when it is Locked or Unavailable. While the
// Motion reading is still counting down it adds part of its quarter (never more than 90% of it), so the bar moves smoothly and
// never reaches 100% before the last reading has returned.
export const MOTION_MS = 3000
const KEYS = ['gps', 'motion', 'net', 'trail']

export function arrivalProgress(states, leftMs = MOTION_MS) {
  const done = KEYS.filter((k) => states[k] === 'ok' || states[k] === 'na').length
  const partial = states.motion === 'acq' ? Math.max(0, Math.min(0.9, 1 - leftMs / MOTION_MS)) : 0
  return { done, pct: done === 4 ? 100 : Math.round(((done + partial) / 4) * 100), all: done === 4, anyNa: KEYS.some((k) => states[k] === 'na') }
}
