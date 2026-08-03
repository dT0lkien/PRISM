/* Сборка конфига sing-box 1.13 из настроек приложения.
   Чистая функция — используется и в main (для запуска), и в renderer (для предпросмотра). */

import type { AppRule, Matcher, RoutingRule, RuleAction, ServerNode, Settings } from './types'
import { DISCORD_DOMAINS, presetById } from './presets'
import { RULE_SET_TAGS } from './rulesets'

export const TAG_PROXY = 'proxy'
export const TAG_DIRECT = 'direct'
export const TAG_AUTO = 'auto'

export interface BuildContext {
  settings: Settings
  nodes: ServerNode[]
  activeNodeId?: string
  appRules: AppRule[]
  customRules: RoutingRule[]
  enabledPresets: string[]
  /** Каталог с .srs файлами */
  rulesDir: string
  /** Файл кэша (fakeip / результаты urltest) */
  cachePath: string
  clashSecret: string
}

type Json = Record<string, any>

const drop = <T extends Json>(o: T): T => {
  for (const k of Object.keys(o)) {
    const v = o[k]
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) delete o[k]
  }
  return o
}

/** Тег outbound по действию правила */
function tagFor(action: RuleAction): string | undefined {
  return action === 'proxy' ? TAG_PROXY : action === 'direct' ? TAG_DIRECT : undefined
}

/** Matcher[] → поля правила sing-box. null если правило пустое. */
function matchersToRule(matchers: Matcher[]): Json | null {
  const r: Json = {}
  for (const m of matchers) {
    const vals = m.values.map((v) => v.trim()).filter(Boolean)
    if (!vals.length) continue
    switch (m.kind) {
      case 'process':
        r.process_name = [...(r.process_name ?? []), ...vals]
        break
      case 'process_path':
        r.process_path = [...(r.process_path ?? []), ...vals]
        break
      case 'domain':
        r.domain = [...(r.domain ?? []), ...vals]
        break
      case 'domain_suffix':
        r.domain_suffix = [...(r.domain_suffix ?? []), ...vals]
        break
      case 'domain_keyword':
        r.domain_keyword = [...(r.domain_keyword ?? []), ...vals]
        break
      case 'domain_regex':
        r.domain_regex = [...(r.domain_regex ?? []), ...vals]
        break
      case 'ip_cidr':
        r.ip_cidr = [...(r.ip_cidr ?? []), ...vals]
        break
      case 'port':
        r.port = [...(r.port ?? []), ...vals.map((v) => parseInt(v, 10)).filter(Number.isFinite)]
        break
      case 'port_range':
        r.port_range = [...(r.port_range ?? []), ...vals]
        break
      case 'ruleset':
        r.rule_set = [...(r.rule_set ?? []), ...vals.filter((v) => RULE_SET_TAGS.has(v))]
        break
      case 'network':
        r.network = [...(r.network ?? []), ...vals]
        break
      case 'protocol':
        r.protocol = [...(r.protocol ?? []), ...vals]
        break
    }
  }
  return Object.keys(r).length ? r : null
}

/** Строка DNS → серверный объект sing-box 1.12+ */
export function parseDnsServer(raw: string, tag: string, detour?: string): Json {
  const s = (raw || '').trim()
  const base: Json = { tag }
  if (detour) base.detour = detour

  if (!s || s === 'local' || s === 'system') return { ...base, type: 'local' }

  const m = s.match(/^([a-z0-9+]+):\/\/(.+)$/i)
  if (!m) {
    // Голый IP или домен → обычный UDP
    const [host, port] = s.split(':')
    return drop({ ...base, type: 'udp', server: host, server_port: port ? parseInt(port, 10) : undefined })
  }

  const scheme = m[1].toLowerCase()
  let rest = m[2]
  let path: string | undefined
  const slash = rest.indexOf('/')
  if (slash >= 0) {
    path = rest.slice(slash)
    rest = rest.slice(0, slash)
  }
  const colon = rest.lastIndexOf(':')
  const hasPort = colon > rest.lastIndexOf(']')
  const host = hasPort ? rest.slice(0, colon) : rest
  const port = hasPort ? parseInt(rest.slice(colon + 1), 10) : undefined

  const typeMap: Record<string, string> = {
    udp: 'udp',
    dns: 'udp',
    tcp: 'tcp',
    tls: 'tls',
    'dot': 'tls',
    https: 'https',
    'doh': 'https',
    h3: 'h3',
    quic: 'quic',
    doq: 'quic',
    dhcp: 'dhcp',
    rcode: 'rcode'
  }
  const type = typeMap[scheme] ?? 'udp'
  if (type === 'dhcp') return { ...base, type: 'dhcp' }
  return drop({
    ...base,
    type,
    server: host.replace(/^\[|\]$/g, ''),
    server_port: port,
    path: type === 'https' || type === 'h3' ? path || '/dns-query' : undefined
  })
}

