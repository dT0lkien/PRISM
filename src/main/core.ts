/* Жизненный цикл ядра sing-box: сборка конфига, проверка, запуск, падения, остановка. */

import { EventEmitter } from 'node:events'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { createConnection } from 'node:net'
import type { CoreState, ServerNode } from '@shared/types'
import { buildConfig, TAG_PROXY } from '@shared/config-builder'
import { store, paths } from './store'
import { ClashClient } from './clash'
import { clearSystemProxy, killStrayCores, readSystemProxy, setSystemProxy, isElevated, IS_WIN } from './win'

const exec = promisify(execFile)

export class Core extends EventEmitter {
  readonly clash = new ClashClient()
  private proc: ChildProcess | null = null
  private state: CoreState = {
    status: 'stopped',
    elevated: false,
    captureMode: 'tun',
    systemProxyOn: false
  }
  /** Пользователь сам нажал «стоп» — тогда не перезапускаем */
  private intentionalStop = false
  private crashes = 0
  private crashTimer: NodeJS.Timeout | null = null

  /** PID живого ядра — нужен аварийной уборке на выключении Windows */
  get pid(): number | undefined {
    return this.proc?.pid
  }

  getState(): CoreState {
    return { ...this.state }
  }

  private setState(p: Partial<CoreState>): void {
    this.state = { ...this.state, ...p }
    this.emit('state', this.getState())
  }

  private log(message: string, level = 'info'): void {
    this.emit('log', { level, message, source: 'app' })
  }

  /* ─────────────────────────── запуск ─────────────────────────── */

  async start(): Promise<{ ok: boolean; error?: string; needElevation?: boolean }> {
    if (this.state.status === 'running' || this.state.status === 'starting') {
      return { ok: true }
    }
    const d = store.get()
    const st = d.settings

    if (!d.nodes.length) {
      return { ok: false, error: 'Нет ни одного сервера — добавьте подписку или ссылку на вкладке «Серверы»' }
    }
    if (!existsSync(paths.core)) {
      return { ok: false, error: `Не найдено ядро: ${paths.core}` }
    }

    const elevated = await isElevated()
    if (st.captureMode === 'tun' && !elevated) {
      return {
        ok: false,
        needElevation: true,
        error: 'Режим TUN требует прав администратора'
      }
    }

    this.intentionalStop = false
    this.setState({ status: 'starting', error: undefined, elevated, captureMode: st.captureMode })
    this.log('Запуск ядра…')

    await killStrayCores(paths.runtimeConfig, paths.core)

    // 1. Собираем и проверяем конфиг. Если один из серверов кривой — пробуем только активный.
    let configPath: string
    try {
      configPath = await this.writeAndCheck(d.nodes)
    } catch (fullErr) {
      const active = d.nodes.filter((n) => n.id === d.activeNodeId)
      if (!active.length) {
        this.setState({ status: 'error', error: String(fullErr) })
        return { ok: false, error: String(fullErr) }
      }
      this.log('В списке есть сервер с некорректными параметрами — запускаюсь только с активным', 'warn')
      try {
        configPath = await this.writeAndCheck(active)
      } catch (e) {
        this.setState({ status: 'error', error: String(e) })
        return { ok: false, error: String(e) }
      }
    }

    // 2. Поднимаем процесс
    try {
      this.spawnCore(configPath)
    } catch (e) {
      this.setState({ status: 'error', error: String(e) })
      return { ok: false, error: String(e) }
    }

    // 3. Ждём, пока ответит Clash API
    this.clash.start(st.clashPort, d.clashSecret)
    const ready = await this.clash.waitReady(20000)
    if (!ready) {
      const err = this.state.error || 'Ядро не ответило за 20 секунд — смотрите журнал'
      await this.stop(true)
      this.setState({ status: 'error', error: err })
      return { ok: false, error: err }
    }

    // 4. Системный прокси
    if (st.captureMode === 'proxy') {
      try {
        const saved = await readSystemProxy()
        store.patch({ savedProxy: saved })
        await setSystemProxy(`127.0.0.1:${st.localPort}`)
        this.setState({ systemProxyOn: true })
        this.log(`Системный прокси включён: 127.0.0.1:${st.localPort}`)
      } catch (e) {
        this.log(`Не удалось прописать системный прокси: ${e}`, 'warn')
      }
    }

    this.crashes = 0
    this.setState({ status: 'running', since: Date.now(), activeNodeId: d.activeNodeId, error: undefined })
    this.log(st.captureMode === 'tun' ? 'Подключено, режим TUN' : 'Подключено, системный прокси')
    return { ok: true }
  }

