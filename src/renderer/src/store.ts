import { create } from 'zustand'
import type {
  AppRule,
  ConnectionItem,
  CoreState,
  LogEntry,
  RoutingRule,
  Settings,
  TrafficSample
} from '@shared/types'
import type { BootstrapInfo, Snapshot } from '../../preload'
import { DEFAULT_SETTINGS } from '@shared/defaults'

export type Page = 'dashboard' | 'servers' | 'routing' | 'apps' | 'connections' | 'logs' | 'settings'

export interface Toast {
  id: number
  kind: 'ok' | 'warn' | 'error'
  text: string
}

const MAX_LOGS = 2500
const MAX_SAMPLES = 90

interface State {
  ready: boolean
  page: Page
  info: BootstrapInfo | null
  snap: Snapshot
  core: CoreState
  traffic: TrafficSample[]
  totals: { up: number; down: number }
  session: { up: number; down: number }
  logs: LogEntry[]
  connections: ConnectionItem[]
  toasts: Toast[]
  busy: boolean
  maximized: boolean
  logPaused: boolean

  init: () => Promise<void>
  setPage: (p: Page) => void
  toast: (kind: Toast['kind'], text: string) => void
  dropToast: (id: number) => void
  setSnap: (s: Snapshot) => void

  connect: () => Promise<void>
  disconnect: () => Promise<void>
  toggle: () => Promise<void>

  patchSettings: (p: Partial<Settings>) => Promise<void>
  setAppRules: (r: AppRule[]) => Promise<void>
  setCustomRules: (r: RoutingRule[]) => Promise<void>
  setPresets: (ids: string[]) => Promise<void>
  clearLogs: () => void
  setLogPaused: (v: boolean) => void
}

const emptySnap: Snapshot = {
  settings: DEFAULT_SETTINGS,
  nodes: [],
  subscriptions: [],
  appRules: [],
  customRules: [],
  enabledPresets: [],
  totals: { up: 0, down: 0 }
}

let toastSeq = 0

export const useStore = create<State>((set, get) => ({
  ready: false,
  page: 'dashboard',
  info: null,
  snap: emptySnap,
  core: { status: 'stopped', elevated: false, captureMode: 'tun', systemProxyOn: false },
  traffic: [],
  totals: { up: 0, down: 0 },
  session: { up: 0, down: 0 },
  logs: [],
  connections: [],
  toasts: [],
  busy: false,
  maximized: false,
  logPaused: false,

  async init() {
    const api = window.prism
    const info = await api.bootstrap()
    set({ info, snap: info.snapshot, core: info.state, totals: info.snapshot.totals, ready: true })
    applyTheme(info.snapshot.settings)

    api.events.onState((s) => set({ core: s }))
    api.events.onSnapshot((s) => {
      set({ snap: s })
      applyTheme(s.settings)
    })
    api.events.onMaximize((v) => set({ maximized: v }))

    api.events.onTraffic((t) => {
      const st = get()
      const traffic = [...st.traffic, { up: t.up, down: t.down, t: t.t }].slice(-MAX_SAMPLES)
      set({ traffic, totals: { up: t.totalUp, down: t.totalDown } })
    })

    api.events.onConnections((items) => {
      const session = items.reduce(
        (a, c) => ({ up: a.up + c.upload, down: a.down + c.download }),
        { up: 0, down: 0 }
      )
      set({ connections: items, session })
    })

    api.events.onLog((l) => {
      if (get().logPaused) return
      const logs = get().logs
      set({ logs: logs.length >= MAX_LOGS ? [...logs.slice(-MAX_LOGS + 200), l] : [...logs, l] })
    })

    api.events.onLatency(({ id, ms }) => {
      const nodes = get().snap.nodes.map((n) => (n.id === id ? { ...n, latency: ms } : n))
      set({ snap: { ...get().snap, nodes } })
    })

    api.events.onToast((t) => get().toast(t.kind, t.text))
  },

  setPage: (page) => set({ page }),

  toast(kind, text) {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, kind, text }] })
    setTimeout(() => get().dropToast(id), kind === 'error' ? 7000 : 3800)
  },

  dropToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },

  setSnap: (snap) => {
    set({ snap })
    applyTheme(snap.settings)
  },

  async connect() {
    if (get().busy) return
    set({ busy: true })
    try {
      const r = await window.prism.core.start()
      if (!r.ok) {
        if (r.needElevation) {
          set({ busy: false })
          return // модалку про UAC покажет дашборд
        }
        get().toast('error', r.error ?? 'Не удалось подключиться')
      }
    } finally {
      set({ busy: false })
    }
  },

  async disconnect() {
    if (get().busy) return
    set({ busy: true })
    try {
      await window.prism.core.stop()
      set({ traffic: [], connections: [], session: { up: 0, down: 0 } })
    } finally {
      set({ busy: false })
    }
  },

  async toggle() {
    const s = get().core.status
    if (s === 'running' || s === 'starting') await get().disconnect()
    else await get().connect()
  },

  async patchSettings(p) {
    const snap = await window.prism.settings.update(p)
    set({ snap })
    applyTheme(snap.settings)
  },

  async setAppRules(r) {
    set({ snap: { ...get().snap, appRules: r } })
    const snap = await window.prism.rules.setApps(r)
    set({ snap })
  },

  async setCustomRules(r) {
    set({ snap: { ...get().snap, customRules: r } })
    const snap = await window.prism.rules.setCustom(r)
    set({ snap })
  },

  async setPresets(ids) {
    set({ snap: { ...get().snap, enabledPresets: ids } })
    const snap = await window.prism.rules.setPresets(ids)
    set({ snap })
  },

  clearLogs: () => set({ logs: [] }),
  setLogPaused: (logPaused) => set({ logPaused })
}))

/* ─────────── тема и акцент ─────────── */

const ACCENTS: Record<string, [string, string]> = {
  aurora: ['#38bdf8', '#a78bfa'],
  violet: ['#a78bfa', '#f472b6'],
  ember: ['#fb923c', '#f43f5e'],
  ocean: ['#22d3ee', '#3b82f6'],
  rose: ['#fb7185', '#c084fc'],
  lime: ['#a3e635', '#22d3ee']
}

export function applyTheme(s: Settings): void {
  const root = document.documentElement
  root.dataset.theme = s.theme
  const [a1, a2] = ACCENTS[s.accent] ?? ACCENTS.aurora
  root.style.setProperty('--accent-1', a1)
  root.style.setProperty('--accent-2', a2)
}

export { ACCENTS }

/* ─────────── форматирование ─────────── */

export function bytes(n: number, digits = 1): string {
  if (!n || n < 0) return '0 Б'
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1)
  const v = n / 1024 ** i
  return `${v.toFixed(i === 0 ? 0 : v >= 100 ? 0 : digits)} ${u[i]}`
}

export function speed(n: number): string {
  return `${bytes(n)}/с`
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const p = (v: number) => String(v).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`
}

export function timeOf(t: number): string {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds()
  ).padStart(2, '0')}`
}
