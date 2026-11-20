import { parse as parseYaml } from 'yaml'
import { b64decode, clashProxyToNode, looksBase64, parseLink, parsedToNode, uid } from './parsers'
import type { NodeType, ServerNode } from './types'

/* Белый список типов outbound, которые разрешено брать из подписки в формате
   sing-box JSON. Тут outbound переносится в конфиг ядра как есть (`...rest`),
   поэтому недоверенный сервер подписки иначе прислал бы любой тип с любыми полями.
   Опасен прежде всего `tor`: ядро запускает по полю `executable_path` внешний
   бинарник с аргументами из `extra_args` — то есть выполнение произвольного кода
   при старте ядра, а в TUN-режиме ядро идёт с правами администратора. Остальные
   служебные типы (selector/urltest/direct/block/dns и т.п.) для узла бессмысленны.
   URI- и Clash-парсеры собирают outbound из фиксированного набора полей, им список
   не нужен — брешь только здесь. */
const ALLOWED_OUTBOUND_TYPES = new Set<NodeType>([
  'vless',
  'vmess',
  'trojan',
  'shadowsocks',
  'hysteria2',
  'hysteria',
  'tuic',
  'anytls',
  'wireguard',
  'ssh',
  'http',
  'socks',
  'shadowtls'
])

/* Поля *_path — ссылки на файлы на этом компьютере: сертификат, ключ, ECH.
   Серверу подписки знать о них неоткуда, а ядро в TUN-режиме читает их с
   правами администратора: ssh-outbound с private_key_path на ~/.ssh/id_ed25519
   предъявил бы личный ключ пользователя чужому серверу. У каждого такого поля
   есть встроенный вариант (certificate, private_key, config), так что честной
   подписке это не мешает. __proto__ заодно: JSON.parse делает его обычным
   ключом, а присваивание — сменой прототипа. */
function dropFilePaths(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropFilePaths)
  if (!v || typeof v !== 'object') return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    if (!k.endsWith('_path') && k !== '__proto__') out[k] = dropFilePaths(x)
  }
  return out
}

/** Текст подписки → массив узлов. Формат определяем по содержимому. */
export function parseSubscriptionBody(body: string, subscriptionId?: string): ServerNode[] {
  const text = body.trim()
  if (!text) return []
  const nodes: ServerNode[] = []

  const pushLinks = (raw: string) => {
    for (const line of raw.split(/\r?\n/)) {
      const l = line.trim()
      if (!l || l.startsWith('#') || l.startsWith('//')) continue
      const p = parseLink(l)
      if (p) nodes.push(parsedToNode(p, { link: l, subscriptionId }))
    }
  }

  // 1. sing-box JSON
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const j = JSON.parse(text)
      const list: any[] = Array.isArray(j) ? j : (j.outbounds ?? [])
      for (const ob of list) {
        if (!ob?.type || !ALLOWED_OUTBOUND_TYPES.has(ob.type)) continue
        const { tag, ...rest } = ob
        nodes.push({
          id: uid(),
          name: String(tag ?? `${ob.server}:${ob.server_port}`),
          type: ob.type as NodeType,
          server: String(ob.server ?? ''),
          port: Number(ob.server_port ?? 0),
          outbound: dropFilePaths(rest) as Record<string, unknown>,
          subscriptionId,
          createdAt: Date.now()
        })
      }
      if (nodes.length) return nodes
    } catch {
      /* не JSON — идём дальше */
    }
  }

  // 2. Clash YAML
  if (/^\s*(proxies|proxy-groups|port|mixed-port)\s*:/m.test(text)) {
    try {
      const y = parseYaml(text)
      for (const p of y?.proxies ?? []) {
        const parsed = clashProxyToNode(p)
        if (parsed) nodes.push(parsedToNode(parsed, { subscriptionId }))
      }
      if (nodes.length) return nodes
    } catch {
      /* не YAML — идём дальше */
    }
  }

  // 3. Список ссылок как есть
  if (/^[a-z0-9]+:\/\//im.test(text)) {
    pushLinks(text)
    if (nodes.length) return nodes
  }

  // 4. base64 от списка ссылок
  if (looksBase64(text)) {
    const decoded = b64decode(text)
    if (decoded) {
      pushLinks(decoded)
      if (nodes.length) return nodes
      // Вложенный YAML/JSON внутри base64
      if (decoded.trim().startsWith('{') || /^\s*proxies\s*:/m.test(decoded)) {
        return parseSubscriptionBody(decoded, subscriptionId)
      }
    }
  }

  return nodes
}
