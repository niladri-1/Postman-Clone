/**
 * Generates the Postmaster app icon entirely procedurally — no external
 * assets, no dependencies. The icon is original work authored for this
 * project (MIT, like the rest) — zero third-party copyright.
 *
 * Design (transparent, no background): the envelope itself is the logo
 * silhouette — a white letter with a blue gradient closed flap, a thin
 * gradient outline (reads on light *and* dark taskbars), and the app's
 * green send-dot bottom-right. Rendered at 3x supersampling for clean
 * edges at 16 px taskbar size.
 *
 * Outputs: build/icon.svg (master), build/icon.ico (all sizes), build/icon.png (256).
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
mkdirSync(buildDir, { recursive: true })

const S = 256 // logical render size

/* straight-alpha blend: dst color, src color, alpha 0..1 */
function blend(dst, src, a) {
  return [
    dst[0] * (1 - a) + src[0] * a,
    dst[1] * (1 - a) + src[1] * a,
    dst[2] * (1 - a) + src[2] * a,
  ]
}

/* rounded-rect signed distance */
function sdRoundRect(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - (hx - r)
  const qy = Math.abs(py - cy) - (hy - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

const clamp01 = (v) => Math.min(1, Math.max(0, v))
/* coverage 0..1 across ~1.4px edge of the SDF */
function coverage(d, edgePx = 1.4) {
  return clamp01(0.5 - d / edgePx)
}
function mixColor(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/* color of one logical point (x, y) — straight RGBA out, transparent base */
function sample(x, y) {
  // premultiplied accumulator: layers painted back-to-front isn't needed —
  // each glyph layer simply paints over what's beneath it.
  const pm = [0, 0, 0, 0] // r, g, b, a (a normalized 0..1)
  const put = (src, a) => {
    if (a <= 0) return
    pm[0] = pm[0] * (1 - a) + src[0] * a
    pm[1] = pm[1] * (1 - a) + src[1] * a
    pm[2] = pm[2] * (1 - a) + src[2] * a
    pm[3] = pm[3] * (1 - a) + a
  }

  // envelope: white rounded rect, outlined in the gradient blue
  const envW = S * 0.78
  const envH = S * 0.56
  const ec = S / 2
  const ey = S * 0.44
  const envD = sdRoundRect(x, y, ec, ey, envW / 2, envH / 2, 20)
  const t = clamp01(y / S)
  const grad = mixColor([46, 131, 255], [10, 73, 179], t) // #2e83ff → #0a49b3

  const envA = coverage(envD)
  if (envA > 0) {
    // 1. gradient-blue fill (also serves as the outline color)
    put(grad, envA)
    // 2. white letter, inset by the outline width → visible ring on light taskbars
    const innerA = coverage(envD + 6) // 6px gradient outline around the white body
    put([255, 255, 255], innerA)
    // 3. closed flap: gradient triangle top-left → apex → top-right, inset too
    const x0 = ec - envW / 2 + 6
    const x1 = ec + envW / 2 - 6
    const y0 = ey - envH / 2 + 6
    const apexY = y0 + (envH - 12) * 0.58
    const sLeft = (apexY - y0) / (ec - x0)
    const sRight = (apexY - y0) / (x1 - ec)
    const onLeft = y0 + sLeft * (x - x0)
    const onRight = y0 + sRight * (x - x1)
    if (x >= x0 && x <= x1 && y >= onLeft && y >= onRight) put(grad, innerA)
  }

  // green send-dot bottom-right, gap ring in deep blue (separates from white envelope)
  const dotX = S * 0.82
  const dotY = S * 0.795
  const dotR = S * 0.1
  const d = Math.hypot(x - dotX, y - dotY)
  put([10, 73, 179], coverage(d - (dotR + 5))) // #0a49b3 gap disc (painted first)
  put([40, 181, 121], coverage(d - dotR)) // #28b579 dot on top

  // un-premultiply
  const A = pm[3]
  if (A <= 0.001) return [0, 0, 0, 0]
  return [pm[0] / A, pm[1] / A, pm[2] / A, A * 255]
}

/** Render size n with 3x supersampling; returns RGBA Uint8Array (straight alpha). */
function render(n) {
  const out = new Uint8Array(n * n * 4)
  const scale = S / n
  for (let py = 0; py < n; py++) {
    for (let px = 0; px < n; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const c = sample(((px * 3 + sx) + 0.5) * (scale / 3), ((py * 3 + sy) + 0.5) * (scale / 3))
          // alpha-weight the color so partially covered edge pixels average correctly
          const w = c[3] / 255
          r += c[0] * w; g += c[1] * w; b += c[2] * w; a += c[3]
        }
      }
      const A = a / 9
      const i = (py * n + px) * 4
      if (A > 0) {
        const wsum = a / 255 // weight total
        out[i] = Math.round(r / wsum)
        out[i + 1] = Math.round(g / wsum)
        out[i + 2] = Math.round(b / wsum)
        out[i + 3] = Math.round(A)
      }
    }
  }
  return out
}

// --- png ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
const crc32 = (buf) => {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let row = 0; row < size; row++) {
    raw[row * (size * 4 + 1)] = 0 // filter none
    Buffer.from(rgba.buffer, row * size * 4, size * 4).copy(raw, row * (size * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- ico ---------------------------------------------------------------------

function buildIco(sizes) {
  const images = sizes.map((s) => ({ s, png: encodePng(s, render(s)) }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  const entries = Buffer.alloc(16 * images.length)
  let offset = 6 + entries.length
  images.forEach((im, i) => {
    const e = entries.subarray(i * 16)
    e[0] = im.s === 256 ? 0 : im.s
    e[1] = im.s === 256 ? 0 : im.s
    e[4] = 1 // planes
    e[6] = 32 // bpp
    e.writeUInt32LE(im.png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += im.png.length
  })
  return Buffer.concat([header, entries, ...images.map((im) => im.png)])
}

// --- write -------------------------------------------------------------------

const sizes = [16, 24, 32, 48, 64, 96, 128, 256]
writeFileSync(join(buildDir, 'icon.ico'), buildIco(sizes))
writeFileSync(join(buildDir, 'icon.png'), encodePng(256, render(256)))

// master SVG twin for future edits (same geometry as the raster)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2e83ff"/><stop offset="1" stop-color="#0a49b3"/>
    </linearGradient>
  </defs>
  <rect x="38.8" y="47.7" width="178.4" height="128.2" rx="20" fill="url(#g)"/>
  <rect x="44.8" y="53.7" width="166.4" height="116.2" rx="14" fill="#ffffff"/>
  <path d="M44.8 53.7 H211.2 L128 123.2 Z" fill="url(#g)"/>
  <circle cx="209.9" cy="203.5" r="30.7" fill="#0a49b3"/>
  <circle cx="209.9" cy="203.5" r="25.6" fill="#28b579"/>
</svg>`
writeFileSync(join(buildDir, 'icon.svg'), svg)
console.log('icon generated: build/icon.ico + build/icon.png + build/icon.svg')
