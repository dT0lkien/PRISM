import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  AppWindow,
  CheckCircle2,
  Globe,
  Minus,
  Network,
  ScrollText,
  Settings as SettingsIcon,
  Square,
  Copy,
  Waypoints,
  X,
  AlertTriangle,
  ArrowUpCircle,
  Info
} from 'lucide-react'
import { useStore, type Page } from './store'
import { spring } from './ui'
import Dashboard from './pages/Dashboard'
import Servers from './pages/Servers'
import Routing from './pages/Routing'
import Apps from './pages/Apps'
import Connections from './pages/Connections'
import Logs from './pages/Logs'
import SettingsPage from './pages/Settings'
import logo from './assets/logo.png'

const NAV: { id: Page; label: string; icon: typeof Activity }[] = [
  { id: 'dashboard', label: 'Панель', icon: Activity },
  { id: 'servers', label: 'Серверы', icon: Globe },
  { id: 'routing', label: 'Маршруты', icon: Waypoints },
  { id: 'apps', label: 'Приложения', icon: AppWindow },
  { id: 'connections', label: 'Соединения', icon: Network },
  { id: 'logs', label: 'Журнал', icon: ScrollText },
  { id: 'settings', label: 'Настройки', icon: SettingsIcon }
]

const PAGES: Record<Page, () => JSX.Element> = {
  dashboard: Dashboard,
  servers: Servers,
  routing: Routing,
  apps: Apps,
  connections: Connections,
  logs: Logs,
  settings: SettingsPage
}

export default function App(): JSX.Element {
  const { ready, page, setPage, init, core, snap, toasts, dropToast, maximized, connections } = useStore()

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      const i = parseInt(e.key, 10)
      if (i >= 1 && i <= NAV.length) {
        e.preventDefault()
        setPage(NAV[i - 1].id)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [setPage])

  if (!ready) {
    return (
      <div className="app" data-status="stopped">
        <Aurora />
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <motion.img
            src={logo}
            width={56}
            height={56}
            style={{ borderRadius: 14 }}
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
        </div>
      </div>
    )
  }

  const Body = PAGES[page]
  const status = core.status
  const statusCls = status === 'running' ? 'on' : status === 'starting' || status === 'stopping' ? 'busy' : status === 'error' ? 'err' : ''
  const statusText =
    status === 'running'
      ? snap.settings.captureMode === 'tun'
        ? 'TUN активен'
        : 'Прокси активен'
      : status === 'starting'
        ? 'Подключение…'
        : status === 'stopping'
          ? 'Отключение…'
          : status === 'error'
            ? 'Ошибка'
            : 'Отключено'

  return (
    <div className="app" data-status={status}>
      <Aurora />

      <div className="titlebar">
        <div className="brand">
          <img src={logo} alt="" />
          Prism
        </div>
        <div className="spacer" />
        <div className={`tb-status ${statusCls}`}>
          <span className="dot" />
          {statusText}
        </div>
        <div className="win-controls">
          <button onClick={() => window.prism.window.minimize()} aria-label="Свернуть">
            <Minus size={15} />
          </button>
          <button onClick={() => window.prism.window.maximize()} aria-label="Развернуть">
            {maximized ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button className="close" onClick={() => window.prism.window.close()} aria-label="Закрыть">
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="body">
        <nav className="sidebar">
          {NAV.map((n) => {
            const Icon = n.icon
            const active = page === n.id
            const badge =
              n.id === 'servers' && snap.nodes.length
                ? String(snap.nodes.length)
                : n.id === 'connections' && connections.length
                  ? String(connections.length)
                  : n.id === 'apps' && snap.appRules.length
                    ? String(snap.appRules.length)
                    : null
            return (
              <button
                key={n.id}
                className={`nav-item${active ? ' active' : ''}`}
                onClick={() => setPage(n.id)}
                title={n.label}
              >
                {active && <motion.span className="glow" layoutId="nav-glow" transition={spring} />}
                <Icon size={17} strokeWidth={active ? 2.2 : 1.9} />
                <span className="lbl">{n.label}</span>
                {badge && <span className="badge">{badge}</span>}
              </button>
            )
          })}

          <UpdateChip />

          <div className="foot">
            <span>Prism {useStore.getState().info?.appVersion}</span>
            <span>ядро sing-box {useStore.getState().info?.coreVersion}</span>
          </div>
        </nav>

        <main className="main">
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.19, ease: [0.22, 0.8, 0.3, 1] }}
            >
              <Body />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <div className="toasts">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={`toast ${t.kind}`}
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 30, scale: 0.95 }}
              transition={spring}
              onClick={() => dropToast(t.id)}
            >
              {t.kind === 'ok' ? (
                <CheckCircle2 size={16} color="var(--ok)" />
              ) : t.kind === 'warn' ? (
                <AlertTriangle size={16} color="var(--warn)" />
              ) : (
                <Info size={16} color="var(--err)" />
              )}
              <span>{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Когда обновление скачано — заметная кнопка внизу меню */
function UpdateChip(): JSX.Element | null {
  const update = useStore((s) => s.update)
  const setPage = useStore((s) => s.setPage)
  if (update.status !== 'ready' && update.status !== 'available') return null
  const ready = update.status === 'ready'
  return (
    <button className="upd-dot" onClick={() => setPage('settings')} title="Открыть настройки обновления">
      <ArrowUpCircle size={14} />
      {ready ? `Обновление ${update.version} готово` : `Доступна ${update.version}`}
    </button>
  )
}

function Aurora(): JSX.Element {
  return (
    <div className="aurora" aria-hidden>
      <span className="a1" />
      <span className="a2" />
      <span className="a3" />
    </div>
  )
}
