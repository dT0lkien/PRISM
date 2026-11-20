/* Загрузка и разбор подписок: base64-списки, plain-ссылки, Clash YAML, sing-box JSON. */

import { nodeKey, parseLink, parsedToNode, uid } from '@shared/parsers'
import { parseSubscriptionBody } from '@shared/subscriptions'
import type { ImportResult, ServerNode, Subscription } from '@shared/types'

export { parseSubscriptionBody } from '@shared/subscriptions'

const UA = `sing-box/${process.platform === 'darwin' ? '1.13.15' : '1.14.4'} (Prism)`

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

/* Потолок на размер тела подписки. Реальные списки — десятки-сотни килобайт,
   так что 10 МБ это полсотни запасов, а не ограничение для честного сервера. */
const MAX_BODY_BYTES = 10 * 1024 * 1024
const TOO_BIG = 'Ответ подписки больше 10 МБ — это не похоже на список серверов'

/* Читаем тело потоком и обрываем по счётчику: `res.text()` буферизует ответ
   целиком, поэтому враждебный (или просто сломанный) сервер подписки укладывал
   привилегированный main-процесс в OOM. Таймаут в 30 секунд от этого не спасает —
   на быстром канале за это время приезжает более чем достаточно. Особенно важно,
   что подписки обновляются сами раз в 12 часов: отказ воспроизводится без участия
   пользователя, а падение main оставляет ядро с живым TUN-адаптером и мёртвый
   прокси в реестре — ровно то, против чего написана вся «Уборка за собой». */
async function readBodyCapped(res: Response): Promise<string> {
  /* Content-Length может отсутствовать и может врать, поэтому он тут только
     быстрый предварительный отсев — решает фактически прочитанное. */
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error(TOO_BIG)
  if (!res.body) return res.text()

  const reader = res.body.getReader()
  /* stream: true обязателен: иначе многобайтные символы на границе чанков
     побьются, а в именах серверов регулярно попадаются кириллица и эмодзи. */
  const decoder = new TextDecoder('utf-8')
  let read = 0
  let out = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      read += value.byteLength
      if (read > MAX_BODY_BYTES) throw new Error(TOO_BIG)
      out += decoder.decode(value, { stream: true })
    }
  } finally {
    /* Обрываем закачку, чтобы на превышении не тянуть остаток впустую. */
    await reader.cancel().catch(() => {})
  }
  return out + decoder.decode()
}

export async function fetchSubscription(url: string, subscriptionId?: string): Promise<FetchedSub> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000)
  })
  /* redirect: 'follow' уводит куда угодно, поэтому схему проверяем на итоговом
     URL, а не на исходном. Дыры тут нет (file:// undici всё равно не резолвит),
     это страховка на случай подписки, редиректящей на нестандартную схему. */
  if (res.url && !/^https?:$/.test(new URL(res.url).protocol)) {
    throw new Error('Подписка увела на не-HTTP адрес — так делать нельзя')
  }
  if (!res.ok) throw new Error(`Сервер подписки ответил ${res.status} ${res.statusText}`)
  const body = await readBodyCapped(res)
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
