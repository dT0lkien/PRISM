/* Обновление приложения через релизы GitHub.
   Скачиваем только по явному согласию: пользователь VPN может сидеть на
   мобильном интернете, и 100 МБ в фоне — это неуважение к его трафику. */

import { EventEmitter } from 'node:events'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '@shared/types'
import { store } from './store'

const CHECK_INTERVAL = 6 * 3600_000
const FIRST_CHECK_DELAY = 25_000

class Updater extends EventEmitter {
  private state: UpdateState = { status: 'idle' }
  private timer: NodeJS.Timeout | null = null
  private wired = false
  /** Что сделать перед перезапуском: погасить ядро и снять системный прокси */
  onBeforeInstall: (() => Promise<void>) | null = null

  getState(): UpdateState {
    return { ...this.state }
  }

  private set(p: Partial<UpdateState>): void {
    this.state = { ...this.state, ...p }
    this.emit('state', this.getState())
  }

  private log(message: string, level = 'info'): void {
    this.emit('log', { level, message, source: 'app' })
  }

  /** Причина, по которой обновиться нельзя, или null */
  private blockedBecause(): string | null {
    if (!app.isPackaged) return 'В режиме разработки обновления не проверяются'
    if (process.env.PORTABLE_EXECUTABLE_FILE) {
      return 'Портативная версия обновляется вручную: скачайте новый файл со страницы релизов'
    }
    return null
  }

  init(): void {
    const blocked = this.blockedBecause()
    if (blocked) {
      this.set({ status: 'unsupported', error: blocked })
      return
    }

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    // Своё логирование: сообщения уходят в журнал приложения
    autoUpdater.logger = null

    if (!this.wired) {
      this.wired = true

      autoUpdater.on('checking-for-update', () => this.set({ status: 'checking', error: undefined }))

      autoUpdater.on('update-available', (info) => {
        this.set({
          status: 'available',
          version: info.version,
          notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
          releasedAt: info.releaseDate,
          checkedAt: Date.now(),
          error: undefined
        })
        this.log(`Доступна версия ${info.version}`)
      })

      autoUpdater.on('update-not-available', () => {
        this.set({ status: 'idle', checkedAt: Date.now(), error: undefined })
      })

      autoUpdater.on('download-progress', (p) => {
        this.set({
          status: 'downloading',
          percent: Math.round(p.percent),
          bytesPerSecond: p.bytesPerSecond,
          transferred: p.transferred,
          total: p.total
        })
      })

      autoUpdater.on('update-downloaded', (info) => {
        this.set({ status: 'ready', version: info.version, percent: 100 })
        this.log(`Версия ${info.version} загружена и готова к установке`)
      })

      autoUpdater.on('error', (e) => {
        const msg = String(e?.message ?? e)
        this.set({ status: 'error', error: friendly(msg) })
        this.log(`Обновление: ${msg}`, 'warn')
      })
    }

    this.schedule()
  }

  /** Фоновая проверка по расписанию */
  private schedule(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (!store.get().settings.autoUpdate) return

    setTimeout(() => {
      if (store.get().settings.autoUpdate) void this.check(true)
    }, FIRST_CHECK_DELAY)

    this.timer = setInterval(() => {
      if (store.get().settings.autoUpdate) void this.check(true)
    }, CHECK_INTERVAL)
  }

  /** Вызывается при смене настроек */
  reschedule(): void {
    if (this.state.status === 'unsupported') return
    this.schedule()
  }

  async check(silent = false): Promise<UpdateState> {
    const blocked = this.blockedBecause()
    if (blocked) {
      this.set({ status: 'unsupported', error: blocked })
      return this.getState()
    }
    // Уже качаем или готово — второй раз не дёргаем
    if (this.state.status === 'downloading' || this.state.status === 'ready') return this.getState()

    try {
      await autoUpdater.checkForUpdates()
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      this.set({ status: 'error', error: friendly(msg), checkedAt: Date.now() })
      if (!silent) this.log(`Не удалось проверить обновления: ${msg}`, 'warn')
    }
    return this.getState()
  }

  async download(): Promise<UpdateState> {
    if (this.state.status !== 'available') return this.getState()
    this.set({ status: 'downloading', percent: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (e: any) {
      this.set({ status: 'error', error: friendly(String(e?.message ?? e)) })
    }
    return this.getState()
  }

  /** Погасить туннель и перезапуститься в установщик */
  async install(): Promise<boolean> {
    if (this.state.status !== 'ready') return false
    this.log('Останавливаю подключение перед установкой обновления')
    try {
      await this.onBeforeInstall?.()
    } catch {
      /* всё равно ставим: установщик перезапишет файлы */
    }
    // isSilent=false — установщик покажет прогресс, isForceRunAfter=true — запустит приложение
    autoUpdater.quitAndInstall(false, true)
    return true
  }
}

/** Сетевые ошибки приходят техническим текстом — переводим на человеческий */
function friendly(msg: string): string {
  if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH/i.test(msg)) return 'Нет связи с GitHub — проверьте интернет'
  if (/ETIMEDOUT|ESOCKETTIMEDOUT/i.test(msg)) return 'GitHub не ответил вовремя'
  if (/ECONNRESET|ECONNREFUSED/i.test(msg)) return 'Соединение с GitHub оборвалось'
  if (/404/.test(msg)) return 'Релиз не найден — возможно, он ещё собирается'
  if (/rate limit/i.test(msg)) return 'GitHub временно ограничил запросы, попробуйте позже'
  return msg.split('\n')[0].slice(0, 200)
}

export const updater = new Updater()