/* ─────────────────────────── основной сборщик ─────────────────────────── */

export function buildConfig(ctx: BuildContext): Json {
  const { settings: st } = ctx
  const usedRuleSets = new Set<string>()
  const routeRules: Json[] = []

  const noteRuleSets = (r: Json | null) => {
    if (r?.rule_set) for (const t of r.rule_set as string[]) usedRuleSets.add(t)
    return r
  }

  /* ── 1. Служебные правила ── */
  routeRules.push({ action: 'sniff', timeout: '500ms' })
  routeRules.push({ protocol: 'dns', action: 'hijack-dns' })

  // Локальная сеть всегда мимо туннеля, иначе отвалятся принтеры/NAS/роутер
  if (st.bypassPrivate) {
    routeRules.push({ ip_is_private: true, outbound: TAG_DIRECT })
  }

  /* ── 2. Блокировка QUIC ──
     UDP/443 роняем, чтобы браузеры и Discord CDN откатились на TCP —
     он проксируется надёжно. Голосовые порты Discord (50000+) не трогаем. */
  if (st.blockQuic) {
    routeRules.push({ network: ['udp'], port: [443], action: 'reject', method: 'default' })
  }

  /* ── 3. Правила по приложениям (высший пользовательский приоритет) ── */
  const byAction: Record<RuleAction, string[]> = { proxy: [], direct: [], block: [] }
  for (const a of ctx.appRules) {
    if (a.enabled && a.exe.trim()) byAction[a.action].push(a.exe.trim())
  }
  for (const action of ['block', 'direct', 'proxy'] as RuleAction[]) {
    if (byAction[action].length) {
      const tag = tagFor(action)
      routeRules.push(drop({ process_name: byAction[action], outbound: tag, action: tag ? undefined : 'reject' }))
    }
  }

  /* ── 4. Пользовательские правила (в порядке списка) ── */
  for (const rule of ctx.customRules) {
    if (!rule.enabled) continue
    const r = noteRuleSets(matchersToRule(rule.matchers))
    if (!r) continue
    const tag = rule.outboundTag ?? tagFor(rule.action)
    routeRules.push(drop({ ...r, outbound: tag, action: tag ? undefined : 'reject' }))
  }

  /* ── 5. Пресеты ── */
  const activePresets = ctx.enabledPresets.map(presetById).filter(Boolean)
  // Сначала block, потом force-proxy, потом bypass — чтобы обходы не перебивали фиксы
  const order = { block: 0, fix: 1, force: 2, bypass: 3 } as const
  activePresets.sort((a, b) => order[a!.group] - order[b!.group])
  for (const p of activePresets) {
    for (const pr of p!.rules) {
      const r = noteRuleSets(matchersToRule(pr.matchers))
      if (!r) continue
      const tag = tagFor(pr.action)
      routeRules.push(drop({ ...r, outbound: tag, action: tag ? undefined : 'reject' }))
    }
  }

  /* ── 6. Итоговое направление ── */
  let finalTag: string
  switch (st.routingMode) {
    case 'global':
      finalTag = TAG_PROXY
      break
    case 'direct':
      finalTag = TAG_DIRECT
      break
    case 'whitelist':
      // Всё напрямую, в туннель уходит только явно перечисленное выше
      finalTag = TAG_DIRECT
      break
    default:
      finalTag = TAG_PROXY
  }

  // В global-режиме обходные правила смысла не имеют — вырезаем их
  const rules =
    st.routingMode === 'global'
      ? routeRules.filter((r) => r.outbound !== TAG_DIRECT || r.ip_is_private)
      : routeRules

  /* ── DNS ──
     detour указываем только на реальный прокси: ядро ругается
     «detour to an empty direct outbound makes no sense», если увести
     запросы в обычный direct. Прямой резолвер и так ходит напрямую. */
  const hasProxy = ctx.nodes.length > 0
  const dnsServers: Json[] = [
    parseDnsServer(st.dns.remote || 'https://1.1.1.1/dns-query', 'dns-remote', hasProxy ? TAG_PROXY : undefined),
    parseDnsServer(st.dns.local || '77.88.8.8', 'dns-direct')
  ]
  if (st.dns.fakeIp) {
    dnsServers.push({
      type: 'fakeip',
      tag: 'dns-fake',
      inet4_range: '198.18.0.0/15',
      inet6_range: 'fc00::/18'
    })
  }

  const dnsRules: Json[] = []
  if (st.dns.blockAds) {
    dnsRules.push({ rule_set: ['geosite-category-ads-all'], action: 'reject' })
    usedRuleSets.add('geosite-category-ads-all')
  }
  // Discord резолвим только через прокси — иначе провайдер подсунет мусорные адреса
  if (st.discordFix) {
    dnsRules.push({ domain_suffix: DISCORD_DOMAINS, server: 'dns-remote' })
    dnsRules.push({ rule_set: ['geosite-discord'], server: 'dns-remote' })
    usedRuleSets.add('geosite-discord')
  }
  if (st.dns.splitDns && st.routingMode !== 'global') {
    dnsRules.push({
      rule_set: ['geosite-category-ru', 'geosite-tld-ru', 'geosite-yandex', 'geosite-vk', 'geosite-mailru'],
      server: 'dns-direct'
    })
    ;['geosite-category-ru', 'geosite-tld-ru', 'geosite-yandex', 'geosite-vk', 'geosite-mailru'].forEach((t) =>
      usedRuleSets.add(t)
    )
  }
  if (st.dns.fakeIp) {
    dnsRules.push({ query_type: ['A', 'AAAA'], server: 'dns-fake' })
  }

  const dns: Json = drop({
    servers: dnsServers,
    rules: dnsRules,
    final: st.routingMode === 'direct' ? 'dns-direct' : 'dns-remote',
    strategy: st.dns.strategy,
    independent_cache: true,
    reverse_mapping: st.dns.fakeIp
  })

  /* ── Inbounds ── */
  const inbounds: Json[] = []
  if (st.captureMode === 'tun') {
    inbounds.push(
      drop({
        type: 'tun',
        tag: 'tun-in',
        address: st.tun.ipv6 ? ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'] : ['172.19.0.1/30'],
        mtu: st.tun.mtu,
        auto_route: st.tun.autoRoute,
        strict_route: st.tun.strictRoute,
        stack: st.tun.stack,
        // Эти процессы ядро вообще не заворачивает в TUN
        exclude_package: undefined
      })
    )
  }
  // Локальный mixed-порт открыт всегда — в него можно ходить вручную из любой программы.
  // set_system_proxy намеренно не включаем: прокси прописывает само приложение,
  // чтобы гарантированно снять его даже если ядро упало.
  inbounds.push({
    type: 'mixed',
    tag: 'mixed-in',
    listen: st.allowLan ? '0.0.0.0' : '127.0.0.1',
    listen_port: st.localPort
  })

  /* ── Outbounds ── */
  const nodeOutbounds: Json[] = []
  const nodeTags: string[] = []
  const seen = new Set<string>()
  for (const n of ctx.nodes) {
    let tag = n.name?.trim() || `${n.server}:${n.port}`
    // Теги обязаны быть уникальными
    let i = 2
    const base = tag
    while (seen.has(tag)) tag = `${base} (${i++})`
    seen.add(tag)
    nodeTags.push(tag)
    nodeOutbounds.push({ ...n.outbound, tag })
  }

  const activeIdx = ctx.nodes.findIndex((n) => n.id === ctx.activeNodeId)
  const defaultTag = activeIdx >= 0 ? nodeTags[activeIdx] : nodeTags[0]

  const outbounds: Json[] = []
  if (nodeTags.length) {
    outbounds.push(
      drop({
        type: 'selector',
        tag: TAG_PROXY,
        outbounds: [...nodeTags, TAG_AUTO],
        default: defaultTag,
        interrupt_exist_connections: false
      })
    )
    outbounds.push({
      type: 'urltest',
      tag: TAG_AUTO,
      outbounds: nodeTags,
      url: 'https://www.gstatic.com/generate_204',
      interval: '10m',
      tolerance: 50,
      idle_timeout: '30m',
      interrupt_exist_connections: false
    })
    outbounds.push(...nodeOutbounds)
  } else {
    // Без серверов «прокси» = напрямую, чтобы конфиг оставался валидным
    outbounds.push({ type: 'direct', tag: TAG_PROXY })
  }
  outbounds.push({ type: 'direct', tag: TAG_DIRECT })

  /* ── rule_set (только реально задействованные) ── */
  const ruleSetDefs = [...usedRuleSets].map((tag) => ({
    type: 'local',
    tag,
    format: 'binary',
    path: joinPath(ctx.rulesDir, `${tag}.srs`)
  }))

  const config: Json = {
    log: { level: st.logLevel, timestamp: true },
    dns,
    inbounds,
    outbounds,
    route: drop({
      rules,
      rule_set: ruleSetDefs,
      final: finalTag,
      auto_detect_interface: true,
      default_domain_resolver: { server: 'dns-direct' }
    }),
    experimental: {
      cache_file: { enabled: true, path: ctx.cachePath, store_fakeip: st.dns.fakeIp, store_rdrc: true },
      clash_api: {
        external_controller: `127.0.0.1:${st.clashPort}`,
        secret: ctx.clashSecret,
        default_mode: 'rule'
      }
    }
  }

  /* ── Пользовательский JSON поверх ── */
  if (st.extraConfig?.trim()) {
    try {
      return deepMerge(config, JSON.parse(st.extraConfig))
    } catch {
      /* невалидный JSON игнорируем — о нём сообщит проверка в UI */
    }
  }
  return config
}

