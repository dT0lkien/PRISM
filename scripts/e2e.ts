/* Сквозная проверка: поднимаем локальный shadowsocks-сервер тем же ядром,
   заставляем Prism ходить через него и убеждаемся, что трафик реально идёт.
   Запуск: node scripts/run-e2e.mjs */

import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import http from 'node:http'
import { core } from '../src/main/core'
import { store, paths } from '../src/main/store'
import { parseLink, parsedToNode } from '../src/shared/parsers'
import { DEFAULT_ENABLED_PRESETS } from '../src/shared/defaults'
import type { ConnectionItem } from '../src/shared/types'

const TMP = mkdtempSync(join(tmpdir(), 'prism-up-'))
const UP_PORT = 18388
const LOCAL_PORT = 12080
const CLASH_PORT = 19291
const SS = { method: 'aes-128-gcm', password: 'hunter2-e2e-test' }

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  cond ? pass++ : fail++
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Запрос наружу через локальный HTTP-прокси Prism */
function viaProxy(url: string, port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path: url, headers: { Host: new URL(url).host } },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      }
    )
    req.setTimeout(20000, () => req.destroy(new Error('таймаут')))
    req.on('error', reject)
    req.end()
  })
}

async function main(): Promise<void> {
  console.log('\n▸ Поднимаю локальный upstream-сервер')
  const upCfg = {
    log: { level: 'error' },
    inbounds: [
      {
        type: 'shadowsocks',
        tag: 'ss-in',
        listen: '127.0.0.1',
        listen_port: UP_PORT,
        method: SS.method,
        password: SS.password
      }
    ],
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: { final: 'direct', default_domain_resolver: { server: 'd' } },
    dns: { servers: [{ type: 'udp', tag: 'd', server: '1.1.1.1' }] }
  }
  const upFile = join(TMP, 'upstream.json')
  writeFileSync(upFile, JSON.stringify(upCfg, null, 2))

  const upstream: ChildProcess = spawn(paths.core, ['run', '-c', upFile, '-D', TMP], { stdio: 'pipe' })
  let upErr = ''
  upstream.stderr?.on('data', (b) => (upErr += b.toString()))
  await wait(1500)
  ok('upstream запущен', upstream.exitCode === null, upErr.split('\n')[0])
  if (upstream.exitCode !== null) {
    console.log(upErr)
    process.exit(1)
  }

  console.log('\n▸ Настраиваю Prism')
  store.load()
  const link = `ss://${Buffer.from(`${SS.method}:${SS.password}`).toString('base64')}@127.0.0.1:${UP_PORT}#Локальный%20тест`
  const parsed = parseLink(link)
  ok('ссылка разобрана', !!parsed, parsed?.type)
  const node = parsedToNode(parsed!, { link })

  store.patch({ nodes: [node], activeNodeId: node.id, enabledPresets: [...DEFAULT_ENABLED_PRESETS] })
  store.setSettings({
    captureMode: 'proxy', // TUN на macOS требует root — проверяем прокси-путь
    routingMode: 'global',
    localPort: LOCAL_PORT,
    clashPort: CLASH_PORT,
    logLevel: 'info',
    discordFix: true,
    blockQuic: true,
    dns: { ...store.get().settings.dns, splitDns: false }
  })
  store.patch({
    appRules: [
      { id: 'r1', exe: 'Discord.exe', name: 'Discord', action: 'proxy', enabled: true },
      { id: 'r2', exe: 'qbittorrent.exe', name: 'qB', action: 'direct', enabled: true }
    ],
    customRules: [
      {
        id: 'c1',
        name: 'тест',
        enabled: true,
        action: 'proxy',
        matchers: [{ kind: 'domain_suffix', values: ['example.com'] }]
      }
    ]
  })

  const traffic: { up: number; down: number }[] = []
  let conns: ConnectionItem[] = []
  let connEvents = 0
  const logs: string[] = []
  core.on('log', (l: { message: string }) => logs.push(l.message))
  core.clash.on('traffic', (t: { up: number; down: number }) => traffic.push(t))
  core.clash.on('connections', (c: { items: ConnectionItem[] }) => {
    connEvents++
    conns = c.items
  })

  console.log('\n▸ Запуск ядра')
  const started = await core.start()
  ok('ядро стартовало', started.ok, started.error)
  if (!started.ok) {
    console.log(logs.slice(-15).join('\n'))
    upstream.kill()
    process.exit(1)
  }
  ok('статус running', core.getState().status === 'running', core.getState().status)

  console.log('\n▸ Clash API')
  const ver = await core.clash.version().catch(() => null)
  ok('Clash API отвечает', !!ver, ver ? `sing-box ${(ver as any).version}` : '')
  const proxies = await core.clash.proxies().catch(() => ({}))
  ok('селектор proxy существует', 'proxy' in proxies, Object.keys(proxies).slice(0, 6).join(', '))

  console.log('\n▸ Реальный трафик через туннель')
  let res: { status: number; body: string } | null = null
  try {
    res = await viaProxy('http://example.com/', LOCAL_PORT)
  } catch (e) {
    ok('HTTP через прокси', false, String(e))
  }
  if (res) {
    ok('HTTP через прокси', res.status === 200, `код ${res.status}`)
    ok('получен настоящий ответ', /Example Domain/i.test(res.body), `${res.body.length} байт`)
    if (res.status !== 200) {
      console.log('\n  ── журнал ядра ──')
      console.log(logs.slice(-18).map((l) => `  ${l}`).join('\n'))
    }
  }

  // Гоняем ещё немного трафика, чтобы счётчики успели что-то намерить
  for (let i = 0; i < 8; i++) await viaProxy('http://example.com/', LOCAL_PORT).catch(() => null)
  await wait(4000)

  ok('события трафика приходят', traffic.length >= 2, `${traffic.length} замеров`)
  ok(
    'байты посчитаны',
    traffic.some((t) => t.down > 0 || t.up > 0),
    `пик ${Math.max(0, ...traffic.map((t) => t.down))} Б/с вниз`
  )
  ok('события соединений приходят', connEvents > 0, `${connEvents} обновлений, сейчас ${conns.length} активных`)

  console.log('\n▸ Переключение узла на лету')
  const sel = await core.selectNode(node.id)
  ok('selectNode отработал', sel)

  console.log('\n▸ Замер задержки')
  const ms = await core.measure(node.id)
  ok('задержка получена', ms > 0 || ms === -1, `${ms} мс`)

  console.log('\n▸ Остановка')
  await core.stop()
  ok('статус stopped', core.getState().status === 'stopped', core.getState().status)
  await wait(600)
  const stillUp = await viaProxy('http://example.com/', LOCAL_PORT).then(() => true).catch(() => false)
  ok('порт освобождён после стопа', !stillUp)

  upstream.kill()

  const errLogs = logs.filter((l) => /FATAL|PANIC|panic:/i.test(l))
  ok('в журнале нет фатальных ошибок', errLogs.length === 0, errLogs[0] ?? '')

  console.log(`\n${fail === 0 ? '✅' : '❌'} итог: ${pass} ок, ${fail} провалено`)
  console.log(`   конфиг: ${paths.runtimeConfig}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('сорвалось:', e)
  process.exit(1)
})
