/* Генерация иконок Prism без сторонних зависимостей:
   рисуем через SDF со сглаживанием, кодируем PNG вручную, собираем ICO. */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/* ───────────────────── математика фигур ───────────────────── */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const mix = (a, b, t) => a + (b - a) * t
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax
  const pay = py - ay
  const bax = bx - ax
  const bay = by - ay
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1)
  return Math.hypot(pax - bax * h, pay - bay * h)
}

/** Расстояние до контура треугольника (без знака) */
function sdTriangleOutline(px, py, v) {
  return Math.min(
    sdSegment(px, py, v[0][0], v[0][1], v[1][0], v[1][1]),
    sdSegment(px, py, v[1][0], v[1][1], v[2][0], v[2][1]),
    sdSegment(px, py, v[2][0], v[2][1], v[0][0], v[0][1])
  )
}

/** Внутри ли точка треугольника */
function inTriangle(px, py, v) {
  const sign = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy)
  const d1 = sign(px, py, v[0][0], v[0][1], v[1][0], v[1][1])
  const d2 = sign(px, py, v[1][0], v[1][1], v[2][0], v[2][1])
  const d3 = sign(px, py, v[2][0], v[2][1], v[0][0], v[0][1])
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

/* ───────────────────── сама картинка ───────────────────── */

const TRI = [
  [0.5, 0.235],
  [0.238, 0.69],
  [0.762, 0.69]
]
const HIT = [0.396, 0.4225]
const EXIT = [0.662, 0.5225]

const SPECTRUM = [
  ['#FF5468', -0.13],
  ['#FF9A3C', -0.04],
  ['#FFE45C', 0.05],
  ['#49E08A', 0.14],
  ['#38BDF8', 0.23],
  ['#A78BFA', 0.32]
]

/** Возвращает [r,g,b,a] 0..255 для нормализованной точки */
function shade(x, y, opts) {
  const { plate, scale } = opts
  // px — «толщина пикселя» в нормированных единицах, для сглаживания
  const px = 1 / scale
  let r = 0
  let g = 0
  let b = 0
  let a = 0

  const over = (cr, cg, cb, ca) => {
    if (ca <= 0) return
    const na = ca + a * (1 - ca)
    if (na <= 0) return
    r = (cr * ca + r * a * (1 - ca)) / na
    g = (cg * ca + g * a * (1 - ca)) / na
    b = (cb * ca + b * a * (1 - ca)) / na
    a = na
  }
  const add = (cr, cg, cb, ca) => {
    if (ca <= 0) return
    r = clamp(r + cr * ca, 0, 255)
    g = clamp(g + cg * ca, 0, 255)
    b = clamp(b + cb * ca, 0, 255)
    a = clamp(a + ca * 0.35, 0, 1)
  }

  /* подложка */
  if (plate) {
    const d = sdRoundRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.235)
    const cov = 1 - smoothstep(-px, px, d)
    if (cov > 0) {
      const t = clamp((x * 0.45 + y * 0.75), 0, 1)
      const top = hex('#1C2745')
      const bot = hex('#080B14')
      over(mix(top[0], bot[0], t), mix(top[1], bot[1], t), mix(top[2], bot[2], t), cov)
      // мягкое свечение за призмой
      const glow = Math.exp(-(((x - 0.5) ** 2 + (y - 0.5) ** 2) / 0.055))
      add(56, 130, 220, glow * 0.55 * cov)
    }
  }

  const inside = inTriangle(x, y, TRI)
  const dTri = sdTriangleOutline(x, y, TRI)

  /* лёгкая заливка призмы */
  if (inside) {
    const t = clamp((y - 0.235) / 0.455, 0, 1)
    over(mix(120, 60, t), mix(180, 90, t), 255, 0.1)
  }

  /* входящий белый луч */
  {
    const w = 0.019
    const d = sdSegment(x, y, 0.045, HIT[1], HIT[0] + 0.01, HIT[1])
    add(255, 255, 255, (1 - smoothstep(w - px * 1.5, w + px * 1.5, d)) * 0.95)
    add(190, 215, 255, Math.exp(-(d * d) / 0.0009) * 0.5)
  }

  /* луч внутри призмы */
  {
    const w = 0.012
    const d = sdSegment(x, y, HIT[0], HIT[1], EXIT[0], EXIT[1])
    if (inside) add(255, 255, 255, (1 - smoothstep(w - px * 1.5, w + px * 1.5, d)) * 0.8)
  }

  /* расходящийся спектр */
  for (const [color, slope] of SPECTRUM) {
    const [cr, cg, cb] = hex(color)
    const ex = 1.02
    const ey = EXIT[1] + slope * (ex - EXIT[0]) * 2.35
    const w = 0.0155
    const d = sdSegment(x, y, EXIT[0], EXIT[1], ex, ey)
    const beam = 1 - smoothstep(w - px * 1.5, w + px * 1.5, d)
    // луч разгорается по мере удаления от призмы
    const grow = smoothstep(EXIT[0] - 0.01, EXIT[0] + 0.12, x)
    add(cr, cg, cb, beam * grow * 0.95)
    add(cr, cg, cb, Math.exp(-(d * d) / 0.0006) * grow * 0.4)
  }

  /* контур призмы поверх всего */
  {
    const w = 0.0215
    const cov = 1 - smoothstep(w - px * 1.2, w + px * 1.2, dTri)
    if (cov > 0) {
      const t = clamp((y - 0.235) / 0.455, 0, 1)
      const c1 = hex('#8FD8FF')
      const c2 = hex('#B79BFF')
      over(mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t), cov)
    }
    add(140, 200, 255, Math.exp(-(dTri * dTri) / 0.0011) * 0.28)
  }

  return [Math.round(r), Math.round(g), Math.round(b), Math.round(clamp(a, 0, 1) * 255)]
}