/* ─────────────────────────── helpers ─────────────────────────── */

function joinPath(dir: string, file: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.endsWith(sep) ? dir + file : dir + sep + file
}

export function deepMerge<T extends Json>(base: T, patch: Json): T {
  const out: Json = Array.isArray(base) ? [...(base as any)] : { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (Array.isArray(v)) {
      out[k] = v
    } else if (v && typeof v === 'object') {
      out[k] = out[k] && typeof out[k] === 'object' ? deepMerge(out[k], v) : v
    } else {
      out[k] = v
    }
  }
  return out as T
}

/** Конфиг для быстрой проверки задержки одного узла */
export function buildLatencyConfig(node: ServerNode, port: number, cachePath: string): Json {
  return {
    log: { level: 'error' },
    inbounds: [{ type: 'mixed', tag: 'in', listen: '127.0.0.1', listen_port: port }],
    outbounds: [{ ...node.outbound, tag: 'out' }, { type: 'direct', tag: 'direct' }],
    route: {
      rules: [{ action: 'sniff' }],
      final: 'out',
      default_domain_resolver: { server: 'dns-direct' }
    },
    dns: { servers: [{ type: 'udp', tag: 'dns-direct', server: '1.1.1.1', detour: 'direct' }] },
    experimental: { cache_file: { enabled: false, path: cachePath } }
  }
}
