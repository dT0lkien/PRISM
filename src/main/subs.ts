/* Загрузка и разбор подписок: base64-списки, plain-ссылки, Clash YAML, sing-box JSON. */

import { parse as parseYaml } from 'yaml'
import { nodeKey } from '@shared/parsers'
import { parseSubscriptionBody as parseBody } from '@shared/subscriptions'
import type { ImportResult, ServerNode, Subscription } from '@shared/types'

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
/** Сам разбор живёт в @shared/subscriptions — общий с iOS. Здесь только
    подключается парсер YAML: на десктопе он есть, в JavaScriptCore его нет. */
export function parseSubscriptionBody(body: string, subscriptionId?: string): ServerNode[] {
  return parseBody(body, subscriptionId, parseYaml)
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
