import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ClipboardPaste,
  Globe,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Zap,
  CalendarClock,
  AlertTriangle
} from 'lucide-react'
import { bytes, useStore } from '../store'
import { Empty, Modal, Ping, Switch, spring } from '../ui'
import type { ServerNode } from '@shared/types'

export default function Servers(): JSX.Element {
  const { snap, setSnap, toast, core } = useStore()
  const [q, setQ] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [subOpen, setSubOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [renaming, setRenaming] = useState<ServerNode | null>(null)
  const [busySub, setBusySub] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return snap.nodes
    return snap.nodes.filter(
      (n) => n.name.toLowerCase().includes(s) || n.server.toLowerCase().includes(s) || n.type.includes(s)
    )
  }, [snap.nodes, q])

  const select = async (n: ServerNode): Promise<void> => {
    await window.prism.nodes.select(n.id)
    setSnap({ ...snap, activeNodeId: n.id })
    if (core.status === 'running') toast('ok', `Переключено на «${n.name}»`)
  }

  const testAll = async (): Promise<void> => {
    setTesting(true)
    try {
      await window.prism.nodes.measureAll()
    } finally {
      setTesting(false)
    }
  }

  const remove = async (ids: string[]): Promise<void> => {
    setSnap(await window.prism.nodes.remove(ids))
  }

  const updateSub = async (id: string): Promise<void> => {
    setBusySub(id)
    try {
      const { result, snapshot } = await window.prism.subs.update(id)
      setSnap(snapshot)
      if (result.ok) toast('ok', `Обновлено: ${result.added} новых, ${result.updated} прежних`)
      else toast('error', result.error ?? 'Не удалось обновить')
    } finally {
      setBusySub(null)
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Серверы</h1>
        <p>Добавьте подписку или вставьте ссылки — Prism понимает vless, vmess, trojan, shadowsocks, hysteria2, tuic и anytls, а также форматы Clash и sing-box.</p>
      </div>

      <div className="row wrap" style={{ marginBottom: 18, gap: 9 }}>
        <div className="search-box">
          <Search size={15} />
          <input
            className="input"
            placeholder="Поиск по названию или адресу"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button className="btn" onClick={testAll} disabled={testing || !snap.nodes.length}>
          <Zap size={15} className={testing ? 'spin' : ''} />
          {testing ? 'Проверяю…' : 'Проверить все'}
        </button>
        <button className="btn" onClick={() => setAddOpen(true)}>
          <Link2 size={15} />
          Вставить ссылки
        </button>
        <button className="btn primary" onClick={() => setSubOpen(true)}>
          <Plus size={15} />
          Подписка
        </button>
      </div>

      {snap.subscriptions.length > 0 && (
        <>
          <div className="section-title">Подписки</div>
          <div className="list" style={{ marginBottom: 8 }}>
            {snap.subscriptions.map((s) => {
              const count = snap.nodes.filter((n) => n.subscriptionId === s.id).length
              const ui = s.userInfo
              const used = (ui?.upload ?? 0) + (ui?.download ?? 0)
              const pct = ui?.total ? Math.min(100, (used / ui.total) * 100) : null
              return (
                <div key={s.id} className="card pad hoverable">
                  <div className="row">
                    <Globe size={16} className="mut" />
                    <div className="grow col" style={{ gap: 2 }}>
                      <b style={{ fontSize: 13.5 }}>{s.name}</b>
                      <span className="dim ell" style={{ fontSize: 11.5, maxWidth: 460 }}>
                        {count} серв. ·{' '}
                        {s.updatedAt ? `обновлено ${new Date(s.updatedAt).toLocaleString('ru')}` : 'ещё не обновлялась'}
                      </span>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <Switch
                        on={s.autoUpdate}
                        onChange={async (v) => setSnap(await window.prism.subs.patch(s.id, { autoUpdate: v }))}
                      />
                      <button className="btn icon sm" onClick={() => updateSub(s.id)} disabled={busySub === s.id} title="Обновить">
                        <RefreshCw size={14} className={busySub === s.id ? 'spin' : ''} />
                      </button>
                      <button
                        className="btn icon sm"
                        title="Удалить подписку вместе с серверами"
                        onClick={async () => setSnap(await window.prism.subs.remove(s.id, true))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {(pct !== null || ui?.expire) && (
                    <div className="row" style={{ marginTop: 11, gap: 14 }}>
                      {pct !== null && (
                        <div className="grow col" style={{ gap: 5 }}>
                          <div className="row dim" style={{ fontSize: 11.5, justifyContent: 'space-between' }}>
                            <span>
                              {bytes(used)} из {bytes(ui!.total!)}
                            </span>
                            <span>{pct.toFixed(0)}%</span>
                          </div>
                          <div style={{ height: 4, background: 'var(--panel-3)', borderRadius: 99, overflow: 'hidden' }}>
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={spring}
                              style={{
                                height: '100%',
                                background:
                                  pct > 90 ? 'var(--err)' : 'linear-gradient(90deg,var(--accent-1),var(--accent-2))'
                              }}
                            />
                          </div>
                        </div>
                      )}
                      {ui?.expire && (
                        <span className="chip">
                          <CalendarClock size={12} />
                          до {new Date(ui.expire * 1000).toLocaleDateString('ru')}
                        </span>
                      )}
                    </div>
                  )}

                  {s.lastError && (
                    <div className="chip err" style={{ marginTop: 10 }}>
                      <AlertTriangle size={12} />
                      {s.lastError}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="section-title">
        Серверы {snap.nodes.length > 0 && <span className="dim">· {filtered.length}</span>}
      </div>

      {!snap.nodes.length ? (
        <Empty
          icon={<Globe size={40} strokeWidth={1.4} />}
          title="Пока пусто"
          text="Добавьте подписку от вашего провайдера или вставьте ссылки на серверы — можно сразу списком."
          action={
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn" onClick={() => setAddOpen(true)}>
                <ClipboardPaste size={15} />
                Вставить ссылки
              </button>
              <button className="btn primary" onClick={() => setSubOpen(true)}>
                <Plus size={15} />
                Добавить подписку
              </button>
            </div>
          }
        />
      ) : (
        <div className="list">
          <AnimatePresence initial={false}>
            {filtered.map((n) => (
              <motion.div
                key={n.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: -8 }}
                transition={spring}
                className={`node${n.id === snap.activeNodeId ? ' active' : ''}`}
                onClick={() => select(n)}
              >
                <span className="mark">{n.type.slice(0, 2)}</span>
                <div className="grow col" style={{ minWidth: 0 }}>
                  <span className="nm ell">{n.name}</span>
                  <span className="meta ell">
                    {n.type} · {n.server}:{n.port}
                    {n.subscriptionId
                      ? ` · ${snap.subscriptions.find((s) => s.id === n.subscriptionId)?.name ?? 'подписка'}`
                      : ''}
                  </span>
                </div>
                <Ping ms={n.latency} />
                <div className="actions">
                  <button
                    className="btn icon sm ghost"
                    title="Проверить"
                    onClick={(e) => {
                      e.stopPropagation()
                      void window.prism.nodes.measure(n.id)
                    }}
                  >
                    <Zap size={14} />
                  </button>
                  <button
                    className="btn icon sm ghost"
                    title="Переименовать"
                    onClick={(e) => {
                      e.stopPropagation()
                      setRenaming(n)
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="btn icon sm ghost"
                    title="Удалить"
                    onClick={(e) => {
                      e.stopPropagation()
                      void remove([n.id])
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <AddLinksModal open={addOpen} onClose={() => setAddOpen(false)} />
      <AddSubModal open={subOpen} onClose={() => setSubOpen(false)} />
      <RenameModal node={renaming} onClose={() => setRenaming(null)} />
    </>
  )
}

/* ─────────────── модалки ─────────────── */

function AddLinksModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { setSnap, toast } = useStore()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!text.trim()) return
    setBusy(true)
    try {
      const { result, snapshot } = await window.prism.nodes.import(text)
      setSnap(snapshot)
      if (result.ok) {
        toast('ok', `Добавлено серверов: ${result.added}${result.skipped ? `, дубликатов пропущено: ${result.skipped}` : ''}`)
        setText('')
        onClose()
      } else {
        toast('error', result.error ?? 'Не удалось распознать')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Добавить серверы"
      icon={<Link2 size={17} className="mut" />}
      footer={
        <>
          <button
            className="btn"
            onClick={async () => setText(await window.prism.system.clipboardRead())}
          >
            <ClipboardPaste size={15} />
            Из буфера
          </button>
          <button className="btn primary" onClick={submit} disabled={busy || !text.trim()}>
            Добавить
          </button>
        </>
      }
    >
      <p className="mut" style={{ fontSize: 12.5 }}>
        Вставьте одну или несколько ссылок (каждая с новой строки), содержимое подписки в base64, конфиг Clash
        (YAML) или sing-box (JSON) — формат определится сам.
      </p>
      <textarea
        className="input"
        style={{ minHeight: 190 }}
        placeholder="vless://…&#10;vmess://…&#10;ss://…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
    </Modal>
  )
}

function AddSubModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { setSnap, toast } = useStore()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!/^https?:\/\//i.test(url.trim())) {
      toast('error', 'Ссылка должна начинаться с http:// или https://')
      return
    }
    setBusy(true)
    try {
      const { result, snapshot } = await window.prism.subs.add(url.trim(), name.trim())
      setSnap(snapshot)
      if (result.ok) {
        toast('ok', `Загружено серверов: ${result.added}`)
        setUrl('')
        setName('')
        onClose()
      } else {
        toast('error', result.error ?? 'Не удалось загрузить подписку')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новая подписка"
      icon={<Globe size={17} className="mut" />}
      footer={
        <button className="btn primary" onClick={submit} disabled={busy || !url.trim()}>
          {busy ? 'Загружаю…' : 'Добавить'}
        </button>
      }
    >
      <div className="col" style={{ gap: 6 }}>
        <label className="dim" style={{ fontSize: 12 }}>
          Ссылка на подписку
        </label>
        <input
          className="input"
          placeholder="https://example.com/sub/abc123"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          spellCheck={false}
          autoFocus
        />
      </div>
      <div className="col" style={{ gap: 6 }}>
        <label className="dim" style={{ fontSize: 12 }}>
          Название (необязательно)
        </label>
        <input className="input" placeholder="Мой провайдер" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <p className="dim" style={{ fontSize: 12 }}>
        Подписка будет обновляться автоматически раз в 12 часов. Выбранный сервер при этом сохранится.
      </p>
    </Modal>
  )
}

function RenameModal({ node, onClose }: { node: ServerNode | null; onClose: () => void }): JSX.Element {
  const { setSnap } = useStore()
  const [name, setName] = useState('')

  const submit = async (): Promise<void> => {
    if (!node) return
    setSnap(await window.prism.nodes.rename(node.id, name))
    onClose()
  }

  return (
    <Modal
      open={!!node}
      onClose={onClose}
      title="Переименовать сервер"
      icon={<Pencil size={17} className="mut" />}
      footer={
        <button className="btn primary" onClick={submit}>
          Сохранить
        </button>
      }
    >
      <input
        className="input"
        defaultValue={node?.name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        autoFocus
      />
    </Modal>
  )
}
