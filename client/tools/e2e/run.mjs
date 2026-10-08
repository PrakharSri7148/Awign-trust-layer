// One command for the whole end-to-end suite:  cd client && npm run e2e [scenario]
//   1. builds the fake-camera streams,
//   2. starts an ISOLATED backend (temp DB + uploads, 127.0.0.1:8001) and a separate Vite (127.0.0.1:5173, own cache dir,
//      VITE_API_URL pointing at that backend),
//   3. runs tools/e2e/hud-e2e.mjs (all scenarios, or the one you name),
//   4. prints the summary and tears everything down.
// It REFUSES to run if a port it needs is already taken (never reuses, never touches the servers you work on: 8000 / 5174)
// or if the API URL is not a loopback address on a port other than 8000.
// Env: E2E_API_PORT (8001), E2E_WEB_PORT (5173), CHROME (path to Chrome).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const client = path.resolve(here, '../..')
const backend = path.resolve(client, '../backend')
const API_PORT = Number(process.env.E2E_API_PORT ?? 8001)
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173)
const API = `http://127.0.0.1:${API_PORT}`
const WEB = `http://127.0.0.1:${WEB_PORT}/`
const only = process.argv[2]

// --- safety: never the real servers ---
if ([8000, 5174].includes(API_PORT) || [8000, 5174].includes(WEB_PORT)) throw new Error('refusing to use 8000 / 5174: those are the servers you work on')
const busy = (port) => new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true) }); s.on('error', () => res(false)) })
for (const [name, port] of [['backend', API_PORT], ['web', WEB_PORT]]) {
  if (await busy(port)) { console.error(`port ${port} (${name}) is already in use: stop whatever is there (not your 8000 / 5174 servers) or set E2E_${name === 'web' ? 'WEB' : 'API'}_PORT`); process.exit(2) }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'))
const children = []
const start = (cmd, args, opts, log) => { const out = fs.openSync(path.join(tmp, log), 'a'); const c = spawn(cmd, args, { ...opts, stdio: ['ignore', out, out] }); children.push(c); return c }
let done = false
const cleanup = () => { if (done) return; done = true; try { const keep = process.env.E2E_SHOTS; if (keep) for (const f of ['backend.log', 'vite.log']) fs.copyFileSync(path.join(tmp, f), path.join(keep, `e2e-${f}`)) } catch {} for (const c of children) { try { c.kill('SIGTERM') } catch {} } try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {} }
for (const sig of ['SIGINT', 'SIGTERM', 'exit']) process.on(sig, () => { cleanup(); if (sig !== 'exit') process.exit(130) })

const waitFor = async (url, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok) return } catch {} await new Promise((r) => setTimeout(r, 400)) } throw new Error(`timed out waiting for ${url} (logs in ${tmp})`) }
const run = (cmd, args, env = {}) => new Promise((res) => { const c = spawn(cmd, args, { cwd: client, env: { ...process.env, ...env }, stdio: 'inherit' }); c.on('exit', (code) => res(code ?? 1)) })

try {
  console.log(`[e2e] scratch dir ${tmp}`)
  console.log('[e2e] building fake-camera streams ...')
  if ((await run('node', ['tools/e2e/mkstreams.mjs', path.join(tmp, 'cams')])) !== 0) throw new Error('mkstreams failed')

  console.log(`[e2e] starting the isolated backend on ${API} (temp DB, temp uploads) ...`)
  fs.mkdirSync(path.join(tmp, 'uploads'))
  start(path.join(backend, '.venv/bin/uvicorn'), ['main:app', '--host', '127.0.0.1', '--port', String(API_PORT)], { cwd: backend, env: { ...process.env, TRUST_LAYER_DB: path.join(tmp, 'e2e.db'), PHOTO_DIR: path.join(tmp, 'uploads'), TRUSTED_PROXY_HEADER: process.env.TRUSTED_PROXY_HEADER ?? 'x-forwarded-for' } }, 'backend.log')
  await waitFor(`${API}/submissions`)

  // A Vite config that re-exports the app's own and moves the cache + host/port, so it never shares state with your dev server.
  const cfg = path.join(tmp, 'vite.e2e.config.js')
  fs.writeFileSync(cfg, `import { mergeConfig } from ${JSON.stringify(path.join(client, 'node_modules/vite/dist/node/index.js'))}
import base from ${JSON.stringify(path.join(client, 'vite.config.js'))}
export default mergeConfig(base, { root: ${JSON.stringify(client)}, cacheDir: ${JSON.stringify(path.join(tmp, 'vitecache'))}, server: { host: '127.0.0.1', port: ${WEB_PORT}, strictPort: true } })
`)
  console.log(`[e2e] starting Vite on ${WEB} with VITE_API_URL=${API} ...`)
  start(path.join(client, 'node_modules/.bin/vite'), ['--config', cfg], { cwd: client, env: { ...process.env, VITE_API_URL: API } }, 'vite.log')
  await waitFor(WEB)

  console.log(`[e2e] running ${only ? `scenario "${only}"` : 'all scenarios'} ...\n`)
  const code = await run('node', ['tools/e2e/hud-e2e.mjs', path.join(tmp, 'cams'), ...(only ? [only] : [])], { E2E_URL: WEB, E2E_API: API, E2E_SHOTS: process.env.E2E_SHOTS ?? tmp })
  console.log(code === 0 ? '\n[e2e] PASSED' : `\n[e2e] FAILED (exit ${code}); server logs were in ${tmp} (removed on exit; re-run with the scenario name to dig in)`)
  cleanup()
  process.exit(code)
} catch (e) {
  console.error(`[e2e] ${e.message}`)
  cleanup()
  process.exit(1)
}
