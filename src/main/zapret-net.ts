/* Сетевые проверки для теста стратегий zapret.

   Утилита сборки гоняет curl.exe; здесь то же самое на node:https, чтобы не
   зависеть от наличия curl и не плодить процессы на каждую проверку. Трафик
   Electron перехватывает WinDivert так же, как любой другой программы, так
   что проверка честная. Смысл статусов повторяет «test zapret.ps1». */

import http from 'node:http'
import https from 'node:https'
import { execFile } from 'node:child_process'
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

/** HEAD-запрос, как `curl -I`: любой полученный ответ, даже 404, — успех */
export function httpCheck(url: string, pin: TlsPin, timeoutMs = 4000): Promise<{ status: ZapretCheckStatus; detail?: string }> {
  return new Promise((resolve) => {
    let done = false
    const mod = url.startsWith('https:') ? https : http
    const req = mod.request(url, { method: 'HEAD', agent: false, headers: { 'user-agent': 'curl/8.9.1' }, ...tlsOptions(pin) }, (res) => {
      res.resume()
      finish('ok', String(res.statusCode))
    })
    const timer = setTimeout(() => finish('error', 'таймаут'), timeoutMs)
    function finish(status: ZapretCheckStatus, detail?: string): void {
      if (done) return
      done = true
      clearTimeout(timer)
      req.destroy()
      resolve({ status, detail })
    }
    connectTimeout(req, Math.min(2000, timeoutMs), () => finish('error', 'нет соединения'))
    req.on('error', (e: NodeJS.ErrnoException) => finish(classify(e), e.code))
    req.end()
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

/** Один ICMP-пинг системной утилитой: «12 ms» или «Timeout» — как в отчёте сборки */
export function ping(host: string): Promise<string> {
  return new Promise((resolve) => {
    if (!/^[\w.:\-]+$/.test(host) || host.startsWith('-')) return resolve('Timeout')
    const args = process.platform === 'win32' ? ['-n', '1', '-w', '1000', host] : ['-c', '1', '-t', '2', host]
    /* Вывод ping локализован и идёт в OEM-кодировке, поэтому ищем не слово
       «время», а число прямо перед TTL= — TTL не переводится. */
    execFile('ping', args, { windowsHide: true, timeout: 5000, encoding: 'latin1' }, (_e, stdout) => {
      const m = String(stdout).match(/[=<]\s*([\d.]+)[^=<\d\r\n]*ttl=/i) ?? String(stdout).match(/time[=<]([\d.]+)/i)
      resolve(m ? `${Math.round(parseFloat(m[1]))} ms` : 'Timeout')
    })
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
