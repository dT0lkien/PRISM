/* Клиент Clash API ядра sing-box: трафик, логи, соединения, переключение узла, замер задержки. */

import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import type { ConnectionItem } from '@shared/types'

export interface ProxyInfo {
  name: string
  type: string
  now?: string
  all?: string[]
  history: { time: string; delay: number }[]
}

export class ClashClient extends EventEmitter {
  private port = 0
  private secret = ''
  private sockets: WebSocket[] = []
  private stopped = true
  private retry: NodeJS.Timeout | null = null

  get base(): string {
    return `http://127.0.0.1:${this.port}`
  }

  private headers(): Record<string, string> {
    return this.secret ? { Authorization: `Bearer ${this.secret}` } : {}
  }

  start(port: number, secret: string): void {
    this.stop()
    this.port = port
    this.secret = secret
    this.stopped = false
    this.connectAll()
  }

  stop(): void {
    this.stopped = true
    if (this.retry) {
      clearTimeout(this.retry)
      this.retry = null
    }
    for (const s of this.sockets) {
      try {
        s.removeAllListeners()
        s.close()
      } catch {
        /* уже закрыт */
      }
    }
    this.sockets = []
  }

  private connectAll(): void {
    this.open('traffic', (m) => this.emit('traffic', { up: m.up ?? 0, down: m.down ?? 0, t: Date.now() }))
    this.open('logs?level=debug', (m) => {
      if (m?.payload) this.emit('log', { level: String(m.type ?? 'info'), message: String(m.payload) })
    })
    this.open('connections', (m) => this.emit('connections', normalizeConnections(m)))
    this.open('memory', (m) => this.emit('memory', { inuse: m.inuse ?? 0 }))
  }

  private open(path: string, onMessage: (m: any) => void): void {
    if (this.stopped) return
    const sep = path.includes('?') ? '&' : '?'
    const url = `ws://127.0.0.1:${this.port}/${path}${sep}token=${encodeURIComponent(this.secret)}`
    let ws: WebSocket
    try {
      ws = new WebSocket(url, { headers: this.headers(), handshakeTimeout: 5000 })
    } catch {
      this.scheduleRetry(path, onMessage)
      return
    }
    this.sockets.push(ws)

    ws.on('message', (raw) => {
      try {
        onMessage(JSON.parse(raw.toString()))
      } catch {
        /* мусорный кадр — пропускаем */
      }
    })
    ws.on('error', () => {
      /* ошибку обработает close */
    })
    ws.on('close', () => {
      this.sockets = this.sockets.filter((s) => s !== ws)
      this.scheduleRetry(path, onMessage)
    })
  }

  private scheduleRetry(path: string, onMessage: (m: any) => void): void {
    if (this.stopped) return
    setTimeout(() => this.open(path, onMessage), 1500)
  }

  /* ─────────── REST ─────────── */

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { ...this.headers(), 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const text = await res.text()
    return (text ? JSON.parse(text) : {}) as T
  }

  async version(): Promise<{ version: string }> {
    return this.req('/version')
  }

  async proxies(): Promise<Record<string, ProxyInfo>> {
    const r = await this.req<{ proxies: Record<string, ProxyInfo> }>('/proxies')
    return r.proxies ?? {}
  }

  /** Переключить активный узел в селекторе без перезапуска ядра */
  async selectNode(selector: string, node: string): Promise<void> {
    await this.req(`/proxies/${encodeURIComponent(selector)}`, {
      method: 'PUT',
      body: JSON.stringify({ name: node })
    })
  }

  async delay(node: string, url = 'https://www.gstatic.com/generate_204', timeout = 5000): Promise<number> {
    try {
      const r = await this.req<{ delay: number }>(
        `/proxies/${encodeURIComponent(node)}/delay?timeout=${timeout}&url=${encodeURIComponent(url)}`
      )
      return r.delay > 0 ? r.delay : -1
    } catch {
      return -1
    }
  }

  async closeConnection(id: string): Promise<void> {
    await this.req(`/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined)
  }

  async closeAllConnections(): Promise<void> {
    await this.req('/connections', { method: 'DELETE' }).catch(() => undefined)
  }

  /** Дождаться, пока API ответит — значит ядро реально поднялось */
  async waitReady(timeoutMs = 15000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        await this.req('/version')
        return true
      } catch {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    return false
  }
}

function normalizeConnections(m: any): { items: ConnectionItem[]; up: number; down: number } {
  const items: ConnectionItem[] = []
  for (const c of m?.connections ?? []) {
    const md = c.metadata ?? {}
    const path = String(md.processPath ?? '')
    const proc = String(md.process ?? (path ? path.split(/[\\/]/).pop() : '') ?? '')
    items.push({
      id: String(c.id ?? ''),
      host: String(md.host || md.sniffHost || md.destinationIP || ''),
      ip: String(md.destinationIP ?? ''),
      port: Number(md.destinationPort ?? 0),
      network: String(md.network ?? ''),
      process: proc,
      processPath: path,
      outbound: String(c.chains?.[0] ?? ''),
      chains: (c.chains ?? []).map(String),
      upload: Number(c.upload ?? 0),
      download: Number(c.download ?? 0),
      start: Date.parse(c.start ?? '') || Date.now(),
      rule: [c.rule, c.rulePayload].filter(Boolean).join(': ')
    })
  }
  return { items, up: Number(m?.uploadTotal ?? 0), down: Number(m?.downloadTotal ?? 0) }
}
