/* Загрузка и разбор подписок: base64-списки, plain-ссылки, Clash YAML, sing-box JSON. */

import { parse as parseYaml } from 'yaml'
import { b64decode, clashProxyToNode, looksBase64, nodeKey, parseLink, parsedToNode, uid } from '@shared/parsers'
import type { ImportResult, NodeType, ServerNode, Subscription } from '@shared/types'

const UA = 'sing-box/1.13.15 (Prism)'

export interface FetchedSub {
  nodes: ServerNode[]
  userInfo?: Subscription['userInfo']
}

function parseUserInfo(header: string | null): Subscription['userInfo'] | undefined {
  if (!header) return undefined
  const out: Record<string, number> = {}
  for (const part of header.split(';')) {
    const [k, v] = part.split('=').map((s) => s?.trim())
    if (k && v && Number.isFinite(Number(v))) out[k] = Number(v)
  }
  return Object.keys(out).length ? out : undefined
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
        if (!ob?.type || ['selector', 'urltest', 'direct', 'block', 'dns'].includes(ob.type)) continue
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

export async function fetchSubscription(url: string, subscriptionId?: string): Promise<FetchedSub> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000)
  })
  if (!res.ok) throw new Error(`Сервер подписки ответил ${res.status} ${res.statusText}`)
  const body = await res.text()
  const nodes = parseSubscriptionBody(body, subscriptionId)
  if (!nodes.length) throw new Error('В ответе не нашлось ни одного сервера — проверьте ссылку')
  return { nodes, userInfo: parseUserInfo(res.headers.get('subscription-userinfo')) }
}

/**
 * Вливаем свежие узлы подписки в общий список:
 * старые узлы этой подписки, которых больше нет, удаляем;
 * совпадающие — обновляем, сохраняя id (чтобы не слетал выбранный сервер).
 */
export function mergeSubscriptionNodes(
  existing: ServerNode[],
  fresh: ServerNode[],
  subscriptionId: string
): { nodes: ServerNode[]; result: ImportResult } {
  const keep = existing.filter((n) => n.subscriptionId !== subscriptionId)
  const old = existing.filter((n) => n.subscriptionId === subscriptionId)
  const oldByKey = new Map(old.map((n) => [nodeKey(n), n]))

  let added = 0
  let updated = 0
  const merged: ServerNode[] = fresh.map((n) => {
    const prev = oldByKey.get(nodeKey(n))
    if (prev) {
      updated++
      return { ...n, id: prev.id, createdAt: prev.createdAt, latency: prev.latency }
    }
    added++
    return n
  })

  return {
    nodes: [...keep, ...merged],
    result: {
      ok: true,
      added,
      updated,
      skipped: Math.max(0, old.length - updated),
      names: merged.map((n) => n.name)
    }
  }
}

/** Добавление вручную: ссылки/JSON/YAML из буфера обмена или поля ввода */
export function importManual(text: string, existing: ServerNode[]): { nodes: ServerNode[]; result: ImportResult } {
  const fresh = parseSubscriptionBody(text)
  if (!fresh.length) {
    return { nodes: existing, result: { ok: false, added: 0, updated: 0, skipped: 0, names: [], error: 'Не удалось распознать ни одного сервера' } }
  }
  const keys = new Set(existing.map(nodeKey))
  const toAdd = fresh.filter((n) => !keys.has(nodeKey(n)))
  return {
    nodes: [...existing, ...toAdd],
    result: {
      ok: true,
      added: toAdd.length,
      updated: 0,
      skipped: fresh.length - toAdd.length,
      names: toAdd.map((n) => n.name)
    }
  }
}
