// Developer recording mode (?record=1): download the recorded trail as a JSON file that goes into
// Sensor-fusion/samples/<scenario>/ and is read by the accuracy report (backend/tools/reportlib/fusion.py). No photo, no worker id.
export const SCENARIOS = [
  ['walk_to_site', 'Genuine: walked to the site'],
  ['drive_then_walk', 'Genuine: drove, then walked'],
  ['stationary_at_site', 'Genuine: already at the site'],
  ['indoor_poor_gps', 'Genuine: indoors, poor GPS'],
  ['spoof_teleport', 'Spoof: location override jump'],
  ['spoof_mock_android', 'Spoof: mock-location app'],
  ['spoof_static_home', 'Spoof: fake location, phone at home'],
]

export function buildTraceDoc({ scenario, note, trail, networkInfo, userAgent, now = new Date() }) {
  return { format: 'fusion-trace-1', scenario, note: note ?? '', exported_at: now.toISOString(), user_agent: userAgent ?? null, network_info: networkInfo ?? null, trail }
}

export const traceFileName = (scenario, now = Date.now()) => `${scenario}-${now}.json`

export function downloadTrace(doc) {
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = traceFileName(doc.scenario)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const recordModeOn = (search = globalThis.location?.search ?? '') => new URLSearchParams(search).get('record') === '1'

// Inside the Android wrapper (Capacitor injects window.Capacitor into its WebView). There is no address bar there, so the demo
// tools cannot be switched on with ?demo=1.
export const isNativeApp = (g = globalThis) => { try { return !!g.Capacitor?.isNativePlatform?.() } catch { return false } }

// Developer tools (register this spot as the site, the backend address): ?record=1 (also download traces), ?demo=1, the native
// wrapper, or a build made with VITE_DEMO_TOOLS=1 (npm run apk does that).
export const demoToolsOn = (search = globalThis.location?.search ?? '', { native = isNativeApp(), buildFlag = import.meta.env?.VITE_DEMO_TOOLS === '1' } = {}) => {
  const q = new URLSearchParams(search)
  return q.get('record') === '1' || q.get('demo') === '1' || native || buildFlag
}
