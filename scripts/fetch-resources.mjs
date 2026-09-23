/* Скачивает ядро sing-box и драйвер wintun в resources/core.
   Эти файлы не хранятся в git — 100 МБ бинарников навсегда осели бы в истории.

   Запуск:  node scripts/fetch-resources.mjs [--force] [--rules]
     --force  перекачать, даже если файлы уже на месте
     --rules  заодно обновить списки маршрутизации (geosite/geoip) */

import { inflateRawSync, gunzipSync } from 'node:zlib'
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const SING_BOX = '1.13.15'
const WINTUN = '0.14.1'

/* SHA-256 архивов. Ядро едет в каждый релиз и работает с правами
   администратора (на macOS — root), поэтому скачанное сверяем с суммами,
   которые проверили при смене версии, а не верим сети на слово. Суммы
   sing-box — из поля digest ассетов GitHub, wintun — со страницы wintun.net;
   2026-09-23 обе сверены со скачанными файлами. Новая версия ядра — новые
   суммы здесь, иначе скрипт откажется работать. */
const SHA256 = {
  [`sing-box-${SING_BOX}-windows-amd64.zip`]: '599b296f6e57511d36d2a6f3011aed1a86fa98418578bbb06bd6dc241b5d8877',
  [`sing-box-${SING_BOX}-darwin-arm64.tar.gz`]: '3452d866834c9572389e5ca73e60d4ee45a7d5b79332188c9a9e533c5fd40a6d',
  [`sing-box-${SING_BOX}-darwin-amd64.tar.gz`]: '817e04f90f941b718fedd965ff05bfe72abfcc62952888b01751a6dec5547e14',
  [`sing-box-${SING_BOX}-linux-amd64.tar.gz`]: 'a3a3ff223b23c3f4731d0a17cb0ef94c97ce257c70721a5b07dc7ca079203c9f',
  [`sing-box-${SING_BOX}-linux-arm64.tar.gz`]: 'f0810bbb5722ae36635687c421019defcc8b328d31a0b3c287901f331747ca93',
  [`wintun-${WINTUN}.zip`]: '07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51'
}

const ROOT = process.cwd()
const force = process.argv.includes('--force')
const withRules = process.argv.includes('--rules')

/* ─────────── распаковка без сторонних пакетов ─────────── */

/** Возвращает { полный/путь/внутри/архива: Buffer } для путей, прошедших фильтр */
function unzip(buf, keep) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('не найден конец zip-архива')

  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const out = {}
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)

    if (keep(name)) {
      const lnLen = buf.readUInt16LE(localOff + 26)
      const leLen = buf.readUInt16LE(localOff + 28)
      const dataOff = localOff + 30 + lnLen + leLen
      const raw = buf.subarray(dataOff, dataOff + compSize)
      out[name] = method === 0 ? raw : inflateRawSync(raw)
    }
    off += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function untar(buf, keep) {
  const out = {}
  let off = 0
  while (off + 512 <= buf.length) {
    const name = buf.toString('utf8', off, off + 100).replace(/\0.*$/, '')
    if (!name) break
    const size = parseInt(buf.toString('ascii', off + 124, off + 136).replace(/\0.*$/, '').trim(), 8) || 0
    const type = String.fromCharCode(buf[off + 156])
    const dataOff = off + 512
    if ((type === '0' || type === '\0') && keep(name)) out[name] = buf.subarray(dataOff, dataOff + size)
    off = dataOff + Math.ceil(size / 512) * 512
  }
  return out
}

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Скачать архив и сверить с закреплённой суммой */
async function getPinned(url) {
  const file = url.split('/').pop()
  const want = SHA256[file]
  if (!want) throw new Error(`для ${file} не закреплена SHA-256 — добавьте её в SHA256 в начале скрипта`)
  const data = await get(url)
  const got = createHash('sha256').update(data).digest('hex')
  if (got !== want) throw new Error(`${file}: SHA-256 ${got}, а ожидалась ${want} — файл подменён или повреждён`)
  return data
}

const pick = (files, suffix) => files[Object.keys(files).find((k) => k.endsWith(suffix))]

function save(dir, name, data, exe = false) {
  mkdirSync(dir, { recursive: true })
  const p = join(dir, name)
  writeFileSync(p, data)
  if (exe) chmodSync(p, 0o755)
  console.log(`  ✓ ${name.padEnd(22)} ${(data.length / 1048576).toFixed(1)} МБ`)
}

/* ─────────── ядро для Windows ─────────── */

