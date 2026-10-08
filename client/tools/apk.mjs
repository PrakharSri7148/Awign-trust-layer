// Build the Android debug APK (hackathon H5). Nothing is installed by this script: the one-time setup is in
// Sensor-fusion/apk-notes.md (it needs @capacitor/core, @capacitor/cli and @capacitor/android, Android Studio / the SDK, and Java 17+).
//
//   npm run apk                          # backend address: set at runtime in the app (Sensor feed -> Server)
//   npm run apk -- --api http://192.168.1.20:8000   # also bake a default backend address into this build
//
// Steps: vite build (demo tools on) -> make sure the Android permissions and the keep-screen-on flag are in the project ->
// npx cap sync android -> ./gradlew assembleDebug -> print the APK path and the adb command.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const ANDROID = join(ROOT, 'android')
const args = process.argv.slice(2)
const api = args.includes('--api') ? args[args.indexOf('--api') + 1] : null
const dryPatch = args.includes('--patch-only') // only (re)apply the manifest / activity edits, for checking them

export const PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.CAMERA',
  'android.permission.WAKE_LOCK',
  'android.permission.ACCESS_NETWORK_STATE',
]

// Add the missing <uses-permission> lines (idempotent).
export function patchManifest(xml) {
  const missing = PERMISSIONS.filter((p) => !xml.includes(`"${p}"`))
  if (!missing.length) return { xml, added: [] }
  const lines = missing.map((p) => `    <uses-permission android:name="${p}" />`).join('\n')
  const out = xml.includes('</manifest>') ? xml.replace(/\n?<\/manifest>\s*$/, `\n${lines}\n</manifest>\n`) : xml
  return { xml: out, added: out === xml ? [] : missing }
}

// The Android WebView has no Screen Wake Lock API: keep the screen on from the activity instead (idempotent).
export function patchActivity(src) {
  if (src.includes('FLAG_KEEP_SCREEN_ON')) return { src, changed: false }
  const m = src.match(/public class MainActivity extends BridgeActivity\s*\{\s*\}/)
  if (!m) return { src, changed: false, reason: 'MainActivity has custom code: add FLAG_KEEP_SCREEN_ON by hand (apk-notes.md)' }
  const body = `public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The WebView has no Screen Wake Lock API; keep the screen on while the app is open (the visit recording stops when it turns off).
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}`
  return { src: src.replace(m[0], body), changed: true }
}

function findActivity(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      const r = findActivity(p)
      if (r) return r
    } else if (name === 'MainActivity.java') return p
  }
  return null
}

const run = (cmd, opts = {}) => {
  console.log(`$ ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts })
}

function main() {
  if (!existsSync(join(ROOT, 'node_modules/@capacitor/cli'))) {
    console.error('Capacitor is not installed. One-time setup (see Sensor-fusion/apk-notes.md):\n  npm i @capacitor/core @capacitor/cli @capacitor/android\n  npx cap add android\nthen run npm run apk again.')
    process.exit(1)
  }
  if (!existsSync(ANDROID)) {
    console.error('No android/ project yet: run  npx cap add android  once, then npm run apk again.')
    process.exit(1)
  }
  if (!dryPatch) run('npx vite build', { env: { ...process.env, VITE_DEMO_TOOLS: '1', ...(api ? { VITE_API_URL: api } : {}) } })

  const manifestPath = join(ANDROID, 'app/src/main/AndroidManifest.xml')
  const mf = patchManifest(readFileSync(manifestPath, 'utf8'))
  if (mf.added.length) writeFileSync(manifestPath, mf.xml)
  console.log(mf.added.length ? `AndroidManifest.xml: added ${mf.added.join(', ')}` : 'AndroidManifest.xml: permissions already present')
  const act = findActivity(join(ANDROID, 'app/src/main/java'))
  if (act) {
    const a = patchActivity(readFileSync(act, 'utf8'))
    if (a.changed) writeFileSync(act, a.src)
    console.log(a.changed ? 'MainActivity: keep-screen-on added' : (a.reason ?? 'MainActivity: keep-screen-on already present'))
  }
  if (dryPatch) return

  run('npx cap sync android')
  run(process.platform === 'win32' ? 'gradlew.bat assembleDebug' : './gradlew assembleDebug', { cwd: ANDROID })
  const apk = join(ANDROID, 'app/build/outputs/apk/debug/app-debug.apk')
  console.log(`\nAPK: ${apk}\nInstall on the phone (USB debugging on):  adb install -r "${apk}"`)
  console.log(api ? `Backend baked in: ${api} (change it in the app: Sensor feed -> Server)` : 'Backend: set it in the app (Sensor feed -> Server), e.g. http://<laptop LAN IP>:8000')
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main()
