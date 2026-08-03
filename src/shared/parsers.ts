/* Парсинг ссылок подписок → sing-box outbound.
   Поддержка: vless, vmess (base64-json и uri), trojan, ss (SIP002/legacy),
   hysteria2/hy2, hysteria, tuic, anytls, socks, http, shadowtls.
   Плюс: Clash YAML, sing-box JSON, base64-списки. */

import type { NodeType, ServerNode } from './types'

/* ───────────────────────── утилиты ───────────────────────── */

export function b64decode(input: string): string {
  let s = input.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
  while (s.length % 4) s += '='
  try {
    const bin = atob(s)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

export function looksBase64(s: string): boolean {
  const t = s.trim().replace(/\s/g, '')
  return t.length > 16 && /^[A-Za-z0-9+/\-_=]+$/.test(t)
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

function num(v: unknown, dflt = 0): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : dflt
}

function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'True'
}

function clean<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) {
    const v = o[k]
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) delete o[k]
  }
  return o
}

/** Разбор host:port, включая IPv6 в скобках */
function splitHostPort(auth: string): { host: string; port: number } {
  const m = auth.match(/^\[(.+)\]:(\d+)$/)
  if (m) return { host: m[1], port: parseInt(m[2], 10) }
  const i = auth.lastIndexOf(':')
  if (i < 0) return { host: auth, port: 443 }
  return { host: auth.slice(0, i), port: parseInt(auth.slice(i + 1), 10) || 443 }
}

/* ───────────────────────── TLS / transport ───────────────────────── */

interface TlsOpts {
  security?: string
  sni?: string
  host?: string
  alpn?: string
  fp?: string
  pbk?: string
  sid?: string
  spx?: string
  insecure?: boolean
  server: string
}

function buildTls(o: TlsOpts): Record<string, unknown> | undefined {
  const sec = (o.security || '').toLowerCase()
  if (sec === 'reality') {
    return clean({
      enabled: true,
      server_name: o.sni || o.host || o.server,
      insecure: false,
      utls: { enabled: true, fingerprint: o.fp || 'chrome' },
      reality: clean({ enabled: true, public_key: o.pbk, short_id: o.sid || '' })
    })
  }
  if (sec === 'tls' || sec === 'xtls') {
    return clean({
      enabled: true,
      server_name: o.sni || o.host || o.server,
      insecure: !!o.insecure,
      alpn: o.alpn ? o.alpn.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
      utls: o.fp ? { enabled: true, fingerprint: o.fp } : { enabled: true, fingerprint: 'chrome' }
    })
  }
  return undefined
}

function buildTransport(q: URLSearchParams, fallbackHost: string): Record<string, unknown> | undefined {
  const type = (q.get('type') || q.get('net') || 'tcp').toLowerCase()
  const path = q.get('path') || '/'
  const host = q.get('host') || fallbackHost

  switch (type) {
    case 'ws': {
      const t: Record<string, unknown> = { type: 'ws' }
      // ?ed=2048 внутри path — ранние данные
      const [p, qs] = path.split('?')
      t.path = p || '/'
      if (host) t.headers = { Host: host }
      const ed = qs ? new URLSearchParams(qs).get('ed') : q.get('ed')
      if (ed) {
        t.max_early_data = parseInt(ed, 10) || 2048
        t.early_data_header_name = q.get('eh') || 'Sec-WebSocket-Protocol'
      }
      return t
    }
    case 'grpc':
      return clean({ type: 'grpc', service_name: q.get('serviceName') || q.get('path') || '' })
    case 'http':
    case 'h2':
      return clean({
        type: 'http',
        host: host ? host.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        path: path || '/'
      })
    case 'httpupgrade':
      return clean({ type: 'httpupgrade', host, path: path || '/' })
    case 'quic':
      return { type: 'quic' }
    case 'tcp': {
      // tcp + headerType=http — маскировка под HTTP
      if ((q.get('headerType') || '').toLowerCase() === 'http') {
        return clean({
          type: 'http',
          host: host ? host.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
          path: path || '/'
        })
      }
      return undefined
    }
    default:
      return undefined
  }
}