/** Упрощённый значок для трея: только контур призмы */
function shadeTray(x, y, on, scale) {
  const px = 1 / scale
  const d = sdTriangleOutline(x, y, TRI)
  const w = 0.045
  const cov = 1 - smoothstep(w - px * 1.2, w + px * 1.2, d)
  const fill = inTriangle(x, y, TRI) ? 0.14 : 0
  const c = on ? hex('#4ADE80') : hex('#94A3B8')
  const a = clamp(cov + fill, 0, 1)
  return [c[0], c[1], c[2], Math.round(a * 255)]
}

function render(size, fn) {
  const buf = Buffer.alloc(size * size * 4)
  const SS = 3 // 3×3 сэмпла на пиксель
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const nx = (pxi + (sx + 0.5) / SS) / size
          const ny = (py + (sy + 0.5) / SS) / size
          const [cr, cg, cb, ca] = fn(nx, ny, size)
          const w = ca / 255
          r += cr * w
          g += cg * w
          b += cb * w
          a += w
        }
      }
      const n = SS * SS
      const o = (py * size + pxi) * 4
      if (a > 0) {
        buf[o] = clamp(Math.round(r / a), 0, 255)
        buf[o + 1] = clamp(Math.round(g / a), 0, 255)
        buf[o + 2] = clamp(Math.round(b / a), 0, 255)
      }
      buf[o + 3] = clamp(Math.round((a / n) * 255), 0, 255)
    }
  }
  return buf
}

/* ───────────────────── кодирование PNG ───────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // бит на канал
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ───────────────────── кодирование ICO ───────────────────── */

/** 32-битный DIB для записи в ICO (Windows ждёт именно такой формат для мелких размеров) */
function encodeDib(rgba, size) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // XOR + AND маска
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(size * size * 4, 20)

  const xor = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4 // снизу вверх
    for (let x = 0; x < size; x++) {
      const s = src + x * 4
      const d = (y * size + x) * 4
      xor[d] = rgba[s + 2] // B
      xor[d + 1] = rgba[s + 1] // G
      xor[d + 2] = rgba[s] // R
      xor[d + 3] = rgba[s + 3] // A
    }
  }
  const andRow = Math.ceil(size / 32) * 4
  const and = Buffer.alloc(andRow * size) // полностью нулевая — прозрачность берётся из альфы
  return Buffer.concat([header, xor, and])
}

function encodeIco(images) {
  const entries = []
  const blobs = []
  let offset = 6 + images.length * 16
  for (const { size, rgba } of images) {
    const data = size >= 256 ? encodePng(rgba, size) : encodeDib(rgba, size)
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4) // плоскости
    e.writeUInt16LE(32, 6) // бит на пиксель
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    blobs.push(data)
    offset += data.length
  }
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  return Buffer.concat([head, ...entries, ...blobs])
}

/* ───────────────────── сборка ───────────────────── */

const ROOT = process.cwd()
mkdirSync(join(ROOT, 'build'), { recursive: true })
mkdirSync(join(ROOT, 'resources/icons'), { recursive: true })

const appShade = (x, y, scale) => shade(x, y, { plate: true, scale })

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoImages = icoSizes.map((size) => ({ size, rgba: render(size, appShade) }))
writeFileSync(join(ROOT, 'build/icon.ico'), encodeIco(icoImages))
console.log('✓ build/icon.ico', icoSizes.join('/'))

const png256 = icoImages.find((i) => i.size === 256).rgba
writeFileSync(join(ROOT, 'resources/icons/icon.png'), encodePng(png256, 256))
writeFileSync(join(ROOT, 'build/icon.png'), encodePng(png256, 256))
console.log('✓ resources/icons/icon.png 256')

for (const [name, on] of [
  ['tray-off.png', false],
  ['tray-on.png', true]
]) {
  const rgba = render(32, (x, y, scale) => shadeTray(x, y, on, scale))
  writeFileSync(join(ROOT, 'resources/icons', name), encodePng(rgba, 32))
  console.log('✓ resources/icons/' + name)
}

// Крупная картинка для экрана «О программе»
writeFileSync(join(ROOT, 'resources/icons/logo.png'), encodePng(render(512, appShade), 512))
console.log('✓ resources/icons/logo.png 512')

// Копия внутрь renderer — vite умеет импортировать только то, что лежит в его корне
mkdirSync(join(ROOT, 'src/renderer/src/assets'), { recursive: true })
writeFileSync(join(ROOT, 'src/renderer/src/assets/logo.png'), encodePng(png256, 256))
console.log('✓ src/renderer/src/assets/logo.png 256')

/* ─────────── icns для macOS ───────────
   Каждый размер рисуем нативно тем же render(), а не растягиваем 256px: у
   иконки есть мелкие детали, и апскейл до 1024 для retina их бы размазал.
   Собираем штатным iconutil — он есть на любом маке. */
if (process.platform === 'darwin') {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')

  const set = join(mkdtempSync(join(tmpdir(), 'prism-icns-')), 'icon.iconset')
  mkdirSync(set, { recursive: true })
  for (const [size, name] of [
    [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png']
  ]) {
    writeFileSync(join(set, name), encodePng(render(size, appShade), size))
  }
  const out = join(ROOT, 'build/icon.icns')
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', set, '-o', out])
  rmSync(join(set, '..'), { recursive: true, force: true })
  console.log('✓ build/icon.icns')
} else {
  console.log('▸ icns собирается только на macOS — пропускаю')
}
