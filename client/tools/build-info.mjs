// Written after `npm run build:prod`: records HOW the production build was made, so the preflight can prove it is the same-origin build without the
// developer tools (a bundle cannot be inspected for a build flag reliably, the file can). `npm run build` (the development build) does not write it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
if (!fs.existsSync(dist)) throw new Error(`no ${dist}: the build did not run`)
const info = {
  built_at: new Date().toISOString(),
  demo_tools: process.env.VITE_DEMO_TOOLS === '1',
  api_url: process.env.VITE_API_URL || null,
}
fs.writeFileSync(path.join(dist, 'build-info.json'), JSON.stringify(info, null, 2) + '\n')
console.log('build-info.json:', JSON.stringify(info))
