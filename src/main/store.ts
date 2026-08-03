import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { AppRule, RoutingRule, ServerNode, Settings, Subscription } from '@shared/types'
import { DEFAULT_ENABLED_PRESETS, DEFAULT_SETTINGS } from '@shared/defaults'

export interface StoreData {
  settings: Settings
  nodes: ServerNode[]
  subscriptions: Subscription[]
  appRules: AppRule[]
  customRules: RoutingRule[]
  enabledPresets: string[]
  activeNodeId?: string
  clashSecret: string
  totals: { up: number; down: number }
  /** Сохранённые настройки системного прокси до нашего вмешательства */
  savedProxy?: { enable: string; server: string; override: string }
}

const dataDir = () => app.getPath('userData')

export const paths = {
  get data() {
    return dataDir()
  },
  get config() {
    return join(dataDir(), 'store.json')
  },
  get runtimeConfig() {
    return join(dataDir(), 'sing-box.json')
  },
  get cache() {
    return join(dataDir(), 'cache.db')
  },
  get logs() {
    return join(dataDir(), 'logs')
  },
  /** Каталог с ресурсами: в проде — resources/, в деве — из репозитория */
  get resources() {
    return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  },
  get rules() {
    return app.isPackaged ? join(process.resourcesPath, 'rules') : join(app.getAppPath(), 'resources/rules')
  },
  get core() {
    const exe = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box'
    if (app.isPackaged) return join(process.resourcesPath, 'core', exe)
    const plat = process.platform === 'win32' ? 'win' : 'mac'
    return join(app.getAppPath(), 'resources/core', plat, exe)
  }
}

function defaults(): StoreData {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    nodes: [],
    subscriptions: [],
    appRules: [],
    customRules: [],
    enabledPresets: [...DEFAULT_ENABLED_PRESETS],
    clashSecret: randomBytes(16).toString('hex'),
    totals: { up: 0, down: 0 }
  }
}

/** Мержим сохранённое поверх дефолтов, чтобы новые поля появлялись у старых пользователей */
function reconcile(saved: Partial<StoreData>): StoreData {
  const d = defaults()
  const s = saved.settings ?? {}
  return {
    ...d,
    ...saved,
    settings: {
      ...d.settings,
      ...s,
      tun: { ...d.settings.tun, ...(s as Settings).tun },
      dns: { ...d.settings.dns, ...(s as Settings).dns }
    },
    clashSecret: saved.clashSecret || d.clashSecret,
    totals: saved.totals ?? d.totals
  }
}

class Store {
  private data: StoreData = defaults()
  private saveTimer: NodeJS.Timeout | null = null

  load(): StoreData {
    try {
      if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true })
      if (existsSync(paths.config)) {
        this.data = reconcile(JSON.parse(readFileSync(paths.config, 'utf8')))
      }
    } catch (e) {
      console.error('[store] не удалось прочитать конфиг, беру дефолты:', e)
      this.data = defaults()
    }
    return this.data
  }

  get(): StoreData {
    return this.data
  }

  patch(p: Partial<StoreData>): StoreData {
    this.data = { ...this.data, ...p }
    this.save()
    return this.data
  }

  setSettings(s: Partial<Settings>): Settings {
    this.data.settings = {
      ...this.data.settings,
      ...s,
      tun: { ...this.data.settings.tun, ...(s.tun ?? {}) },
      dns: { ...this.data.settings.dns, ...(s.dns ?? {}) }
    }
    this.save()
    return this.data.settings
  }

  /** Запись с задержкой — чтобы не долбить диск на каждый чих */
  save(immediate = false): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    const write = () => {
      this.saveTimer = null
      try {
        if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true })
        const tmp = `${paths.config}.tmp`
        writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
        renameSync(tmp, paths.config)
      } catch (e) {
        console.error('[store] ошибка записи:', e)
      }
    }
    if (immediate) write()
    else this.saveTimer = setTimeout(write, 400)
  }
}

export const store = new Store()
