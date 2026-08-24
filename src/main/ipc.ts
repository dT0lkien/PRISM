import { BrowserWindow, app, clipboard, dialog, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { basename, join, dirname } from 'node:path'
import type { AppRule, ConnectionItem, RoutingRule, Settings, Subscription } from '@shared/types'
import { buildConfig } from '@shared/config-builder'
import { DEFAULT_ENABLED_PRESETS, DEFAULT_SETTINGS } from '@shared/defaults'
import { uid } from '@shared/parsers'
import { store, paths } from './store'
import { core } from './core'
import { updater } from './updater'
import { fetchSubscription, importManual, mergeSubscriptionNodes } from './subs'
import {
  clearSystemProxy,
  getAppIcon,
  hasAutoStartTask,
  isElevated,
  IS_WIN,
  listRunningApps,
  relaunchElevated,
  setAutoStart
} from './win'

const exec = promisify(execFile)

let win: BrowserWindow | null = null
export function setMainWindow(w: BrowserWindow): void {
  win = w
}

const send = (ch: string, payload?: unknown): void => {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload)
}

export function snapshot() {
  const d = store.get()
  return {
    settings: d.settings,
    nodes: d.nodes,
    subscriptions: d.subscriptions,
    appRules: d.appRules,
    customRules: d.customRules,
    enabledPresets: d.enabledPresets,
    activeNodeId: d.activeNodeId,
    totals: d.totals
  }
}

const pushSnapshot = () => send('evt:snapshot', snapshot())
const toast = (kind: 'ok' | 'warn' | 'error', text: string) => send('evt:toast', { kind, text })

/* ─────────────────────── события ядра → окно ─────────────────────── */

let logSeq = 0
let lastConnPush = 0

export function wireCoreEvents(): void {
  core.on('state', (s) => send('evt:state', s))

  core.on('log', (l: { level: string; message: string; source?: string }) => {
    send('evt:log', {
      id: ++logSeq,
      level: l.level,
      message: l.message,
      t: Date.now(),
      source: l.source ?? 'core'
    })
  })

  core.clash.on('traffic', (t: { up: number; down: number; t: number }) => {
    const d = store.get()
    d.totals.up += t.up
    d.totals.down += t.down
    store.save()
    send('evt:traffic', { ...t, totalUp: d.totals.up, totalDown: d.totals.down })
  })

  core.clash.on('connections', (c: { items: ConnectionItem[]; up: number; down: number }) => {
    // Список соединений приходит раз в секунду и бывает объёмным — отдаём не чаще
    const now = Date.now()
    if (now - lastConnPush < 900) return
    lastConnPush = now
    send('evt:connections', c.items.slice(0, 400))
  })

  core.clash.on('log', (l: { level: string; message: string }) => {
    send('evt:log', { id: ++logSeq, level: l.level, message: l.message, t: Date.now(), source: 'core' })
  })

  updater.on('state', (u) => send('evt:update', u))
  updater.on('log', (l: { level: string; message: string }) => {
    send('evt:log', { id: ++logSeq, level: l.level, message: l.message, t: Date.now(), source: 'app' })
  })
}

/* ─────────────────────── регистрация обработчиков ─────────────────────── */

