import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AppWindow,
  FolderOpen,
  Keyboard,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Wifi
} from 'lucide-react'
import { SUGGESTED_APPS } from '@shared/presets'
import { uid } from '@shared/parsers'
import type { AppRule, DetectedApp, RuleAction } from '@shared/types'
import { useStore } from '../store'
import { ActionSeg, Empty, Modal, Switch, spring } from '../ui'

export default function Apps(): JSX.Element {
  const { snap, setAppRules, connections, toast } = useStore()
  const [open, setOpen] = useState(false)
  const rules = snap.appRules

  /** Какие exe сейчас реально ходят в сеть — берём из живых соединений */
  const activeExe = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of connections) {
      if (c.process) m.set(c.process.toLowerCase(), (m.get(c.process.toLowerCase()) ?? 0) + 1)
    }
    return m
  }, [connections])

  const patch = (id: string, p: Partial<AppRule>): void =>
    void setAppRules(rules.map((r) => (r.id === id ? { ...r, ...p } : r)))

  const add = (apps: { exe: string; name: string; path?: string; icon?: string; action?: RuleAction }[]): void => {
    const have = new Set(rules.map((r) => r.exe.toLowerCase()))
    const fresh = apps
      .filter((a) => a.exe && !have.has(a.exe.toLowerCase()))
      .map<AppRule>((a) => ({
        id: uid(),
        exe: a.exe,
        name: a.name || a.exe.replace(/\.exe$/i, ''),
        path: a.path,
        icon: a.icon,
        action: a.action ?? 'proxy',
        enabled: true
      }))
    if (!fresh.length) {
      toast('warn', 'Эти программы уже в списке')
      return
    }
    void setAppRules([...rules, ...fresh])
    toast('ok', `Добавлено: ${fresh.length}`)
  }

  const counts = rules.reduce(
    (a, r) => ({ ...a, [r.action]: (a[r.action] ?? 0) + 1 }),
    {} as Record<RuleAction, number>
  )

  return (
    <>
      <div className="page-head">
        <h1>Приложения</h1>
        <p>
          Точечная маршрутизация по программам. Работает и в режиме TUN, и в режиме системного прокси: Prism
          определяет, какой процесс открыл соединение, и направляет его по вашему правилу. Эти правила имеют
          приоритет над пресетами.
        </p>
      </div>

      <div className="row wrap" style={{ marginBottom: 18, gap: 9 }}>
        <div className="row" style={{ gap: 7 }}>
          {counts.proxy ? <span className="chip acc">через VPN: {counts.proxy}</span> : null}
          {counts.direct ? <span className="chip ok">напрямую: {counts.direct}</span> : null}
          {counts.block ? <span className="chip err">заблокировано: {counts.block}</span> : null}
        </div>
        <div className="grow" />
        <button className="btn primary" onClick={() => setOpen(true)}>
          <Plus size={15} />
          Добавить приложение
        </button>
      </div>

      {!rules.length ? (
        <div className="card">
          <Empty
            icon={<AppWindow size={40} strokeWidth={1.4} />}
            title="Список пуст"
            text="Добавьте программы, для которых нужен особый маршрут. Например, Discord — целиком в туннель, а торрент-клиент и Steam — напрямую."
            action={
              <button className="btn primary" onClick={() => setOpen(true)}>
                <Plus size={15} />
                Добавить приложение
              </button>
            }
          />
        </div>
      ) : (
        <div className="list">
          <AnimatePresence initial={false}>
            {rules.map((r) => {
              const live = activeExe.get(r.exe.toLowerCase())
              return (
                <motion.div
                  key={r.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: -8 }}
                  transition={spring}
                  className="app-row"
                >
                  <Switch on={r.enabled} onChange={(v) => patch(r.id, { enabled: v })} />
                  {r.icon ? (
                    <img className="ico" src={r.icon} alt="" />
                  ) : (
                    <span className="ico ph">
                      <AppWindow size={15} />
                    </span>
                  )}
                  <div className="grow col" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <b className="ell" style={{ fontSize: 13.5, fontWeight: 550 }}>
                        {r.name}
                      </b>
                      {live ? (
                        <span className="chip ok" style={{ padding: '1px 7px', fontSize: 10.5 }}>
                          <Wifi size={10} />
                          {live}
                        </span>
                      ) : null}
                    </div>
                    <span className="dim ell" style={{ fontSize: 11.5 }}>
                      {r.exe}
                      {r.path ? ` · ${r.path}` : ''}
                    </span>
                  </div>
                  <ActionSeg value={r.action} onChange={(a) => patch(r.id, { action: a })} />
                  <button
                    className="btn icon sm ghost"
                    onClick={() => setAppRules(rules.filter((x) => x.id !== r.id))}
                    title="Убрать"
                  >
                    <Trash2 size={14} />
                  </button>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      <AddAppsModal open={open} onClose={() => setOpen(false)} onAdd={add} existing={rules} />
    </>
  )
}

/* ─────────────── выбор приложений ─────────────── */

function AddAppsModal({
  open,
  onClose,
  onAdd,
  existing
}: {
  open: boolean
  onClose: () => void
  onAdd: (a: { exe: string; name: string; path?: string; icon?: string; action?: RuleAction }[]) => void
  existing: AppRule[]
}): JSX.Element {
  const { connections } = useStore()
  const [tab, setTab] = useState<'running' | 'suggested' | 'manual'>('running')
  const [apps, setApps] = useState<DetectedApp[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [manual, setManual] = useState('')

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setApps(await window.prism.apps.list())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && !apps.length) void load()
    if (!open) {
      setPicked(new Set())
      setQ('')
      setManual('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const have = new Set(existing.map((r) => r.exe.toLowerCase()))

  /** Программы с активными соединениями показываем первыми — их и хотят настроить */
  const netExe = useMemo(() => new Set(connections.map((c) => c.process.toLowerCase()).filter(Boolean)), [connections])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return apps
      .filter((a) => !s || a.name.toLowerCase().includes(s) || a.exe.toLowerCase().includes(s))
      .sort((a, b) => {
        const an = netExe.has(a.exe.toLowerCase()) ? 0 : 1
        const bn = netExe.has(b.exe.toLowerCase()) ? 0 : 1
        return an - bn || a.name.localeCompare(b.name, 'ru')
      })
  }, [apps, q, netExe])

  const toggle = (exe: string): void => {
    const n = new Set(picked)
    n.has(exe) ? n.delete(exe) : n.add(exe)
    setPicked(n)
  }

  const commit = (): void => {
    const chosen = apps.filter((a) => picked.has(a.exe))
    if (chosen.length) onAdd(chosen.map((a) => ({ exe: a.exe, name: a.name, path: a.path, icon: a.icon })))
    onClose()
  }

  const browse = async (): Promise<void> => {
    const a = await window.prism.apps.pick()
    if (a) {
      onAdd([{ exe: a.exe, name: a.name, path: a.path, icon: a.icon }])
      onClose()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Добавить приложения"
      icon={<AppWindow size={17} className="mut" />}
      footer={
        <>
          <button className="btn" onClick={browse}>
            <FolderOpen size={15} />
            Указать файл…
          </button>
          {tab === 'manual' ? (
            <button
              className="btn primary"
              disabled={!manual.trim()}
              onClick={() => {
                onAdd(
                  manual
                    .split(/[\n,;]+/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((exe) => ({ exe: exe.endsWith('.exe') ? exe : `${exe}.exe`, name: exe.replace(/\.exe$/i, '') }))
                )
                onClose()
              }}
            >
              Добавить
            </button>
          ) : (
            <button className="btn primary" onClick={commit} disabled={tab === 'running' && !picked.size}>
              {tab === 'running' ? `Добавить${picked.size ? ` (${picked.size})` : ''}` : 'Готово'}
            </button>
          )}
        </>
      }
    >
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {(
          [
            ['running', 'Запущенные', <RefreshCw key="i" size={13} />],
            ['suggested', 'Популярные', <Sparkles key="i" size={13} />],
            ['manual', 'Вручную', <Keyboard key="i" size={13} />]
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {tab === id && <motion.span className="pill" layoutId="apps-tab" transition={spring} />}
            {icon}
            {label}
          </button>
        ))}
      </div>

      {tab === 'running' && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <div className="search-box" style={{ maxWidth: 'none' }}>
              <Search size={15} />
              <input
                className="input"
                placeholder="Поиск среди запущенных программ"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
              />
            </div>
            <button className="btn icon" onClick={load} title="Обновить список">
              <RefreshCw size={15} className={loading ? 'spin' : ''} />
            </button>
          </div>

          <div className="col" style={{ gap: 5, maxHeight: 340, overflowY: 'auto', paddingRight: 4 }}>
            {loading && !apps.length ? (
              <div className="mut" style={{ padding: 24, textAlign: 'center', fontSize: 13 }}>
                Читаю список процессов…
              </div>
            ) : !list.length ? (
              <div className="mut" style={{ padding: 24, textAlign: 'center', fontSize: 13 }}>
                Ничего не найдено
              </div>
            ) : (
              list.map((a) => {
                const already = have.has(a.exe.toLowerCase())
                const on = picked.has(a.exe)
                return (
                  <button
                    key={a.exe}
                    className="app-row"
                    disabled={already}
                    style={{
                      opacity: already ? 0.45 : 1,
                      cursor: already ? 'not-allowed' : 'pointer',
                      borderColor: on ? 'color-mix(in oklab, var(--accent-1) 45%, transparent)' : undefined,
                      background: on ? 'color-mix(in oklab, var(--accent-1) 8%, var(--panel))' : undefined
                    }}
                    onClick={() => !already && toggle(a.exe)}
                  >
                    {a.icon ? (
                      <img className="ico" src={a.icon} alt="" />
                    ) : (
                      <span className="ico ph">
                        <AppWindow size={15} />
                      </span>
                    )}
                    <div className="grow col" style={{ minWidth: 0, textAlign: 'left' }}>
                      <span className="ell" style={{ fontSize: 13, fontWeight: 530 }}>
                        {a.name}
                      </span>
                      <span className="dim ell" style={{ fontSize: 11 }}>
                        {a.exe}
                      </span>
                    </div>
                    {netExe.has(a.exe.toLowerCase()) && (
                      <span className="chip ok" style={{ padding: '1px 7px', fontSize: 10.5 }}>
                        <Wifi size={10} />в сети
                      </span>
                    )}
                    {already && <span className="chip">уже добавлено</span>}
                  </button>
                )
              })
            )}
          </div>
        </>
      )}

      {tab === 'suggested' && (
        <div className="col" style={{ gap: 5, maxHeight: 380, overflowY: 'auto', paddingRight: 4 }}>
          {SUGGESTED_APPS.map((a) => {
            const already = have.has(a.exe.toLowerCase())
            return (
              <div key={a.exe} className="app-row" style={{ opacity: already ? 0.45 : 1 }}>
                <span className="ico ph">
                  <AppWindow size={15} />
                </span>
                <div className="grow col" style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 530 }}>{a.name}</span>
                  <span className="dim" style={{ fontSize: 11 }}>
                    {a.exe}
                  </span>
                </div>
                <span className={`chip ${a.action === 'proxy' ? 'acc' : 'ok'}`}>
                  {a.action === 'proxy' ? 'через VPN' : 'напрямую'}
                </span>
                <button
                  className="btn sm"
                  disabled={already}
                  onClick={() => onAdd([{ exe: a.exe, name: a.name, action: a.action }])}
                >
                  {already ? 'есть' : 'Добавить'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'manual' && (
        <>
          <p className="mut" style={{ fontSize: 12.5 }}>
            Введите имена исполняемых файлов — по одному в строке. Так можно добавить программу, которая сейчас не
            запущена.
          </p>
          <textarea
            className="input"
            style={{ minHeight: 150 }}
            placeholder="Discord.exe&#10;chrome.exe"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            spellCheck={false}
            autoFocus
          />
        </>
      )}
    </Modal>
  )
}
