/* Клиент привилегированного демона (macOS).

   Демон гасит ядро, когда отключается последний клиент, — поэтому соединение
   держится открытым всё время работы туннеля, а не открывается на каждый
   запрос. Это же свойство решает то, чему на Windows посвящён раздел
   «Уборка за собой»: упало приложение — туннель ушёл вместе с ним. */

import { connect, type Socket } from 'node:net'
import { EventEmitter } from 'node:events'

export const HELPER_SOCKET = '/Library/Application Support/Prism/run/helper.sock'
/** Версия протокола: не сойдётся — значит helper от прошлой версии приложения. */
export const HELPER_PROTOCOL = '1'

type Reply = Record<string, any>
type Pending = { resolve: (v: Reply) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

export class HelperClient extends EventEmitter {
  private sock: Socket | null = null
  private queue: Pending[] = []
  private buf = ''

  get connected(): boolean {
    return this.sock !== null
  }

  connect(timeoutMs = 4000): Promise<void> {
    if (this.sock) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const s = connect(HELPER_SOCKET)
      const t = setTimeout(() => {
        s.destroy()
        reject(new Error('демон не ответил вовремя'))
      }, timeoutMs)

      s.once('connect', () => {
        clearTimeout(t)
        this.sock = s
        s.on('data', (b) => this.onData(b))
        s.on('close', () => this.onClose())
        s.on('error', () => undefined) // разрыв обработаем в close
        resolve()
      })
      s.once('error', (e) => {
        clearTimeout(t)
        reject(e)
      })
    })
  }

  private onData(b: Buffer): void {
    this.buf += b.toString('utf8')
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim()
      this.buf = this.buf.slice(i + 1)
      if (!line) continue
      let msg: Reply
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      // События идут вперемешку с ответами, различаем по полю ev
      if (typeof msg.ev === 'string') {
        this.emit(msg.ev, msg)
        continue
      }
      const p = this.queue.shift()
      if (p) {
        clearTimeout(p.timer)
        p.resolve(msg)
      }
    }
  }

  private onClose(): void {
    this.sock = null
    for (const p of this.queue.splice(0)) {
      clearTimeout(p.timer)
      p.reject(new Error('соединение с демоном разорвано'))
    }
    this.emit('close')
  }

  request(msg: Record<string, unknown>, timeoutMs = 20000): Promise<Reply> {
    const s = this.sock
    if (!s) return Promise.reject(new Error('нет соединения с демоном'))
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.queue.findIndex((p) => p.timer === timer)
        if (i >= 0) this.queue.splice(i, 1)
        reject(new Error(`демон не ответил на ${msg.cmd}`))
      }, timeoutMs)
      this.queue.push({ resolve, reject, timer })
      s.write(JSON.stringify(msg) + '\n')
    })
  }

  private async expectOk(msg: Record<string, unknown>, timeoutMs?: number): Promise<Reply> {
    const r = await this.request(msg, timeoutMs)
    if (r.ok !== true) throw new Error(String(r.error ?? 'демон отказал без объяснения'))
    return r
  }

  hello(): Promise<Reply> {
    return this.expectOk({ cmd: 'hello' }, 5000)
  }

  /** Конфиг уходит объектом: демон всё равно проверит его сам. */
  startCore(config: unknown, clashPort: number): Promise<number> {
    return this.expectOk({ cmd: 'start', config, clashPort }, 30000).then((r) => Number(r.pid ?? 0))
  }

  stopCore(): Promise<void> {
    return this.expectOk({ cmd: 'stop' }, 15000).then(() => undefined)
  }

  setProxy(port: number): Promise<void> {
    return this.expectOk({ cmd: 'proxy', on: true, port }, 30000).then(() => undefined)
  }

  clearProxy(): Promise<void> {
    return this.expectOk({ cmd: 'proxy', on: false }, 30000).then(() => undefined)
  }

  close(): void {
    this.sock?.end()
    this.sock = null
  }
}

export interface HelperInfo {
  /** Сокет есть и демон отвечает */
  reachable: boolean
  /** Версия протокола совпала с нашей */
  compatible: boolean
  version?: string
  running?: boolean
  error?: string
}

/** Разовая проверка: установлен ли демон и той ли он версии. */
export async function probeHelper(): Promise<HelperInfo> {
  const c = new HelperClient()
  try {
    await c.connect(3000)
    const r = await c.hello()
    const version = String(r.version ?? '')
    return { reachable: true, compatible: version === HELPER_PROTOCOL, version, running: r.running === true }
  } catch (e: any) {
    return { reachable: false, compatible: false, error: String(e.message ?? e) }
  } finally {
    c.close()
  }
}