export function registerIpc(): void {
  const h = <A extends unknown[], R>(ch: string, fn: (...a: A) => R | Promise<R>): void => {
    ipcMain.handle(ch, async (_e, ...args) => fn(...(args as A)))
  }

  /* — общее — */
  h('app:bootstrap', async () => {
    let coreVersion = ''
    try {
      const { stdout } = await exec(paths.core, ['version'], { timeout: 10000, windowsHide: true })
      coreVersion = (stdout.match(/sing-box version ([\w.\-]+)/) ?? [])[1] ?? ''
    } catch {
      coreVersion = 'не найдено'
    }
    return {
      snapshot: snapshot(),
      state: core.getState(),
      platform: process.platform,
      elevated: await isElevated(),
      isWindows: IS_WIN,
      appVersion: app.getVersion(),
      coreVersion,
      autoStartTask: await hasAutoStartTask()
    }
  })

  /* — ядро — */
  h('core:start', () => core.start())
  h('core:stop', () => core.stop())
  h('core:restart', () => core.restart())
  h('core:elevate', async () => {
    const ok = await relaunchElevated()
    /* На Windows права получают перезапуском себя через UAC, поэтому старый
       процесс обязан уйти. На macOS «повысить права» — это поставить демон,
       и выходить не нужно: приложение просто начинает его видеть. */
    if (ok && IS_WIN) setTimeout(() => app.exit(0), 400)
    return ok
  })
  h('core:closeConnection', (id: string) => core.clash.closeConnection(id))
  h('core:closeAllConnections', () => core.clash.closeAllConnections())

  /* — обновления — */
  h('update:state', () => updater.getState())
  h('update:check', () => updater.check())
  h('update:download', () => updater.download())
  h('update:install', () => updater.install())

  /* — настройки — */
  h('settings:update', async (patch: Partial<Settings>) => {
    const before = store.get().settings
    const after = store.setSettings(patch)
    pushSnapshot()

    // Изменения, требующие перезапуска ядра
    const restartKeys: (keyof Settings)[] = [
      'captureMode',
      'routingMode',
      'localPort',
      'allowLan',
      'clashPort',
      'tun',
      'dns',
      'discordFix',
      'blockQuic',
      'bypassPrivate',
      'logLevel',
      'extraConfig'
    ]
    if (restartKeys.some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))) {
      await core.applyIfRunning()
    }
    if (before.autoUpdate !== after.autoUpdate) updater.reschedule()
    if (before.autoStart !== after.autoStart || before.startElevated !== after.startElevated) {
      await setAutoStart(after.autoStart, after.startElevated, after.startMinimized).catch((e) =>
        toast('warn', String(e.message ?? e))
      )
    }
    return snapshot()
  })

  h('settings:reset', async () => {
    store.setSettings(structuredClone(DEFAULT_SETTINGS))
    store.patch({ enabledPresets: [...DEFAULT_ENABLED_PRESETS] })
    pushSnapshot()
    await core.applyIfRunning()
    return snapshot()
  })

  /* — серверы — */
  h('nodes:select', (id: string) => core.selectNode(id))

  h('nodes:measure', async (id: string) => {
    const ms = await core.measure(id)
    const d = store.get()
    const n = d.nodes.find((x) => x.id === id)
    if (n) {
      n.latency = ms
      n.latencyCheckedAt = Date.now()
      store.save()
    }
    send('evt:latency', { id, ms })
    return ms
  })

  h('nodes:measureAll', async () => {
    await core.measureAll((id, ms) => {
      const n = store.get().nodes.find((x) => x.id === id)
      if (n) {
        n.latency = ms
        n.latencyCheckedAt = Date.now()
      }
      send('evt:latency', { id, ms })
    })
    store.save()
    pushSnapshot()
  })

  h('nodes:import', (text: string) => {
    const d = store.get()
    const { nodes, result } = importManual(text, d.nodes)
    store.patch({ nodes, activeNodeId: d.activeNodeId ?? nodes[0]?.id })
    pushSnapshot()
    return { result, snapshot: snapshot() }
  })

  h('nodes:remove', (ids: string[]) => {
    const d = store.get()
    const set = new Set(ids)
    const nodes = d.nodes.filter((n) => !set.has(n.id))
    const activeNodeId = set.has(d.activeNodeId ?? '') ? nodes[0]?.id : d.activeNodeId
    store.patch({ nodes, activeNodeId })
    pushSnapshot()
    return snapshot()
  })

  h('nodes:rename', (id: string, name: string) => {
    const n = store.get().nodes.find((x) => x.id === id)
    if (n) n.name = name.trim() || n.name
    store.save()
    pushSnapshot()
    return snapshot()
  })

  h('nodes:exportLinks', () => store.get().nodes.map((n) => n.link).filter(Boolean).join('\n'))

  /* — подписки — */
  h('subs:add', async (url: string, name?: string) => {
    const id = uid()
    try {
      const { nodes: fresh, userInfo } = await fetchSubscription(url, id)
      const d = store.get()
      const { nodes, result } = mergeSubscriptionNodes(d.nodes, fresh, id)
      const sub: Subscription = {
        id,
        name: name?.trim() || hostOf(url),
        url,
        autoUpdate: true,
        intervalHours: 12,
        updatedAt: Date.now(),
        userInfo
      }
      store.patch({
        nodes,
        subscriptions: [...d.subscriptions, sub],
        activeNodeId: d.activeNodeId ?? nodes[0]?.id
      })
      pushSnapshot()
      return { result, snapshot: snapshot() }
    } catch (e: any) {
      return {
        result: { ok: false, added: 0, updated: 0, skipped: 0, names: [], error: String(e.message ?? e) },
        snapshot: snapshot()
      }
    }
  })

  h('subs:update', async (id: string) => {
    const d = store.get()
    const sub = d.subscriptions.find((s) => s.id === id)
    if (!sub) return { result: { ok: false, added: 0, updated: 0, skipped: 0, names: [], error: 'Подписка не найдена' }, snapshot: snapshot() }
    try {
      const { nodes: fresh, userInfo } = await fetchSubscription(sub.url, id)
      const { nodes, result } = mergeSubscriptionNodes(d.nodes, fresh, id)
      sub.updatedAt = Date.now()
      sub.userInfo = userInfo
      sub.lastError = undefined
      const activeGone = !nodes.some((n) => n.id === d.activeNodeId)
      store.patch({ nodes, activeNodeId: activeGone ? nodes[0]?.id : d.activeNodeId })
      pushSnapshot()
      return { result, snapshot: snapshot() }
    } catch (e: any) {
      sub.lastError = String(e.message ?? e)
      store.save()
      pushSnapshot()
      return { result: { ok: false, added: 0, updated: 0, skipped: 0, names: [], error: sub.lastError }, snapshot: snapshot() }
    }
  })

  h('subs:updateAll', async () => {
    for (const s of [...store.get().subscriptions]) {
      try {
        const d = store.get()
        const { nodes: fresh, userInfo } = await fetchSubscription(s.url, s.id)
        const { nodes } = mergeSubscriptionNodes(d.nodes, fresh, s.id)
        s.updatedAt = Date.now()
        s.userInfo = userInfo
        s.lastError = undefined
        store.patch({ nodes })
      } catch (e: any) {
        s.lastError = String(e.message ?? e)
      }
    }
    store.save()
    pushSnapshot()
    return snapshot()
  })

  h('subs:remove', (id: string, withNodes: boolean) => {
    const d = store.get()
    const subscriptions = d.subscriptions.filter((s) => s.id !== id)
    const nodes = withNodes ? d.nodes.filter((n) => n.subscriptionId !== id) : d.nodes
    const activeNodeId = nodes.some((n) => n.id === d.activeNodeId) ? d.activeNodeId : nodes[0]?.id
    store.patch({ subscriptions, nodes, activeNodeId })
    pushSnapshot()
    return snapshot()
  })

  h('subs:patch', (id: string, patch: Partial<Subscription>) => {
    const s = store.get().subscriptions.find((x) => x.id === id)
    if (s) Object.assign(s, patch)
    store.save()
    pushSnapshot()
    return snapshot()
  })

  /* — правила — */
  h('rules:setApps', async (rules: AppRule[]) => {
    store.patch({ appRules: rules })
    pushSnapshot()
    await core.applyIfRunning()
    return snapshot()
  })

  h('rules:setCustom', async (rules: RoutingRule[]) => {
    store.patch({ customRules: rules })
    pushSnapshot()
    await core.applyIfRunning()
    return snapshot()
  })

  h('rules:setPresets', async (ids: string[]) => {
    store.patch({ enabledPresets: ids })
    pushSnapshot()
    await core.applyIfRunning()
    return snapshot()
  })

  /* — приложения — */
  h('apps:list', () => listRunningApps())
  h('apps:icon', (path: string) => getAppIcon(path))
  h('apps:pick', async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, {
      title: 'Выберите программу',
      properties: ['openFile'],
      filters: IS_WIN ? [{ name: 'Программы', extensions: ['exe'] }] : [{ name: 'Все файлы', extensions: ['*'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const path = r.filePaths[0]
    const exe = basename(path)
    return { exe, name: exe.replace(/\.exe$/i, ''), path, running: false, icon: await getAppIcon(path) }
  })

  /* — конфиг — */
  h('config:preview', () => {
    const d = store.get()
    return JSON.stringify(
      buildConfig({
        settings: d.settings,
        nodes: d.nodes,
        activeNodeId: d.activeNodeId,
        appRules: d.appRules,
        customRules: d.customRules,
        enabledPresets: d.enabledPresets,
        rulesDir: paths.rules,
        cachePath: paths.cache,
        clashSecret: '••••••••'
      }),
      null,
      2
    )
  })

  h('config:validate', async (json: string) => {
    if (!json.trim()) return { ok: true }
    try {
      JSON.parse(json)
    } catch (e: any) {
      return { ok: false, error: `Некорректный JSON: ${e.message}` }
    }
    // Проверяем итоговый конфиг целиком — вдруг пользователь сломал структуру
    const d = store.get()
    const merged = buildConfig({
      settings: { ...d.settings, extraConfig: json },
      nodes: d.nodes,
      activeNodeId: d.activeNodeId,
      appRules: d.appRules,
      customRules: d.customRules,
      enabledPresets: d.enabledPresets,
      rulesDir: paths.rules,
      cachePath: paths.cache,
      clashSecret: d.clashSecret
    })
    const tmp = join(paths.data, 'check.json')
    try {
      writeFileSync(tmp, JSON.stringify(merged, null, 2))
      await exec(paths.core, ['check', '-c', tmp], { timeout: 30000, windowsHide: true, cwd: dirname(paths.core) })
      return { ok: true }
    } catch (e: any) {
      const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || String(e.message ?? e)
      return { ok: false, error: out.split('\n')[0].replace(/\x1B\[[0-9;]*[A-Za-z]/g, '') }
    }
  })

  h('config:export', async () => {
    if (!win) return null
    const r = await dialog.showSaveDialog(win, {
      title: 'Сохранить конфиг sing-box',
      defaultPath: 'sing-box.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return null
    const d = store.get()
    const cfg = buildConfig({
      settings: d.settings,
      nodes: d.nodes,
      activeNodeId: d.activeNodeId,
      appRules: d.appRules,
      customRules: d.customRules,
      enabledPresets: d.enabledPresets,
      rulesDir: paths.rules,
      cachePath: paths.cache,
      clashSecret: d.clashSecret
    })
    writeFileSync(r.filePath, JSON.stringify(cfg, null, 2), 'utf8')
    return r.filePath
  })

  /* — система — */
  h('system:openDataDir', () => {
    if (!existsSync(paths.data)) mkdirSync(paths.data, { recursive: true })
    shell.openPath(paths.data)
  })
  h('system:resetSystemProxy', async () => {
    await clearSystemProxy(store.get().savedProxy)
    toast('ok', 'Системный прокси сброшен')
  })
  h('system:setAutoStart', async (enabled: boolean, elevated: boolean) => {
    try {
      await setAutoStart(enabled, elevated, store.get().settings.startMinimized)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e.message ?? e) }
    }
  })
  h('system:openExternal', (url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })
  h('system:clipboardRead', () => clipboard.readText())
  h('system:clipboardWrite', (t: string) => clipboard.writeText(t))

  /* — окно — */
  h('window:minimize', () => win?.minimize())
  h('window:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
  h('window:close', () => win?.close())
  h('window:isMaximized', () => !!win?.isMaximized())
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'Подписка'
  }
}
