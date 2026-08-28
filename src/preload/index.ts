import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppRule,
  ConnectionItem,
  CoreState,
  DetectedApp,
  ImportResult,
  LogEntry,
  RoutingRule,
  ServerNode,
  Settings,
  Subscription,
  TrafficSample, UpdateState } from '@shared/types'

export interface Snapshot {
  settings: Settings
  nodes: ServerNode[]
  subscriptions: Subscription[]
  appRules: AppRule[]
  customRules: RoutingRule[]
  enabledPresets: string[]
  activeNodeId?: string
  totals: { up: number; down: number }
}

export interface BootstrapInfo {
  snapshot: Snapshot
  state: CoreState
  platform: string
  elevated: boolean
  isWindows: boolean
  appVersion: string
  /** Версия, для которой окно «что изменилось» уже показывали */
  seenVersion?: string
  coreVersion: string
  autoStartTask: boolean
}

const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(ch, ...args) as Promise<T>

const on = <T>(ch: string, cb: (v: T) => void): (() => void) => {
  const h = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.off(ch, h)
}

const api = {
  bootstrap: () => invoke<BootstrapInfo>('app:bootstrap'),

  core: {
    start: () => invoke<{ ok: boolean; error?: string; needElevation?: boolean }>('core:start'),
    stop: () => invoke<void>('core:stop'),
    restart: () => invoke<{ ok: boolean; error?: string }>('core:restart'),
    elevate: () => invoke<boolean>('core:elevate'),
    closeConnection: (id: string) => invoke<void>('core:closeConnection', id),
    closeAllConnections: () => invoke<void>('core:closeAllConnections')
  },

  settings: {
    update: (patch: Partial<Settings>) => invoke<Snapshot>('settings:update', patch),
    reset: () => invoke<Snapshot>('settings:reset')
  },

  nodes: {
    select: (id: string) => invoke<boolean>('nodes:select', id),
    measure: (id: string) => invoke<number>('nodes:measure', id),
    measureAll: () => invoke<void>('nodes:measureAll'),
    import: (text: string) => invoke<{ result: ImportResult; snapshot: Snapshot }>('nodes:import', text),
    remove: (ids: string[]) => invoke<Snapshot>('nodes:remove', ids),
    rename: (id: string, name: string) => invoke<Snapshot>('nodes:rename', id, name),
    exportLinks: () => invoke<string>('nodes:exportLinks')
  },

  subs: {
    add: (url: string, name?: string) => invoke<{ result: ImportResult; snapshot: Snapshot }>('subs:add', url, name),
    update: (id: string) => invoke<{ result: ImportResult; snapshot: Snapshot }>('subs:update', id),
    updateAll: () => invoke<Snapshot>('subs:updateAll'),
    remove: (id: string, withNodes: boolean) => invoke<Snapshot>('subs:remove', id, withNodes),
    patch: (id: string, patch: Partial<Subscription>) => invoke<Snapshot>('subs:patch', id, patch)
  },

  rules: {
    setApps: (rules: AppRule[]) => invoke<Snapshot>('rules:setApps', rules),
    setCustom: (rules: RoutingRule[]) => invoke<Snapshot>('rules:setCustom', rules),
    setPresets: (ids: string[]) => invoke<Snapshot>('rules:setPresets', ids)
  },

  apps: {
    list: () => invoke<DetectedApp[]>('apps:list'),
    pick: () => invoke<DetectedApp | null>('apps:pick'),
    icon: (path: string) => invoke<string | undefined>('apps:icon', path)
  },

  config: {
    preview: () => invoke<string>('config:preview'),
    validate: (json: string) => invoke<{ ok: boolean; error?: string }>('config:validate', json),
    export: () => invoke<string | null>('config:export')
  },

  system: {
    openDataDir: () => invoke<void>('system:openDataDir'),
    resetSystemProxy: () => invoke<void>('system:resetSystemProxy'),
    setAutoStart: (enabled: boolean, elevated: boolean) => invoke<{ ok: boolean; error?: string }>('system:setAutoStart', enabled, elevated),
    openExternal: (url: string) => invoke<void>('system:openExternal', url),
    clipboardRead: () => invoke<string>('system:clipboardRead'),
    clipboardWrite: (text: string) => invoke<void>('system:clipboardWrite', text)
  },

  update: {
    state: () => invoke<UpdateState>('update:state'),
    check: () => invoke<UpdateState>('update:check'),
    download: () => invoke<UpdateState>('update:download'),
    install: () => invoke<boolean>('update:install'),
    markSeen: () => invoke<void>('update:seen')
  },

  window: {
    minimize: () => invoke<void>('window:minimize'),
    maximize: () => invoke<void>('window:maximize'),
    close: () => invoke<void>('window:close'),
    isMaximized: () => invoke<boolean>('window:isMaximized')
  },

  events: {
    onState: (cb: (s: CoreState) => void) => on<CoreState>('evt:state', cb),
    onLog: (cb: (l: LogEntry) => void) => on<LogEntry>('evt:log', cb),
    onTraffic: (cb: (t: TrafficSample & { totalUp: number; totalDown: number }) => void) =>
      on<TrafficSample & { totalUp: number; totalDown: number }>('evt:traffic', cb),
    onConnections: (cb: (c: ConnectionItem[]) => void) => on<ConnectionItem[]>('evt:connections', cb),
    onSnapshot: (cb: (s: Snapshot) => void) => on<Snapshot>('evt:snapshot', cb),
    onLatency: (cb: (v: { id: string; ms: number }) => void) => on<{ id: string; ms: number }>('evt:latency', cb),
    onToast: (cb: (t: { kind: 'ok' | 'warn' | 'error'; text: string }) => void) =>
      on<{ kind: 'ok' | 'warn' | 'error'; text: string }>('evt:toast', cb),
    onMaximize: (cb: (v: boolean) => void) => on<boolean>('evt:maximize', cb),
    onUpdate: (cb: (u: UpdateState) => void) => on<UpdateState>('evt:update', cb)
  }
}

export type PrismApi = typeof api

contextBridge.exposeInMainWorld('prism', api)
