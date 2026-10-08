// Sensor-fusion thresholds. The numbers live in fusion.json so the server (backend/fusion/config.py) reads exactly the same
// values. They are STARTING VALUES, uncalibrated: see Sensor-fusion/iteration-1.md.
import raw from './fusion.json' with { type: 'json' }

export const CFG = raw
export const TRAIL = raw.trail
export const ACTIVITY = raw.activity
export const POLICY = raw.policy
