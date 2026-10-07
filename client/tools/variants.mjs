// Degraded variants of one real photograph: used by the parity and calibration tools.
import { createCanvas, loadImage } from '@napi-rs/canvas'
import fs from 'node:fs'
import { addNoise, adjust, boxBlur, mapChannels, motionBlur, paintDisc, paintRect, toRgba } from '../src/lib/photoQuality/testing/synth.js'

export async function makeVariants(file, W = 1600, H = 900) {
  const img = await loadImage(fs.readFileSync(file))
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H)
  const base = new Uint8ClampedArray(x.getImageData(0, 0, W, H).data)
  const resize = (rgba, w, h, nw, nh) => { const a = createCanvas(w, h); const ax = a.getContext('2d'); const id = ax.createImageData(w, h); id.data.set(rgba); ax.putImageData(id, 0, 0); const b = createCanvas(nw, nh); const bx = b.getContext('2d'); bx.imageSmoothingQuality = 'high'; bx.drawImage(a, 0, 0, nw, nh); return new Uint8ClampedArray(bx.getImageData(0, 0, nw, nh).data) }
  const V = {}
  const J = (rgba, q = 92, w = W, h = H) => ({ rgba, w, h, q })
  V.orig = J(base)
  for (const r of [1, 2, 4]) V[`blur r${r}`] = J(mapChannels(base, W, H, (g) => boxBlur(g, W, H, r, 2)))
  V['motion 15'] = J(mapChannels(base, W, H, (g) => motionBlur(g, W, H, 15, 0.2)))
  V['dark x0.3'] = J(mapChannels(base, W, H, (g) => adjust(g, 0.3, 0)))
  V['dark x0.12'] = J(mapChannels(base, W, H, (g) => adjust(g, 0.12, 0)))
  V['over x1.6+50'] = J(mapChannels(base, W, H, (g) => adjust(g, 1.6, 50)))
  V['over x2+90'] = J(mapChannels(base, W, H, (g) => adjust(g, 2, 90)))
  V['noise s6'] = J(mapChannels(base, W, H, (g, ch) => addNoise(g, 6, 11 + ch)))
  V['noise s12'] = J(mapChannels(base, W, H, (g, ch) => addNoise(g, 12, 11 + ch)))
  V['dark+noise s10'] = J(mapChannels(base, W, H, (g, ch) => addNoise(adjust(g, 0.3, 0), 10, 5 + ch)))
  for (const q of [60, 30, 12]) V[`jpeg q${q}`] = J(base, q)
  V['small 800x450'] = J(resize(base, W, H, 800, 450), 92, 800, 450)
  V['small 640x360'] = J(resize(base, W, H, 640, 360), 92, 640, 360)
  V['small 400x225'] = J(resize(base, W, H, 400, 225), 92, 400, 225)
  V['upscaled 400->1600'] = J(resize(resize(base, W, H, 400, 225), 400, 225, W, H))
  V['upscaled 800->1600'] = J(resize(resize(base, W, H, 800, 450), 800, 450, W, H))
  const cov = (fn) => { const a = new Uint8ClampedArray(base); fn(a); return J(a) }
  V['finger corner'] = cov((a) => paintDisc(a, W, H, W * 0.9, H * 1.0, H * 0.55, [205, 140, 115], { soft: 0.2 }))
  V['dark corner 20%'] = cov((a) => paintRect(a, W, H, 0, 0, W * 0.45, H * 0.45, [8, 8, 8]))
  V['dark half'] = cov((a) => paintRect(a, W, H, 0, 0, W * 0.5, H, [10, 10, 12]))
  V['full black'] = cov((a) => paintRect(a, W, H, 0, 0, W, H, [6, 6, 6]))
  V['finger full'] = cov((a) => paintRect(a, W, H, 0, 0, W, H, [190, 120, 100]))
  V['plain white wall'] = J(toRgba(new Float32Array(W * H).map((_, i) => 225 + 6 * (i % W) / W)))
  V['sky gradient top'] = cov((a) => paintRect(a, W, H, 0, 0, W, H * 0.4, [150, 190, 235]))
  V['glare soft 6%'] = cov((a) => paintDisc(a, W, H, W * 0.7, H * 0.3, H * 0.28, [255, 255, 255], { soft: 0.7 }))
  V['glare soft 2.5%'] = cov((a) => paintDisc(a, W, H, W * 0.3, H * 0.6, H * 0.17, [255, 255, 255], { soft: 0.7 }))
  V['glare 2 spots'] = cov((a) => { paintDisc(a, W, H, W * 0.2, H * 0.3, H * 0.2, [255, 255, 250], { soft: 0.6 }); paintDisc(a, W, H, W * 0.75, H * 0.7, H * 0.15, [255, 255, 250], { soft: 0.6 }) })
  V['white poster hard'] = cov((a) => paintRect(a, W, H, W * 0.55, H * 0.2, W * 0.85, H * 0.6, [255, 255, 255]))
  V['white poster small'] = cov((a) => paintRect(a, W, H, W * 0.55, H * 0.2, W * 0.65, H * 0.4, [255, 255, 255]))
  V['window overexp'] = cov((a) => { paintRect(a, W, H, W * 0.5, H * 0.1, W * 0.9, H * 0.5, [255, 255, 255]); })
  V['shake H 10'] = J(mapChannels(base, W, H, (g) => motionBlur(g, W, H, 10, 0)))
  V['shake V 10'] = J(mapChannels(base, W, H, (g) => motionBlur(g, W, H, 10, Math.PI / 2)))
  V['shake diag 14'] = J(mapChannels(base, W, H, (g) => motionBlur(g, W, H, 14, Math.PI / 4)))
  V['shake H 5'] = J(mapChannels(base, W, H, (g) => motionBlur(g, W, H, 5, 0)))

  return V
}
