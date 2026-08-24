import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildConfig } from '../src/shared/config-builder'
import { DEFAULT_SETTINGS, DEFAULT_ENABLED_PRESETS } from '../src/shared/defaults'
import { parseLink, parsedToNode } from '../src/shared/parsers'
import { PRESETS } from '../src/shared/presets'
import type { Settings, ServerNode } from '../src/shared/types'

/* Корпус нарочно широкий: белый список ключей выводится из этих конфигов,
   и любая непокрытая опция протокола обернётся тем, что у пользователя не
   поднимется туннель. Схемы и транспорты — все, что понимает parseLink. */
const LINKS = [
  // vless: реальность, транспорты, без TLS
  'vless://11111111-2222-3333-4444-555555555555@example.com:443?type=tcp&security=reality&pbk=VXFVG7CC-NQrdWhsTwvc830w5RpYGbFXb_4tgNTB2Dg&fp=chrome&sni=www.microsoft.com&sid=ab12&flow=xtls-rprx-vision#vless-reality',
  'vless://11111111-2222-3333-4444-555555555555@example.com:443?type=ws&security=tls&sni=c.com&host=c.com&path=%2Fws%3Fed%3D2048#vless-ws',
  'vless://11111111-2222-3333-4444-555555555555@example.com:443?type=grpc&security=tls&sni=c.com&serviceName=gsvc#vless-grpc',
  'vless://11111111-2222-3333-4444-555555555555@example.com:443?type=httpupgrade&security=tls&sni=c.com&host=c.com&path=%2Fup#vless-httpupgrade',
  'vless://11111111-2222-3333-4444-555555555555@example.com:443?type=http&security=tls&sni=c.com&host=c.com&path=%2Fh2#vless-h2',
  'vless://11111111-2222-3333-4444-555555555555@example.com:443?type=quic&security=tls&sni=c.com#vless-quic',
  'vless://11111111-2222-3333-4444-555555555555@example.com:8080?type=tcp&security=none#vless-plain',
  // vmess: ws+tls и голый tcp
  'vmess://eyJ2IjoiMiIsInBzIjoidm1lc3Mtd3MiLCJhZGQiOiJleGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjExMTExMTExLTIyMjItMzMzMy00NDQ0LTU1NTU1NTU1NTU1NSIsImFpZCI6IjAiLCJzY3kiOiJhdXRvIiwibmV0Ijoid3MiLCJ0eXBlIjoibm9uZSIsImhvc3QiOiJjZG4uZXhhbXBsZS5jb20iLCJwYXRoIjoiL3ZtIiwidGxzIjoidGxzIn0=',
  'vmess://eyJ2IjoiMiIsInBzIjoidm1lc3MtdGNwIiwiYWRkIjoiZXhhbXBsZS5jb20iLCJwb3J0IjoiODA4MCIsImlkIjoiMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1IiwiYWlkIjoiMiIsInNjeSI6ImF1dG8iLCJuZXQiOiJ0Y3AiLCJ0eXBlIjoibm9uZSIsInRscyI6IiJ9',
  // trojan
  'trojan://hunter2@example.com:443?security=tls&sni=example.com&type=grpc&serviceName=g#trojan-grpc',
  'trojan://hunter2@example.com:443?security=tls&sni=example.com&type=ws&path=%2Ftj#trojan-ws',
  // shadowsocks: разные методы
  'ss://YWVzLTI1Ni1nY206aHVudGVyMg==@example.com:8388#ss-aes',
  'ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpodW50ZXIy@example.com:8389#ss-chacha',
  // hysteria2: с обфускацией и без — именно этот случай ловил промах
  'hy2://hunter2@example.com:443?sni=example.com&obfs=salamander&obfs-password=abc#hy2-obfs',
  'hy2://hunter2@example.com:443?sni=example.com#hy2-plain',
  'hy2://hunter2@example.com:443?sni=example.com&insecure=1&alpn=h3#hy2-insecure',
  // tuic
  'tuic://11111111-2222-3333-4444-555555555555:hunter2@example.com:443?congestion_control=bbr&alpn=h3&sni=example.com&udp_relay_mode=quic#tuic-bbr',
  'tuic://11111111-2222-3333-4444-555555555555:hunter2@example.com:443?sni=example.com#tuic-plain',
  // anytls
  'anytls://hunter2@example.com:8443?sni=example.com#anytls',
  // socks и http, с авторизацией и без
  'socks5://user:pass@example.com:1080#socks-auth',
  'socks5://example.com:1081#socks-plain',
  'http://user:pass@example.com:8080#http-auth',
  'http://example.com:8081#http-plain'
]
const nodes: ServerNode[] = LINKS.map((l) => {
  const p = parseLink(l)
  if (!p) throw new Error(`ссылка не распарсилась, корпус сломан: ${l.slice(0, 60)}`)
  return parsedToNode(p, { link: l })
})
const ROOT = process.cwd()
const OUT = join(ROOT, 'helper/testdata')
mkdirSync(OUT, { recursive: true })

const base = (o: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS, ...o,
  tun: { ...DEFAULT_SETTINGS.tun, ...(o.tun ?? {}) },
  dns: { ...DEFAULT_SETTINGS.dns, ...(o.dns ?? {}) }
})
const mk = (name: string, s: Settings, extra: any = {}) => {
  const cfg = buildConfig({
    settings: s, nodes, activeNodeId: nodes[0].id,
    appRules: [{ id: '1', exe: 'Discord.exe', name: 'D', action: 'proxy', enabled: true },
               { id: '2', exe: 'steam.exe', name: 'S', action: 'direct', enabled: true },
               { id: '3', exe: 'Bad.exe', name: 'B', action: 'block', enabled: true }],
    customRules: [{ id: 'c1', name: 't', enabled: true, action: 'proxy', matchers: [
      { kind: 'domain_suffix', values: ['example.org'] }, { kind: 'ip_cidr', values: ['1.2.3.0/24'] },
      { kind: 'port_range', values: ['5000:6000'] }, { kind: 'network', values: ['udp'] }] }],
    enabledPresets: DEFAULT_ENABLED_PRESETS,
    rulesDir: join(ROOT, 'resources/rules'), cachePath: '/НЕВЕРНЫЙ/cache.db', clashSecret: 'secret123',
    ...extra
  })
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(cfg, null, 2))
}

let n = 0
for (const capture of ['tun', 'proxy'] as const)
  for (const routing of ['global', 'smart', 'whitelist', 'direct'] as const) { mk(`${capture}-${routing}`, base({ captureMode: capture, routingMode: routing })); n++ }
mk('fakeip', base({ dns: { ...DEFAULT_SETTINGS.dns, fakeIp: true } })); n++
mk('block-ads', base({ dns: { ...DEFAULT_SETTINGS.dns, blockAds: true } })); n++
mk('no-quic', base({ blockQuic: false })); n++
mk('gvisor-ipv6', base({ tun: { ...DEFAULT_SETTINGS.tun, stack: 'gvisor', ipv6: true } })); n++
mk('dns-dot', base({ dns: { ...DEFAULT_SETTINGS.dns, remote: 'tls://1.1.1.1', local: 'local' } })); n++
mk('all-presets', base(), { enabledPresets: PRESETS.map((p) => p.id) }); n++
mk('no-nodes', base(), { nodes: [], activeNodeId: undefined }); n++
console.log(`сгенерировано конфигов: ${n}`)