  private async writeAndCheck(nodes: ServerNode[]): Promise<string> {
    const d = store.get()
    const cfg = buildConfig({
      settings: d.settings,
      nodes,
      activeNodeId: d.activeNodeId,
      appRules: d.appRules,
      customRules: d.customRules,
      enabledPresets: d.enabledPresets,
      rulesDir: paths.rules,
      cachePath: paths.cache,
      clashSecret: d.clashSecret
    })
    writeFileSync(paths.runtimeConfig, JSON.stringify(cfg, null, 2), 'utf8')
    try {
      await exec(paths.core, ['check', '-c', paths.runtimeConfig], {
        timeout: 30000,
        windowsHide: true,
        cwd: dirname(paths.core)
      })
    } catch (e: any) {
      const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || String(e.message ?? e)
      throw new Error(`Конфиг не прошёл проверку: ${firstLine(out)}`)
    }
    return paths.runtimeConfig
  }

  private spawnCore(configPath: string): void {
    const proc = spawn(paths.core, ['run', '-c', configPath, '-D', paths.data], {
      windowsHide: true,
      cwd: dirname(paths.core),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.proc = proc

    const onOut = (buf: Buffer, level: string) => {
      for (const line of buf.toString().split('\n')) {
        const t = line.trim()
        if (!t) continue
        // Ядро само по себе пишет уровень в строку — вытаскиваем его
        const m = t.match(/\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL|PANIC)\b/i)
        const lvl = m ? m[1].toLowerCase() : level
        this.emit('log', { level: lvl, message: stripAnsi(t), source: 'core' })
        if (/FATAL|PANIC/i.test(t)) this.setState({ error: stripAnsi(t) })
      }
    }
    proc.stdout?.on('data', (b) => onOut(b, 'info'))
    proc.stderr?.on('data', (b) => onOut(b, 'error'))

    proc.on('exit', (code, signal) => {
      this.proc = null
      if (this.intentionalStop) return
      this.log(`Ядро завершилось (код ${code ?? signal})`, 'error')
      this.handleCrash()
    })
    proc.on('error', (e) => {
      this.proc = null
      this.setState({ status: 'error', error: String(e) })
    })
  }

  /** Ядро упало само — пробуем поднять обратно с нарастающей паузой */
  private handleCrash(): void {
    if (this.state.status === 'stopped' || this.state.status === 'stopping') return
    this.clash.stop()
    this.crashes++
    if (this.crashes > 5) {
      this.log('Ядро падает раз за разом — останавливаюсь. Проверьте настройки сервера.', 'error')
      void this.stop(true)
      this.setState({ status: 'error', error: 'Ядро не удаётся удержать запущенным' })
      return
    }
    const delay = Math.min(1000 * 2 ** (this.crashes - 1), 15000)
    this.setState({ status: 'starting', error: 'Соединение потеряно, переподключаюсь…' })
    this.log(`Перезапуск через ${Math.round(delay / 1000)} с (попытка ${this.crashes} из 5)`, 'warn')
    if (this.crashTimer) clearTimeout(this.crashTimer)
    this.crashTimer = setTimeout(() => {
      this.crashTimer = null
      const keep = this.crashes
      void this.start().then(() => {
        this.crashes = keep
      })
    }, delay)
  }

  /* ─────────────────────────── остановка ─────────────────────────── */

  async stop(silent = false): Promise<void> {
    this.intentionalStop = true
    if (this.crashTimer) {
      clearTimeout(this.crashTimer)
      this.crashTimer = null
    }
    if (this.state.status !== 'stopped') this.setState({ status: 'stopping' })

    this.clash.stop()

    if (this.state.systemProxyOn) {
      await clearSystemProxy(store.get().savedProxy).catch(() => undefined)
      this.setState({ systemProxyOn: false })
      if (!silent) this.log('Системный прокси снят')
    }

    if (this.proc) {
      const p = this.proc
      this.proc = null
      try {
        p.kill()
      } catch {
        /* уже мёртв */
      }
      // Подстраховка: через 3 секунды добиваем
      await new Promise<void>((resolve) => {
        const t = setTimeout(async () => {
          await killStrayCores(paths.runtimeConfig, paths.core)
          resolve()
        }, 3000)
        p.once('exit', () => {
          clearTimeout(t)
          resolve()
        })
      })
    }

    this.crashes = 0
    this.setState({ status: 'stopped', since: undefined, error: undefined })
    if (!silent) this.log('Отключено')
  }

  async restart(): Promise<{ ok: boolean; error?: string; needElevation?: boolean }> {
    const wasRunning = this.state.status === 'running' || this.state.status === 'starting'
    await this.stop(true)
    if (!wasRunning) return { ok: true }
    return this.start()
  }

  /** Применить изменения настроек: если ядро работает — перезапускаем */
  async applyIfRunning(): Promise<void> {
    if (this.state.status === 'running') {
      this.log('Настройки изменились — перезапускаю ядро')
      await this.restart()
    }
  }

  /* ─────────────────────────── узлы ─────────────────────────── */

  /** Переключение сервера на лету, без перезапуска */
  async selectNode(nodeId: string): Promise<boolean> {
    const d = store.get()
    const node = d.nodes.find((n) => n.id === nodeId)
    if (!node) return false
    store.patch({ activeNodeId: nodeId })
    this.setState({ activeNodeId: nodeId })

    if (this.state.status !== 'running') return true
    try {
      const tag = this.tagOf(node)
      await this.clash.selectNode(TAG_PROXY, tag)
      this.log(`Активный сервер: ${tag}`)
      return true
    } catch {
      // Селектора нет (например, узел добавили после запуска) — перезапускаемся
      await this.restart()
      return true
    }
  }

  /** Тег узла в конфиге строится так же, как в config-builder */
  private tagOf(node: ServerNode): string {
    const d = store.get()
    const seen = new Set<string>()
    for (const n of d.nodes) {
      let tag = n.name?.trim() || `${n.server}:${n.port}`
      let i = 2
      const base = tag
      while (seen.has(tag)) tag = `${base} (${i++})`
      seen.add(tag)
      if (n.id === node.id) return tag
    }
    return node.name
  }

  async measure(nodeId: string): Promise<number> {
    const d = store.get()
    const node = d.nodes.find((n) => n.id === nodeId)
    if (!node) return -1
    if (this.state.status === 'running') {
      const delay = await this.clash.delay(this.tagOf(node))
      if (delay > 0) return delay
    }
    return tcpPing(node.server, node.port)
  }

  async measureAll(onEach: (id: string, ms: number) => void): Promise<void> {
    const d = store.get()
    const queue = [...d.nodes]
    const workers = Array.from({ length: 6 }, async () => {
      for (;;) {
        const n = queue.shift()
        if (!n) return
        onEach(n.id, await this.measure(n.id))
      }
    })
    await Promise.all(workers)
  }
}

/* ─────────────────────────── helpers ─────────────────────────── */

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
}

function firstLine(s: string): string {
  const lines = stripAnsi(s)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.find((l) => /FATAL|ERROR|error|invalid|missing/i.test(l)) ?? lines[0] ?? s
}

/** Время TCP-рукопожатия до сервера — грубая, но мгновенная оценка */
export function tcpPing(host: string, port: number, timeout = 5000): Promise<number> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const sock = createConnection({ host, port, timeout })
    const done = (v: number) => {
      sock.removeAllListeners()
      sock.destroy()
      resolve(v)
    }
    sock.once('connect', () => done(Date.now() - t0))
    sock.once('timeout', () => done(-1))
    sock.once('error', () => done(-1))
  })
}

export const core = new Core()
export { IS_WIN }
