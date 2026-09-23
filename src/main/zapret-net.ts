/* Сетевые проверки для теста стратегий zapret.

   Проверка доступности меряет не рукопожатие, а настоящую загрузку: провайдеры
   любят пропускать TLS и «замораживать» соединение после первых 16–20 КБ, и
   HEAD-запрос такой сайт посчитал бы рабочим. Трафик Electron перехватывает
   WinDivert так же, как любой другой программы, так что проверка честная.
   DPI-чекеры повторяют «test zapret.ps1» сборки. */

import http from 'node:http'
import https from 'node:https'
import { connect } from 'node:net'
import { randomBytes } from 'node:crypto'
import type { ZapretCheckStatus } from '@shared/types'

export type TlsPin = 'auto' | '1.2' | '1.3'

export const CHECKS: { label: string; pin: TlsPin }[] = [
  { label: 'HTTP', pin: 'auto' },
  { label: 'TLS1.2', pin: '1.2' },
  { label: 'TLS1.3', pin: '1.3' }
]

const tlsOptions = (pin: TlsPin): https.RequestOptions =>
  pin === 'auto' ? {} : { minVersion: `TLSv${pin}`, maxVersion: `TLSv${pin}` }

/* Подмену DNS и сертификата утилита сборки считает отдельным признаком —
   провайдер отвечает за сайт сам. Неподдержанную версию TLS в провал не пишет. */
function classify(e: NodeJS.ErrnoException): ZapretCheckStatus {
  const code = String(e?.code ?? '')
  const msg = String(e?.message ?? '')
  if (/ENOTFOUND|EAI_AGAIN|CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ALTNAME|DEPTH_ZERO/i.test(code) || /certificate|self.signed/i.test(msg)) {
    return 'ssl'
  }
  if (/UNSUPPORTED_PROTOCOL|NO_PROTOCOLS_AVAILABLE|VERSION_TOO_LOW|VERSION_TOO_HIGH/i.test(code) || /protocol version|wrong version number|unsupported protocol|no protocols available/i.test(msg)) {
    return 'unsup'
  }
  return 'error'
}

/** Таймаут на установку TCP-соединения, отдельно от общего */
function connectTimeout(req: http.ClientRequest, ms: number, onTimeout: () => void): void {
  req.on('socket', (s) => {
    const t = setTimeout(() => s.connecting && onTimeout(), ms)
    s.once('connect', () => clearTimeout(t))
    s.once('close', () => clearTimeout(t))
  })
}

/** Ошибка сети — словами, которые что-то говорят человеку */
function reason(e: NodeJS.ErrnoException): string {
  const code = String(e?.code ?? '')
  if (/ECONNRESET|EPIPE/.test(code)) return 'сброс соединения'
  if (/ECONNREFUSED/.test(code)) return 'соединение отклонено'
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return 'адрес не найден'
  if (/ETIMEDOUT/.test(code)) return 'таймаут'
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ALTNAME|DEPTH_ZERO/.test(code)) return 'подменённый сертификат'
  return code || String(e?.message ?? 'ошибка')
}

export interface LoadResult {
  ok: boolean
  ms: number
  error?: string
}

/**
 * Открывает страницу по-настоящему: читает ответ, пока не придёт minBytes
 * или он не кончится. Код ответа не важен — 404 от сервера тоже значит, что
 * до него дошли. Не важен и объём, если страница маленькая и дочиталась.
 */
export function loadCheck(url: string, timeoutMs = 6000, minBytes = 40 * 1024): Promise<LoadResult> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let got = 0
    let done = false
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(
      url,
      {
        agent: false,
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
          accept: '*/*',
          'accept-encoding': 'identity'
        }
      },
      (res) => {
        res.on('data', (c: Buffer) => {
          got += c.length
          if (got >= minBytes) finish(true)
        })
        res.on('end', () => finish(true))
        res.on('error', (e) => finish(false, reason(e)))
      }
    )
    const timer = setTimeout(
      () => finish(false, got > 0 ? `застряло на ${Math.round(got / 1024)} КБ` : 'таймаут'),
      timeoutMs
    )
    function finish(ok: boolean, error?: string): void {
      if (done) return
      done = true
      clearTimeout(timer)
      req.destroy()
      resolve({ ok, ms: Date.now() - t0, error: ok ? undefined : error })
    }
    connectTimeout(req, Math.min(3000, timeoutMs), () => finish(false, 'нет соединения'))
    req.on('error', (e: NodeJS.ErrnoException) => finish(false, reason(e)))
  })
}