async function fetchWindows() {
  const dir = join(ROOT, 'resources/core/win')
  if (!force && existsSync(join(dir, 'sing-box.exe')) && existsSync(join(dir, 'wintun.dll'))) {
    console.log('▸ Ядро для Windows уже на месте (--force чтобы перекачать)')
    return
  }

  console.log(`▸ sing-box ${SING_BOX} для Windows`)
  const sb = unzip(
    await getPinned(
      `https://github.com/SagerNet/sing-box/releases/download/v${SING_BOX}/sing-box-${SING_BOX}-windows-amd64.zip`
    ),
    (n) => /\/(sing-box\.exe|libcronet\.dll|LICENSE)$/.test(n)
  )
  const exe = pick(sb, '/sing-box.exe')
  if (!exe) throw new Error('в архиве нет sing-box.exe')
  save(dir, 'sing-box.exe', exe)
  const cronet = pick(sb, '/libcronet.dll')
  if (cronet) save(dir, 'libcronet.dll', cronet)
  // Лицензия ядра обязана ехать вместе с бинарником: sing-box под GPL-3.0
  const sbLic = pick(sb, '/LICENSE')
  if (sbLic) save(dir, 'LICENSE-sing-box.txt', sbLic)

  console.log(`▸ wintun ${WINTUN} (драйвер виртуального адаптера для TUN)`)
  const wt = unzip(
    await getPinned(`https://www.wintun.net/builds/wintun-${WINTUN}.zip`),
    (n) => n === 'wintun/bin/amd64/wintun.dll' || n === 'wintun/LICENSE.txt'
  )
  const dll = wt['wintun/bin/amd64/wintun.dll']
  if (!dll) throw new Error('в архиве wintun нет сборки amd64')
  save(dir, 'wintun.dll', dll)
  if (wt['wintun/LICENSE.txt']) save(dir, 'LICENSE-wintun.txt', wt['wintun/LICENSE.txt'])
}

/* ─────────── ядро под текущую систему (нужно только для тестов) ─────────── */

async function fetchHost() {
  if (process.platform === 'win32') return
  const dir = join(ROOT, 'resources/core/mac')
  if (!force && existsSync(join(dir, 'sing-box'))) {
    console.log('▸ Ядро для текущей системы уже на месте')
    return
  }
  const os = process.platform === 'darwin' ? 'darwin' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  console.log(`▸ sing-box ${SING_BOX} для ${os}-${arch} (для локальных тестов)`)
  try {
    const files = untar(
      gunzipSync(
        await getPinned(
          `https://github.com/SagerNet/sing-box/releases/download/v${SING_BOX}/sing-box-${SING_BOX}-${os}-${arch}.tar.gz`
        )
      ),
      (n) => n.endsWith('/sing-box')
    )
    const bin = pick(files, '/sing-box')
    if (bin) save(dir, 'sing-box', bin, true)
    else console.log('  ⚠ в архиве нет бинарника')
  } catch (e) {
    // Подмену не прощаем: это ядро уезжает и в сборку для macOS
    if (/SHA-256/.test(e.message)) throw e
    console.log(`  ⚠ не удалось: ${e.message}`)
    console.log('    тесты run-validate и run-e2e без него не запустятся')
  }
}

/* ─────────── списки маршрутизации ─────────── */

const GEOSITE = [
  'category-ads-all', 'category-ru', 'tld-ru', 'yandex', 'vk', 'mailru', 'tbank-ru',
  'category-gov-ru', 'category-bank-ru', 'category-media-ru', 'category-ecommerce-ru',
  'discord', 'telegram', 'youtube', 'google', 'meta', 'twitter', 'tiktok', 'netflix',
  'spotify', 'openai', 'twitch', 'github', 'steam', 'epicgames', 'roblox', 'playstation',
  'xbox', 'ea', 'ubisoft', 'nintendo', 'category-games', 'cloudflare', 'apple', 'microsoft',
  'whatsapp', 'signal', 'category-speedtest', 'category-porn', 'rutracker'
]
const GEOIP = ['ru', 'cn']

async function fetchRules() {
  const dir = join(ROOT, 'resources/rules')
  mkdirSync(dir, { recursive: true })
  console.log('▸ Списки маршрутизации')

  const grab = async (url, file) => {
    const data = await get(url).catch(() => null)
    if (!data) {
      console.log(`  ⚠ пропущен ${file}`)
      return 0
    }
    writeFileSync(join(dir, file), data)
    return 1
  }

  let n = 0
  for (const name of GEOSITE) {
    n += await grab(
      `https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-${name}.srs`,
      `geosite-${name}.srs`
    )
  }
  // Кладём без «!» в имени — символ ломает пути в некоторых сборщиках
  n += await grab(
    'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ai-!cn.srs',
    'geosite-category-ai.srs'
  )
  for (const name of GEOIP) {
    n += await grab(
      `https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-${name}.srs`,
      `geoip-${name}.srs`
    )
  }
  console.log(`  ✓ ${n} наборов правил`)
}

/* ─────────── ─────────── */

await fetchWindows()
await fetchHost()
if (withRules) await fetchRules()
console.log('\nГотово. Дальше: npm run build или npm run pack:win')
