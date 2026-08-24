import { app } from 'electron'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { basename, join } from 'node:path'
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

/* В store.json открытым текстом лежат пароли, UUID и ключи всех серверов
   пользователя плюс clashSecret, а файл создавался с 0644 — то есть его мог
   прочитать любой локальный пользователь. Честно: на Windows, а это целевая
   платформа, POSIX-режимы почти не работают и защита держится на ACL профиля;
   реальную пользу это даёт на macOS и Linux. Файлы чинятся сами (режим ставится
   временному файлу, а renameSync переносит его вместе с inode), а вот уже
   созданный каталог mkdirSync не перечиняет — там режим только для новых. */
const FILE_MODE = 0o600
const DIR_MODE = 0o700

const dataDir = () => app.getPath('userData')

export const paths = {
  get data() {
    return dataDir()
  },
  get config() {
    return join(dataDir(), 'store.json')
  },
  /** Предыдущая удачная версия — страховка от порчи основного файла */
  get configBackup() {
    return join(dataDir(), 'store.backup.json')
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
  /** Что пошло не так при чтении — показываем пользователю, а не молчим */
  loadWarning: string | null = null

  load(): StoreData {
    if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true, mode: DIR_MODE })
    const read = (file: string): StoreData => reconcile(JSON.parse(readFileSync(file, 'utf8')))

    try {
      if (existsSync(paths.config)) {
        this.data = read(paths.config)
        return this.data
      }
    } catch (e) {
      console.error('[store] основной файл настроек не читается:', e)
      // Не затираем битый файл: сохраняем его — вдруг данные ещё можно достать
      const dead = join(dataDir(), `store.corrupt-${Date.now()}.json`)
      try {
        renameSync(paths.config, dead)
        // В битой копии лежат те же секреты, что и в основном файле
        chmodSync(dead, FILE_MODE)
      } catch {
        /* не вышло — переживём */
      }
      try {
        if (existsSync(paths.configBackup)) {
          this.data = read(paths.configBackup)
          this.loadWarning = 'Файл настроек был повреждён — данные восстановлены из резервной копии'
          this.save(true)
          return this.data
        }
      } catch (e2) {
        console.error('[store] резервная копия тоже не читается:', e2)
      }
      this.loadWarning = `Файл настроек был повреждён и восстановить его не вышло. Копия сохранена как ${basename(dead)}`
    }

    this.data = defaults()
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
        if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true, mode: DIR_MODE })
        const json = JSON.stringify(this.data, null, 2)
        const tmp = `${paths.config}.tmp`
        /* Права ставим временному файлу: renameSync переносит inode вместе с
           режимом, так что store.json получает 0600 и сам чинится у тех,
           у кого он остался с 0644 от прошлых версий. */
        writeFileSync(tmp, json, { encoding: 'utf8', mode: FILE_MODE })
        // Предыдущую удачную версию оставляем про запас — на случай,
        // если основной файл переживёт неудачное выключение хуже нас
        try {
          if (existsSync(paths.config)) {
            copyFileSync(paths.config, paths.configBackup)
            // copyFileSync не трогает права уже существующего файла — ставим явно
            chmodSync(paths.configBackup, FILE_MODE)
          }
        } catch {
          /* без резервной копии тоже живём */
        }
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
