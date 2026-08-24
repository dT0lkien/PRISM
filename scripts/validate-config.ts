/* Проверка генератора конфига живым бинарём sing-box.
   Запуск: node scripts/run-validate.mjs */

import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseSubscriptionBody } from '../src/main/subs'
import { buildConfig } from '../src/shared/config-builder'
import { DEFAULT_SETTINGS, DEFAULT_ENABLED_PRESETS } from '../src/shared/defaults'
import { parseLink, parsedToNode } from '../src/shared/parsers'
import { PRESETS } from '../src/shared/presets'
import { RULE_SETS } from '../src/shared/rulesets'
import type { Settings, ServerNode } from '../src/shared/types'

const ROOT = process.cwd()
const BIN = join(ROOT, 'resources/core/mac/sing-box')
const RULES = join(ROOT, 'resources/rules')
const TMP = mkdtempSync(join(tmpdir(), 'prism-'))

const LINKS = [
  'vless://11111111-2222-3333-4444-555555555555@example.com:443?type=tcp&security=reality&pbk=VXFVG7CC-NQrdWhsTwvc830w5RpYGbFXb_4tgNTB2Dg&fp=chrome&sni=www.microsoft.com&sid=ab12&flow=xtls-rprx-vision#Reality%20TCP',
  'vless://11111111-2222-3333-4444-555555555555@example.com:443?type=ws&security=tls&sni=cdn.example.com&host=cdn.example.com&path=%2Fws%3Fed%3D2048#VLESS%20WS',
  'vmess://eyJ2IjoiMiIsInBzIjoiVk1lc3MgV1MiLCJhZGQiOiJleGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjExMTExMTExLTIyMjItMzMzMy00NDQ0LTU1NTU1NTU1NTU1NSIsImFpZCI6IjAiLCJzY3kiOiJhdXRvIiwibmV0Ijoid3MiLCJ0eXBlIjoibm9uZSIsImhvc3QiOiJjZG4uZXhhbXBsZS5jb20iLCJwYXRoIjoiL3ZtIiwidGxzIjoidGxzIn0=',
  'trojan://hunter2@example.com:443?security=tls&sni=example.com&type=grpc&serviceName=grpcsvc#Trojan%20gRPC',
  'ss://YWVzLTI1Ni1nY206aHVudGVyMg==@example.com:8388#SS',
  'hy2://hunter2@example.com:443?sni=example.com&obfs=salamander&obfs-password=abc#Hysteria2',
  'tuic://11111111-2222-3333-4444-555555555555:hunter2@example.com:443?congestion_control=bbr&alpn=h3&sni=example.com#TUIC',
  'anytls://hunter2@example.com:8443?sni=example.com#AnyTLS'
]

function check(name: string, cfg: unknown): boolean {
  const f = join(TMP, `${name.replace(/\W+/g, '_')}.json`)
  writeFileSync(f, JSON.stringify(cfg, null, 2))
  try {
    execFileSync(BIN, ['check', '-c', f], { stdio: 'pipe' })
    console.log(`  ✅ ${name}`)
    return true
  } catch (e: any) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim()
    console.log(`  ❌ ${name}\n     ${out.split('\n').slice(0, 4).join('\n     ')}`)
    console.log(`     конфиг: ${f}`)
    return false
  }
}

let pass = 0
let fail = 0
const tally = (ok: boolean) => (ok ? pass++ : fail++)

/* 1. Парсинг ссылок */
console.log('\n▸ Парсинг ссылок')
const nodes: ServerNode[] = []
for (const link of LINKS) {
  const p = parseLink(link)
  if (!p) {
    console.log(`  ❌ не распарсилось: ${link.slice(0, 50)}`)
    fail++
    continue
  }
  nodes.push(parsedToNode(p, { link }))
  console.log(`  ✅ ${p.type.padEnd(12)} ${p.name}`)
  pass++
}

/* 2. Каждый узел по отдельности — чтобы поймать кривой outbound */
console.log('\n▸ Отдельные outbound')
for (const n of nodes) {
  tally(
    check(`ob-${n.type}-${n.name}`, {
      log: { level: 'error' },
      outbounds: [{ ...n.outbound, tag: 'out' }],
      route: { final: 'out', default_domain_resolver: { server: 'd' } },
      dns: { servers: [{ type: 'udp', tag: 'd', server: '1.1.1.1' }] }
    })
  )
}

/* 3. Полный конфиг во всех сочетаниях режимов */
console.log('\n▸ Полные конфиги')
const base = (o: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  ...o,
  tun: { ...DEFAULT_SETTINGS.tun, ...(o.tun ?? {}) },
  dns: { ...DEFAULT_SETTINGS.dns, ...(o.dns ?? {}) }
})

