/* Разбор тела подписки → узлы.

   Форматов четыре, и провайдеры отдают любой из них: конфиг sing-box, Clash YAML,
   список ссылок, он же в base64. Логика общая для Windows и iOS — расхождение
   означало бы, что подписка, работающая на десктопе, не открывается на телефоне.

   YAML-парсер передаётся снаружи: в Electron это пакет yaml, а в JavaScriptCore
   на iOS сторонних пакетов нет. Без него Clash YAML просто пропускается —
   остальные три формата разбираются одинаково везде. */

import type { NodeType, ServerNode } from './types'
import { b64decode, clashProxyToNode, looksBase64, parseLink, parsedToNode, uid } from './parsers'

/** Разбор YAML. Возвращает объект или бросает — оба случая обрабатываются. */
export type YamlParser = (text: string) => any

/** Служебные outbound'ы sing-box: это не серверы, а управляющие узлы */
const NOT_A_SERVER = ['selector', 'urltest', 'direct', 'block', 'dns']

export function parseSubscriptionBody(
  body: string,
  subscriptionId?: string,
  parseYaml?: YamlParser
): ServerNode[] {
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
        if (!ob?.type || NOT_A_SERVER.includes(ob.type)) continue
        const { tag, ...rest } = ob
        nodes.push({
          id: uid(),
          name: String(tag ?? `${ob.server}:${ob.server_port}`),
          type: ob.type as NodeType,
          server: String(ob.server ?? ''),
          port: Number(ob.server_port ?? 0),
          outbound: rest,
          subscriptionId,
          createdAt: Date.now()
        })
      }
      if (nodes.length) return nodes
    } catch {
      /* не JSON — идём дальше */
    }
  }

  // 2. Clash YAML — только если парсер дали
  if (parseYaml && /^\s*(proxies|proxy-groups|port|mixed-port)\s*:/m.test(text)) {
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
        return parseSubscriptionBody(decoded, subscriptionId, parseYaml)
      }
    }
  }

  return nodes
}
