import { app } from 'electron'
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { AppRule, RoutingRule, ServerNode, Settings, Subscription, ZapretConfig, ZapretTestSummary } from '@shared/types'
import { DEFAULT_ENABLED_PRESETS, DEFAULT_SETTINGS } from '@shared/defaults'
import { DEFAULT_ZAPRET } from '@shared/zapret'

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
  /** Версия, для которой уже показали окно «что изменилось» */
  seenVersion?: string
  /** Сохранённые настройки системного прокси до нашего вмешательства */
  savedProxy?: { enable: string; server: string; override: string }
  /** Обход DPI без VPN */
  zapret: ZapretConfig
  /** Какая из установленных сборок zapret активна */
  zapretPack?: string
  zapretLastTest?: ZapretTestSummary
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
  /** Резервный снимок настроек и серверов */
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

function defaultSettings(): Settings {
  const settings = structuredClone(DEFAULT_SETTINGS)
  if (process.platform === 'win32' && app.isPackaged) settings.autoStart = true
  return settings
}

function defaults(): StoreData {
  return {
    settings: defaultSettings(),
    nodes: [],
    subscriptions: [],
    appRules: [],
    customRules: [],
    enabledPresets: [...DEFAULT_ENABLED_PRESETS],
    clashSecret: randomBytes(16).toString('hex'),
    totals: { up: 0, down: 0 },
    zapret: structuredClone(DEFAULT_ZAPRET)
  }
}

/** Мержим сохранённое поверх дефолтов, чтобы новые поля появлялись у старых пользователей */
function reconcile(saved: Partial<StoreData>): StoreData {
  const d = defaults()
  const { startElevated, ...s } = (saved.settings ?? {}) as Partial<Settings> & { startElevated?: boolean }
  // Старые Windows-сборки по умолчанию не регистрировали автозапуск.
  if (startElevated !== undefined && process.platform === 'win32' && app.isPackaged) s.autoStart = true
  return {
    ...d,
    ...saved,
    settings: {
      ...d.settings,
      ...s,
      tun: { ...d.settings.tun, ...s.tun },
      dns: { ...d.settings.dns, ...s.dns }
    },
    clashSecret: saved.clashSecret || d.clashSecret,
    totals: saved.totals ?? d.totals,
    zapret: {
      ...d.zapret,
      ...saved.zapret,
      lists: { ...d.zapret.lists, ...saved.zapret?.lists }
    }
  }
}

function writeSnapshot(file: string, json: string): void {
  const temp = `${file}.tmp`
  const fd = openSync(temp, 'w', FILE_MODE)
  try {
    chmodSync(temp, FILE_MODE)
    writeFileSync(fd, json, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temp, file)
  if (process.platform !== 'win32') {
    const dir = openSync(dataDir(), 'r')
    try {
      fsyncSync(dir)
    } finally {
      closeSync(dir)
    }
  }
}

class Store {
  private data: StoreData = defaults()
  private saveTimer: NodeJS.Timeout | null = null
  /** Что пошло не так при чтении — показываем пользователю, а не молчим */
  loadWarning: string | null = null

  load(): StoreData {
    mkdirSync(dataDir(), { recursive: true, mode: DIR_MODE })
    this.loadWarning = null
    const damaged: string[] = []
    for (const file of [paths.config, paths.configBackup, `${paths.config}.tmp`, `${paths.configBackup}.tmp`]) {
      let raw: string
      try {
        raw = readFileSync(file, 'utf8')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw e
      }
      try {
        const saved = JSON.parse(raw)
        if (!saved?.settings || typeof saved.settings !== 'object' ||
            Array.isArray(saved.settings) || !Array.isArray(saved.nodes)) {
          throw new Error('В файле отсутствуют настройки или список серверов')
        }
        this.data = reconcile(saved)
      } catch (e) {
        console.error('[store] повреждённый снимок:', basename(file), e)
        const dead = join(dataDir(), `store.corrupt-${Date.now()}-${basename(file)}`)
        renameSync(file, dead)
        chmodSync(dead, FILE_MODE)
        damaged.push(basename(dead))
        continue
      }
      if (file !== paths.config) {
        // Сохраняем восстановленный временный файл, пока создаётся новая копия.
        if (file.endsWith('.tmp')) renameSync(file, paths.config)
        this.loadWarning = 'Основной файл настроек недоступен. Настройки и серверы восстановлены из сохранённой копии.'
        this.save(true)
      }
      return this.data
    }

    if (damaged.length) {
      this.loadWarning = `Не удалось восстановить настройки. Повреждённые файлы сохранены: ${damaged.join(', ')}`
    }
    this.data = defaults()
    return this.data
  }

  get(): StoreData {
    return this.data
  }

  patch(p: Partial<StoreData>): StoreData {
    this.data = { ...this.data, ...p }
    this.save(true)
    return this.data
  }

  setSettings(s: Partial<Settings>): Settings {
    this.data.settings = {
      ...this.data.settings,
      ...s,
      tun: { ...this.data.settings.tun, ...(s.tun ?? {}) },
      dns: { ...this.data.settings.dns, ...(s.dns ?? {}) }
    }
    this.save(true)
    return this.data.settings
  }

  resetSettings(): Settings {
    return this.setSettings(defaultSettings())
  }

  /** Запись с задержкой — чтобы не долбить диск на каждый чих */
  save(immediate = false): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    const write = () => {
      this.saveTimer = null
      try {
        mkdirSync(dataDir(), { recursive: true, mode: DIR_MODE })
        const json = JSON.stringify(this.data, null, 2)
        writeSnapshot(paths.config, json)
        writeSnapshot(paths.configBackup, json)
      } catch (e) {
        console.error('[store] ошибка записи:', e)
      }
    }
    if (immediate) write()
    else this.saveTimer = setTimeout(write, 400)
  }
}

export const store = new Store()