/* ───────────────────────── парсеры по протоколам ───────────────────────── */

type Parsed = { name: string; type: NodeType; server: string; port: number; outbound: Record<string, unknown> }

function parseVless(url: string): Parsed | null {
  const m = url.match(/^vless:\/\/([^@]+)@(.+?)(?:\?(.*?))?(?:#(.*))?$/i)
  if (!m) return null
  const uuid = decodeURIComponent(m[1])
  const { host, port } = splitHostPort(m[2])
  const q = new URLSearchParams(m[3] || '')
  const name = m[4] ? decodeURIComponent(m[4]) : `${host}:${port}`

  const flow = q.get('flow') || ''
  const ob = clean({
    type: 'vless',
    server: host,
    server_port: port,
    uuid,
    flow: flow && flow !== 'none' ? flow : undefined,
    packet_encoding: q.get('packetEncoding') || 'xudp',
    tls: buildTls({
      security: q.get('security') || 'none',
      sni: q.get('sni') || undefined,
      host: q.get('host') || undefined,
      alpn: q.get('alpn') || undefined,
      fp: q.get('fp') || undefined,
      pbk: q.get('pbk') || undefined,
      sid: q.get('sid') || undefined,
      insecure: truthy(q.get('allowInsecure')) || truthy(q.get('insecure')),
      server: host
    }),
    transport: buildTransport(q, q.get('host') || '')
  })
  return { name, type: 'vless', server: host, port, outbound: ob }
}

function parseVmess(url: string): Parsed | null {
  const body = url.slice('vmess://'.length)
  // Формат 1: base64(JSON)
  const decoded = b64decode(body.split('#')[0])
  if (decoded.trim().startsWith('{')) {
    let j: Record<string, unknown>
    try {
      j = JSON.parse(decoded)
    } catch {
      return null
    }
    const host = String(j.add || '')
    const port = num(j.port, 443)
    const net = String(j.net || 'tcp').toLowerCase()
    const q = new URLSearchParams()
    q.set('type', net)
    if (j.host) q.set('host', String(j.host))
    if (j.path) q.set('path', String(j.path))
    if (net === 'grpc' && j.path) q.set('serviceName', String(j.path))
    if (j.type) q.set('headerType', String(j.type))

    const tlsOn = String(j.tls || '') === 'tls' || String(j.tls || '') === 'reality'
    const ob = clean({
      type: 'vmess',
      server: host,
      server_port: port,
      uuid: String(j.id || ''),
      security: String(j.scy || 'auto'),
      alter_id: num(j.aid, 0),
      packet_encoding: 'xudp',
      tls: tlsOn
        ? buildTls({
            security: String(j.tls),
            sni: (j.sni as string) || (j.host as string) || undefined,
            alpn: (j.alpn as string) || undefined,
            fp: (j.fp as string) || undefined,
            insecure: truthy(j.allowInsecure) || truthy(j.verify_cert === false),
            server: host
          })
        : undefined,
      transport: buildTransport(q, String(j.host || ''))
    })
    return { name: String(j.ps || `${host}:${port}`), type: 'vmess', server: host, port, outbound: ob }
  }

  // Формат 2: vmess://uuid@host:port?...#name (как vless)
  const m = url.match(/^vmess:\/\/([^@]+)@(.+?)(?:\?(.*?))?(?:#(.*))?$/i)
  if (!m) return null
  const { host, port } = splitHostPort(m[2])
  const q = new URLSearchParams(m[3] || '')
  const ob = clean({
    type: 'vmess',
    server: host,
    server_port: port,
    uuid: decodeURIComponent(m[1]),
    security: q.get('encryption') || 'auto',
    alter_id: num(q.get('alterId'), 0),
    packet_encoding: 'xudp',
    tls: buildTls({
      security: q.get('security') || 'none',
      sni: q.get('sni') || undefined,
      host: q.get('host') || undefined,
      alpn: q.get('alpn') || undefined,
      fp: q.get('fp') || undefined,
      insecure: truthy(q.get('allowInsecure')),
      server: host
    }),
    transport: buildTransport(q, q.get('host') || '')
  })
  return {
    name: m[4] ? decodeURIComponent(m[4]) : `${host}:${port}`,
    type: 'vmess',
    server: host,
    port,
    outbound: ob
  }
}

function parseTrojan(url: string): Parsed | null {
  const m = url.match(/^trojan:\/\/([^@]+)@(.+?)(?:\?(.*?))?(?:#(.*))?$/i)
  if (!m) return null
  const { host, port } = splitHostPort(m[2])
  const q = new URLSearchParams(m[3] || '')
  const ob = clean({
    type: 'trojan',
    server: host,
    server_port: port,
    password: decodeURIComponent(m[1]),
    tls: buildTls({
      security: q.get('security') || 'tls',
      sni: q.get('sni') || q.get('peer') || undefined,
      host: q.get('host') || undefined,
      alpn: q.get('alpn') || undefined,
      fp: q.get('fp') || undefined,
      pbk: q.get('pbk') || undefined,
      sid: q.get('sid') || undefined,
      insecure: truthy(q.get('allowInsecure')) || truthy(q.get('insecure')),
      server: host
    }),
    transport: buildTransport(q, q.get('host') || '')
  })
  return {
    name: m[4] ? decodeURIComponent(m[4]) : `${host}:${port}`,
    type: 'trojan',
    server: host,
    port,
    outbound: ob
  }
}

function parseShadowsocks(url: string): Parsed | null {
  let rest = url.slice('ss://'.length)
  let name = ''
  const hi = rest.indexOf('#')
  if (hi >= 0) {
    name = decodeURIComponent(rest.slice(hi + 1))
    rest = rest.slice(0, hi)
  }
  let query = ''
  const qi = rest.indexOf('?')
  if (qi >= 0) {
    query = rest.slice(qi + 1)
    rest = rest.slice(0, qi)
  }

  let method = ''
  let password = ''
  let host = ''
  let port = 0

  if (rest.includes('@')) {
    // SIP002: ss://base64(method:pass)@host:port  либо  ss://method:pass@host:port
    const at = rest.lastIndexOf('@')
    const userinfo = rest.slice(0, at)
    const hp = splitHostPort(rest.slice(at + 1))
    host = hp.host
    port = hp.port
    const dec = userinfo.includes(':') ? decodeURIComponent(userinfo) : b64decode(userinfo)
    const ci = dec.indexOf(':')
    method = dec.slice(0, ci)
    password = dec.slice(ci + 1)
  } else {
    // Legacy: ss://base64(method:pass@host:port)
    const dec = b64decode(rest)
    const at = dec.lastIndexOf('@')
    if (at < 0) return null
    const ci = dec.indexOf(':')
    method = dec.slice(0, ci)
    password = dec.slice(ci + 1, at)
    const hp = splitHostPort(dec.slice(at + 1))
    host = hp.host
    port = hp.port
  }
  if (!host || !method) return null

  const q = new URLSearchParams(query)
  const pluginRaw = q.get('plugin') || ''
  let plugin = ''
  let pluginOpts = ''
  if (pluginRaw) {
    const parts = pluginRaw.split(';')
    plugin = parts[0]
    pluginOpts = parts.slice(1).join(';')
    if (plugin === 'obfs-local' || plugin === 'simple-obfs') plugin = 'obfs-local'
  }

  const ob = clean({
    type: 'shadowsocks',
    server: host,
    server_port: port,
    method,
    password,
    plugin: plugin || undefined,
    plugin_opts: pluginOpts || undefined,
    udp_over_tcp: truthy(q.get('uot')) ? { enabled: true, version: 2 } : undefined
  })
  return { name: name || `${host}:${port}`, type: 'shadowsocks', server: host, port, outbound: ob }
}

function parseHysteria2(url: string): Parsed | null {
  const m = url.match(/^(?:hysteria2|hy2):\/\/([^@]*)@?([^?#]+)(?:\?(.*?))?(?:#(.*))?$/i)
  if (!m) return null
  const { host, port } = splitHostPort(m[2])
  const q = new URLSearchParams(m[3] || '')
  const obfs = q.get('obfs')
  const ob = clean({
    type: 'hysteria2',
    server: host,
    server_port: port,
    password: decodeURIComponent(m[1] || q.get('password') || ''),
    up_mbps: num(q.get('up'), 0) || undefined,
    down_mbps: num(q.get('down'), 0) || undefined,
    obfs: obfs ? clean({ type: obfs, password: q.get('obfs-password') || '' }) : undefined,
    tls: clean({
      enabled: true,
      server_name: q.get('sni') || q.get('peer') || host,
      insecure: truthy(q.get('insecure')) || truthy(q.get('allowInsecure')),
      alpn: (q.get('alpn') || 'h3').split(',').map((s) => s.trim()).filter(Boolean)
    })
  })
  return {
    name: m[4] ? decodeURIComponent(m[4]) : `${host}:${port}`,
    type: 'hysteria2',
    server: host,
    port,
    outbound: ob
  }
}

function parseTuic(url: string): Parsed | null {
  const m = url.match(/^tuic:\/\/([^@]+)@([^?#]+)(?:\?(.*?))?(?:#(.*))?$/i)
  if (!m) return null
  const cred = decodeURIComponent(m[1])
  const ci = cred.indexOf(':')
  const uuid = ci >= 0 ? cred.slice(0, ci) : cred
  const password = ci >= 0 ? cred.slice(ci + 1) : ''
  const { host, port } = splitHostPort(m[2])
  const q = new URLSearchParams(m[3] || '')
  const ob = clean({
    type: 'tuic',
    server: host,
    server_port: port,
    uuid,
    password,
    congestion_control: q.get('congestion_control') || 'bbr',
    udp_relay_mode: q.get('udp_relay_mode') || 'native',
    zero_rtt_handshake: truthy(q.get('reduce_rtt')),
    heartbeat: '10s',
    tls: clean({
      enabled: true,
      server_name: q.get('sni') || host,
      insecure: truthy(q.get('allow_insecure')) || truthy(q.get('insecure')),
      alpn: (q.get('alpn') || 'h3').split(',').map((s) => s.trim()).filter(Boolean)
    })
  })
  return { name: m[4] ? decodeURIComponent(m[4]) : `${host}:${port}`, type: 'tuic', server: host, port, outbound: ob }
}

function parseAnyTls(url: string): Parsed | null {
  const m = url.match(/^anytls:\/\/([^@]+)@([^?#]+)(?:\?(.*?))?(?:#(.*))?$/i)
  if (!m) return null
  const { host, port } = splitHostPort(m[2])
  const q = new URLSearchParams(m[3] || '')
  const ob = clean({
    type: 'anytls',
    server: host,
    server_port: port,
    password: decodeURIComponent(m[1]),
    idle_session_check_interval: '30s',
    idle_session_timeout: '30s',
    tls: clean({
      enabled: true,
      server_name: q.get('sni') || host,
      insecure: truthy(q.get('insecure')) || truthy(q.get('allowInsecure')),
      alpn: q.get('alpn') ? q.get('alpn')!.split(',') : undefined,
      utls: { enabled: true, fingerprint: q.get('fp') || 'chrome' }
    })
  })
  return { name: m[4] ? decodeURIComponent(m[4]) : `${host}:${port}`, type: 'anytls', server: host, port, outbound: ob }
}

function parseSocksHttp(url: string): Parsed | null {
  const m = url.match(/^(socks5?|https?):\/\/(?:([^@]*)@)?([^?#]+)(?:\?(.*?))?(?:#(.*))?$/i)
  if (!m) return null
  const scheme = m[1].toLowerCase()
  const isHttp = scheme === 'http' || scheme === 'https'
  const { host, port } = splitHostPort(m[3])
  let username = ''
  let password = ''
  if (m[2]) {
    const dec = m[2].includes(':') ? decodeURIComponent(m[2]) : b64decode(m[2])
    const ci = dec.indexOf(':')
    username = ci >= 0 ? dec.slice(0, ci) : dec
    password = ci >= 0 ? dec.slice(ci + 1) : ''
  }
  const ob = clean({
    type: isHttp ? 'http' : 'socks',
    server: host,
    server_port: port,
    version: isHttp ? undefined : '5',
    username: username || undefined,
    password: password || undefined,
    tls: scheme === 'https' ? { enabled: true, server_name: host } : undefined
  })
  return {
    name: m[5] ? decodeURIComponent(m[5]) : `${host}:${port}`,
    type: isHttp ? 'http' : 'socks',
    server: host,
    port,
    outbound: ob
  }
}

/* ───────────────────────── публичный API ───────────────────────── */

export function parseLink(link: string): Parsed | null {
  const url = link.trim()
  if (!url) return null
  try {
    if (/^vless:\/\//i.test(url)) return parseVless(url)
    if (/^vmess:\/\//i.test(url)) return parseVmess(url)
    if (/^trojan:\/\//i.test(url)) return parseTrojan(url)
    if (/^ss:\/\//i.test(url)) return parseShadowsocks(url)
    if (/^(hysteria2|hy2):\/\//i.test(url)) return parseHysteria2(url)
    if (/^tuic:\/\//i.test(url)) return parseTuic(url)
    if (/^anytls:\/\//i.test(url)) return parseAnyTls(url)
    if (/^(socks5?|https?):\/\//i.test(url) && !/^https?:\/\/[^/]+\/.*/.test(url)) return parseSocksHttp(url)
  } catch {
    return null
  }
  return null
}

/** Конвертация одного прокси из Clash YAML в sing-box outbound */
export function clashProxyToNode(p: Record<string, any>): Parsed | null {
  const host = String(p.server || '')
  const port = num(p.port, 0)
  const name = String(p.name || `${host}:${port}`)
  if (!host || !port) return null
  const t = String(p.type || '').toLowerCase()

  const tlsFrom = (): Record<string, unknown> | undefined => {
    if (!p.tls && t !== 'hysteria2' && t !== 'tuic' && t !== 'trojan') return undefined
    return clean({
      enabled: true,
      server_name: p.servername || p.sni || p['server-name'] || host,
      insecure: truthy(p['skip-cert-verify']),
      alpn: Array.isArray(p.alpn) ? p.alpn : undefined,
      utls: p['client-fingerprint'] ? { enabled: true, fingerprint: p['client-fingerprint'] } : { enabled: true, fingerprint: 'chrome' },
      reality: p['reality-opts']
        ? clean({
            enabled: true,
            public_key: p['reality-opts']['public-key'],
            short_id: p['reality-opts']['short-id'] || ''
          })
        : undefined
    })
  }

  const transportFrom = (): Record<string, unknown> | undefined => {
    const net = String(p.network || '').toLowerCase()
    if (net === 'ws') {
      const o = p['ws-opts'] || {}
      return clean({
        type: 'ws',
        path: o.path || '/',
        headers: o.headers || (p['ws-headers'] ? p['ws-headers'] : undefined),
        max_early_data: o['max-early-data'],
        early_data_header_name: o['early-data-header-name']
      })
    }
    if (net === 'grpc') return clean({ type: 'grpc', service_name: (p['grpc-opts'] || {})['grpc-service-name'] || '' })
    if (net === 'h2') {
      const o = p['h2-opts'] || {}
      return clean({ type: 'http', host: o.host, path: o.path || '/' })
    }
    if (net === 'http') {
      const o = p['http-opts'] || {}
      return clean({ type: 'http', host: o.headers?.Host, path: Array.isArray(o.path) ? o.path[0] : o.path })
    }
    if (net === 'httpupgrade') {
      const o = p['ws-opts'] || {}
      return clean({ type: 'httpupgrade', host: o.headers?.Host, path: o.path || '/' })
    }
    return undefined
  }

  switch (t) {
    case 'vless':
      return {
        name,
        type: 'vless',
        server: host,
        port,
        outbound: clean({
          type: 'vless',
          server: host,
          server_port: port,
          uuid: p.uuid,
          flow: p.flow || undefined,
          packet_encoding: 'xudp',
          tls: tlsFrom(),
          transport: transportFrom()
        })
      }
    case 'vmess':
      return {
        name,
        type: 'vmess',
        server: host,
        port,
        outbound: clean({
          type: 'vmess',
          server: host,
          server_port: port,
          uuid: p.uuid,
          security: p.cipher || 'auto',
          alter_id: num(p.alterId ?? p['alterId'], 0),
          packet_encoding: 'xudp',
          tls: tlsFrom(),
          transport: transportFrom()
        })
      }
    case 'trojan':
      return {
        name,
        type: 'trojan',
        server: host,
        port,
        outbound: clean({
          type: 'trojan',
          server: host,
          server_port: port,
          password: p.password,
          tls: tlsFrom(),
          transport: transportFrom()
        })
      }
    case 'ss':
    case 'shadowsocks':
      return {
        name,
        type: 'shadowsocks',
        server: host,
        port,
        outbound: clean({
          type: 'shadowsocks',
          server: host,
          server_port: port,
          method: p.cipher,
          password: p.password,
          plugin: p.plugin || undefined,
          plugin_opts:
            p['plugin-opts'] && typeof p['plugin-opts'] === 'object'
              ? Object.entries(p['plugin-opts'])
                  .map(([k, v]) => `${k}=${v}`)
                  .join(';')
              : undefined
        })
      }
    case 'hysteria2':
    case 'hy2':
      return {
        name,
        type: 'hysteria2',
        server: host,
        port,
        outbound: clean({
          type: 'hysteria2',
          server: host,
          server_port: port,
          password: p.password || p.auth,
          up_mbps: num(p.up, 0) || undefined,
          down_mbps: num(p.down, 0) || undefined,
          obfs: p.obfs ? clean({ type: p.obfs, password: p['obfs-password'] || '' }) : undefined,
          tls: clean({
            enabled: true,
            server_name: p.sni || host,
            insecure: truthy(p['skip-cert-verify']),
            alpn: Array.isArray(p.alpn) ? p.alpn : ['h3']
          })
        })
      }
    case 'tuic':
      return {
        name,
        type: 'tuic',
        server: host,
        port,
        outbound: clean({
          type: 'tuic',
          server: host,
          server_port: port,
          uuid: p.uuid,
          password: p.password,
          congestion_control: p['congestion-controller'] || 'bbr',
          udp_relay_mode: p['udp-relay-mode'] || 'native',
          tls: clean({
            enabled: true,
            server_name: p.sni || host,
            insecure: truthy(p['skip-cert-verify']),
            alpn: Array.isArray(p.alpn) ? p.alpn : ['h3']
          })
        })
      }
    case 'anytls':
      return {
        name,
        type: 'anytls',
        server: host,
        port,
        outbound: clean({
          type: 'anytls',
          server: host,
          server_port: port,
          password: p.password,
          tls: tlsFrom()
        })
      }
    case 'socks5':
      return {
        name,
        type: 'socks',
        server: host,
        port,
        outbound: clean({
          type: 'socks',
          server: host,
          server_port: port,
          version: '5',
          username: p.username || undefined,
          password: p.password || undefined
        })
      }
    case 'http':
      return {
        name,
        type: 'http',
        server: host,
        port,
        outbound: clean({
          type: 'http',
          server: host,
          server_port: port,
          username: p.username || undefined,
          password: p.password || undefined,
          tls: p.tls ? tlsFrom() : undefined
        })
      }
    default:
      return null
  }
}

export function parsedToNode(p: Parsed, extra: Partial<ServerNode> = {}): ServerNode {
  return {
    id: uid(),
    name: p.name,
    type: p.type,
    server: p.server,
    port: p.port,
    outbound: p.outbound,
    createdAt: Date.now(),
    ...extra
  }
}

/** Уникальный ключ узла — чтобы не плодить дубли при обновлении подписки */
export function nodeKey(n: { type: string; server: string; port: number; outbound: Record<string, unknown> }): string {
  const ob = n.outbound as Record<string, any>
  const secret = ob.uuid || ob.password || ''
  return `${n.type}|${n.server}|${n.port}|${secret}`
}
