// P7 rehearsal runner:  cd client && npm run e2e:public [pub_basics|pub_cases|pub_screens]
//   1. builds the PRODUCTION client (npm run build:prod: same-origin /api, no developer tools, no third-party requests),
//   2. starts an ISOLATED backend in PUBLIC_MODE=1 on 127.0.0.1:8003 that serves that build (temp database, temp photos, a random dashboard token that
//      only lives in this process and the child's environment: it is never printed or written),
//   3. runs the pub_* scenarios of hud-e2e.mjs in headless Chrome against http://127.0.0.1:8003/ (127.0.0.1 is a secure context, so location, motion and
//      camera work as on the phone), then tears everything down.
// It REFUSES to run if the port is busy or if asked for 8000 / 5174 (your development servers). The real DB-IP files are used (GEOIP_DIR / default).
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const client = path.resolve(here, '../..')
const backend = path.resolve(client, '../backend')
const PORT = Number(process.env.E2E_PUBLIC_PORT ?? 8003)
const only = process.argv[2] ?? 'pub'
if ([8000, 5174, 8001, 5173].includes(PORT)) throw new Error('refusing to use 8000 / 5174 (your development servers) or 8001 / 5173 (the other harness)')
const busy = (port) => new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true) }); s.on('error', () => res(false)) })
if (await busy(PORT)) { console.error(`port ${PORT} is already in use: stop whatever is there or set E2E_PUBLIC_PORT`); process.exit(2) }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-public-'))
const children = []
let done = false
const cleanup = () => { if (done) return; done = true; for (const c of children) { try { c.kill('SIGTERM') } catch {} } try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {} }
for (const sig of ['SIGINT', 'SIGTERM', 'exit']) process.on(sig, () => { cleanup(); if (sig !== 'exit') process.exit(130) })
const run = (cmd, args, env = {}) => new Promise((res) => { const c = spawn(cmd, args, { cwd: client, env: { ...process.env, ...env }, stdio: 'inherit' }); c.on('exit', (code) => res(code ?? 1)) })
const waitFor = async (url, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok) return } catch {} await new Promise((r) => setTimeout(r, 400)) } throw new Error(`timed out waiting for ${url}`) }

try {
  console.log('[public] building the production client (npm run build:prod) ...')
  if ((await run('npm', ['run', 'build:prod'])) !== 0) throw new Error('build:prod failed')
  console.log('[public] building the fake-camera streams ...')
  if ((await run('node', ['tools/e2e/mkstreams.mjs', path.join(tmp, 'cams')])) !== 0) throw new Error('mkstreams failed')
  const token = crypto.randomBytes(18).toString('base64url') // lives only in memory and in the child's environment
  fs.mkdirSync(path.join(tmp, 'uploads'))
  const log = fs.openSync(path.join(tmp, 'backend.log'), 'a')
  console.log(`[public] starting the isolated backend on 127.0.0.1:${PORT} in PUBLIC_MODE=1 serving client/dist (temp DB, temp photos) ...`)
  const srv = spawn(path.join(backend, '.venv/bin/uvicorn'), ['main:app', '--host', '127.0.0.1', '--port', String(PORT), '--no-access-log'], {
    cwd: backend, stdio: ['ignore', log, log],
    env: { ...process.env, PUBLIC_MODE: '1', DASHBOARD_TOKEN: token, TRUSTED_PROXY_HEADER: 'x-forwarded-for', TRUST_LAYER_DB: path.join(tmp, 'rehearsal.db'), PHOTO_DIR: path.join(tmp, 'uploads'), ENV_CHECK: '1', CLIENT_DIST: path.join(client, 'dist') },
  })
  children.push(srv)
  srv.on('exit', (code) => { if (!done) console.error(`[public] the backend exited early (code ${code}); log: ${path.join(tmp, 'backend.log')}`) })
  await waitFor(`http://127.0.0.1:${PORT}/health`)
  console.log(`[public] running "${only}" against http://127.0.0.1:${PORT}/ ...\n`)
  const code = await run('node', ['tools/e2e/hud-e2e.mjs', path.join(tmp, 'cams'), only], {
    E2E_URL: `http://127.0.0.1:${PORT}/`, E2E_API: `http://127.0.0.1:${PORT}/api`, E2E_TOKEN: token, E2E_SHOTS: process.env.E2E_SHOTS ?? tmp,
  })
  if (code !== 0) { try { process.stdout.write('\n[public] last backend log lines (the log is redacted: no IPs, no tokens):\n' + fs.readFileSync(path.join(tmp, 'backend.log'), 'utf8').split('\n').slice(-15).join('\n') + '\n') } catch {} }
  console.log(code === 0 ? '\n[public] PASSED' : `\n[public] FAILED (exit ${code})`)
  cleanup()
  process.exit(code)
} catch (e) {
  console.error(`[public] ${e.message}`)
  cleanup()
  process.exit(1)
}