const build = (settings: Settings, extra: Partial<Parameters<typeof buildConfig>[0]> = {}) =>
  buildConfig({
    settings,
    nodes,
    activeNodeId: nodes[0]?.id,
    appRules: [
      { id: '1', exe: 'Discord.exe', name: 'Discord', action: 'proxy', enabled: true },
      { id: '2', exe: 'steam.exe', name: 'Steam', action: 'direct', enabled: true },
      { id: '3', exe: 'BadApp.exe', name: 'Bad', action: 'block', enabled: true }
    ],
    customRules: [
      {
        id: 'c1',
        name: 'test',
        enabled: true,
        action: 'proxy',
        matchers: [
          { kind: 'domain_suffix', values: ['example.org'] },
          { kind: 'ip_cidr', values: ['1.2.3.0/24'] },
          { kind: 'port_range', values: ['5000:6000'] },
          { kind: 'network', values: ['udp'] }
        ]
      }
    ],
    enabledPresets: DEFAULT_ENABLED_PRESETS,
    rulesDir: RULES,
    cachePath: join(TMP, 'cache.db'),
    clashSecret: 'secret123',
    ...extra
  })

for (const capture of ['tun', 'proxy'] as const) {
  for (const routing of ['global', 'smart', 'whitelist', 'direct'] as const) {
    tally(check(`${capture}-${routing}`, build(base({ captureMode: capture, routingMode: routing }))))
  }
}

tally(check('fakeip', build(base({ dns: { ...DEFAULT_SETTINGS.dns, fakeIp: true } }))))
tally(check('block-ads', build(base({ dns: { ...DEFAULT_SETTINGS.dns, blockAds: true } }))))
tally(check('no-quic-block', build(base({ blockQuic: false }))))
tally(check('gvisor', build(base({ tun: { ...DEFAULT_SETTINGS.tun, stack: 'gvisor', ipv6: true } }))))
tally(check('system-stack', build(base({ tun: { ...DEFAULT_SETTINGS.tun, stack: 'system' } }))))
tally(check('dns-dot', build(base({ dns: { ...DEFAULT_SETTINGS.dns, remote: 'tls://1.1.1.1', local: 'local' } }))))
tally(check('dns-plain', build(base({ dns: { ...DEFAULT_SETTINGS.dns, remote: '8.8.8.8', local: 'dhcp://auto' } }))))
tally(check('all-presets', build(base(), { enabledPresets: PRESETS.map((p) => p.id) })))
tally(check('no-nodes', build(base(), { nodes: [], activeNodeId: undefined })))
tally(
  check(
    'extra-config',
    build(base({ extraConfig: JSON.stringify({ log: { level: 'debug' }, experimental: { clash_api: { external_ui: '' } } }) }))
  )
)

/* 4. Все rule-set подключаются */
console.log('\n▸ Все rule-set разом')
tally(
  check('every-ruleset', {
    log: { level: 'error' },
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: {
      rules: RULE_SETS.map((rs) => ({ rule_set: [rs.tag], outbound: 'direct' })),
      rule_set: RULE_SETS.map((rs) => ({
        type: 'local',
        tag: rs.tag,
        format: 'binary',
        path: join(RULES, `${rs.tag}.srs`)
      })),
      final: 'direct',
      default_domain_resolver: { server: 'd' }
    },
    dns: { servers: [{ type: 'udp', tag: 'd', server: '1.1.1.1' }] }
  })
)

/* 5. Разбор подписки: белый список типов outbound.
   Ветка sing-box JSON переносит outbound в конфиг ядра как есть, поэтому список
   в subs.ts — единственное, что отделяет враждебный сервер подписки от запуска
   произвольного бинарника: у типа `tor` ядро исполняет executable_path с
   extra_args, а в TUN-режиме ядро работает с правами администратора. Конфиг с
   таким outbound проходит `sing-box check`, так что проверками генератора выше
   это не ловится — нужен отдельный тест на самом разборе. */
console.log('\n▸ Разбор подписки')

const expect = (name: string, ok: boolean, detail: string) => {
  console.log(ok ? `  ✅ ${name}` : `  ❌ ${name}\n     получено: ${detail}`)
  tally(ok)
}

const torOnly = parseSubscriptionBody(
  JSON.stringify({
    outbounds: [{ type: 'tor', tag: 'pwn', executable_path: '/usr/bin/touch', extra_args: ['/tmp/prism-pwned'] }]
  })
)
expect('tor-outbound отброшен', torOnly.length === 0, `узлов ${torOnly.length}`)

const legit = parseSubscriptionBody(
  JSON.stringify({
    outbounds: [
      { type: 'vless', tag: 'Legit', server: 'example.com', server_port: 443, uuid: '11111111-2222-3333-4444-555555555555' }
    ]
  })
)
expect(
  'легитимный vless принят',
  legit.length === 1 && legit[0].type === 'vless' && legit[0].server === 'example.com',
  `узлов ${legit.length}, type ${legit[0]?.type}, server ${legit[0]?.server}`
)

const mixed = parseSubscriptionBody(
  JSON.stringify({
    outbounds: [
      { type: 'tor', tag: 'pwn', executable_path: '/usr/bin/touch' },
      { type: 'trojan', tag: 'Good', server: 'example.com', server_port: 443, password: 'hunter2' }
    ]
  })
)
expect(
  'из смеси tor+trojan остался только trojan',
  mixed.length === 1 && mixed[0].type === 'trojan',
  `узлов ${mixed.length}, типы [${mixed.map((n) => n.type).join(', ')}]`
)

console.log(`\n${fail === 0 ? '✅' : '❌'} итог: ${pass} ок, ${fail} провалено\n`)
process.exit(fail === 0 ? 0 : 1)