/** Установится ли TCP-соединение — так проверяется приложение Telegram */
export function tcpCheck(host: string, port: number, timeoutMs = 3000): Promise<LoadResult> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const sock = connect({ host, port })
    const finish = (ok: boolean, error?: string): void => {
      clearTimeout(timer)
      sock.destroy()
      resolve({ ok, ms: Date.now() - t0, error })
    }
    const timer = setTimeout(() => finish(false, 'нет соединения'), timeoutMs)
    sock.once('connect', () => finish(true))
    sock.once('error', (e: NodeJS.ErrnoException) => finish(false, reason(e)))
  })
}

export interface DpiResult {
  code: string
  up: number
  down: number
  time: number
  status: ZapretCheckStatus
}

/**
 * Проверка «заморозки на 16–20 КБ»: шлём 64 КБ случайных данных и просим
 * столько же назад. Если отправка пошла, а в ответ за всё время не пришло
 * ни байта — похоже, что DPI обрывает соединение после первых килобайт.
 */
export function dpiCheck(host: string, pin: TlsPin, timeoutS = 5, rangeBytes = 65536): Promise<DpiResult> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let up = 0
    let down = 0
    let code = 'NA'
    let done = false
    const payload = randomBytes(rangeBytes)
    const [hostname, port] = host.split(':')

    const req = https.request(
      {
        host: hostname,
        port: port ? Number(port) : 443,
        servername: hostname,
        path: '/',
        method: 'POST',
        agent: false,
        headers: {
          range: `bytes=0-${rangeBytes - 1}`,
          'content-type': 'application/octet-stream',
          'content-length': rangeBytes,
          'user-agent': 'curl/8.9.1'
        },
        ...tlsOptions(pin)
      },
      (res) => {
        code = String(res.statusCode)
        res.on('data', (c: Buffer) => (down += c.length))
        res.on('end', () => finish('ok'))
        res.on('error', () => finish('error'))
      }
    )
    const timer = setTimeout(() => finish('error'), timeoutS * 1000)

    function finish(kind: ZapretCheckStatus): void {
      if (done) return
      done = true
      clearTimeout(timer)
      req.destroy()
      const time = (Date.now() - t0) / 1000
      let status: ZapretCheckStatus = kind === 'ok' ? 'ok' : kind === 'unsup' ? 'unsup' : 'fail'
      if (status === 'fail' && up > 0 && down === 0 && time >= timeoutS) status = 'blocked'
      resolve({ code, up, down, time: Math.round(time * 100) / 100, status })
    }

    connectTimeout(req, Math.min(3, timeoutS) * 1000, () => finish('error'))
    req.on('error', (e: NodeJS.ErrnoException) => finish(classify(e) === 'unsup' ? 'unsup' : 'error'))

    // Кусками — чтобы видеть, сколько реально ушло до заморозки
    const CHUNK = 8192
    const write = (from: number): void => {
      if (done) return
      if (from >= payload.length) return void req.end()
      const part = payload.subarray(from, from + CHUNK)
      req.write(part, (err) => {
        if (err || done) return
        up += part.length
        write(from + CHUNK)
      })
    }
    write(0)
  })
}

/** Параллельно, но не больше n задач разом */
export async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

/** Скачать с ограничением по времени и размеру */
export async function fetchBuffer(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {}
): Promise<Buffer> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 20000)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'user-agent': 'Prism', 'cache-control': 'no-cache', ...opts.headers }
    })
    if (!res.ok) throw new Error(`${new URL(url).hostname} ответил ${res.status}`)
    const max = opts.maxBytes ?? 32 * 1024 * 1024
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > max) throw new Error('Файл слишком большой')
    if (!res.body) return Buffer.alloc(0)
    /* Считаем по ходу чтения: arrayBuffer() сначала принял бы ответ целиком,
       а Content-Length может отсутствовать или врать — тогда проверка размера
       срабатывала бы уже после того, как память кончилась. */
    const chunks: Buffer[] = []
    let read = 0
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        read += value.byteLength
        if (read > max) throw new Error('Файл слишком большой')
        chunks.push(Buffer.from(value))
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    return Buffer.concat(chunks)
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`${new URL(url).hostname} не ответил вовремя`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}
