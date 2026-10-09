// Zero-dependency static server with clean routes: / (Capture), /dashboard, /design-system, /frames.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(fileURLToPath(import.meta.url))
const port = +process.env.PORT || 5180
const routes = { '/': 'index.html', '/dashboard': 'dashboard.html', '/design-system': 'design-system.html', '/frames': 'frames.html', '/capture-photo': 'capture-photo/index.html', '/capture-photo/app': 'capture-photo/app.html', '/capture-photo/frames': 'capture-photo/frames.html', '/capture-photo/coverage': 'capture-photo/coverage.html', '/capture-photo/tokens': 'capture-photo/tokens.html', '/capture-scan': 'capture-scan/index.html', '/capture-scan/app': 'capture-scan/app.html', '/capture-scan/frames': 'capture-scan/frames.html', '/capture-scan/coverage': 'capture-scan/coverage.html', '/capture-scan/tokens': 'capture-scan/tokens.html', '/capture-arrival': 'capture-arrival/index.html', '/capture-arrival/app': 'capture-arrival/app.html', '/capture-arrival/frames': 'capture-arrival/frames.html', '/capture-arrival/coverage': 'capture-arrival/coverage.html', '/capture-arrival/tokens': 'capture-arrival/tokens.html', '/capture-verdict': 'capture-verdict/index.html', '/capture-verdict/app': 'capture-verdict/app.html', '/capture-verdict/frames': 'capture-verdict/frames.html', '/capture-verdict/coverage': 'capture-verdict/coverage.html', '/capture-verdict/tokens': 'capture-verdict/tokens.html' }
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json' }
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/capture-photo') { res.writeHead(301, { Location: '/capture-photo/' }); return res.end() }
  if (url.pathname === '/capture-scan') { res.writeHead(301, { Location: '/capture-scan/' }); return res.end() }
  if (url.pathname === '/capture-verdict') { res.writeHead(301, { Location: '/capture-verdict/' }); return res.end() }
  if (url.pathname === '/capture-arrival') { res.writeHead(301, { Location: '/capture-arrival/' }); return res.end() }
  const rel = routes[url.pathname.replace(/\/$/, '') || '/'] || url.pathname.slice(1)
  const file = path.join(root, path.normalize(rel))
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found') }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(res)
}).listen(port, () => console.log(`Trust Layer redesign on http://localhost:${port}`))
