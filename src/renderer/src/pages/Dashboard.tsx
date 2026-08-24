import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowDown,
  ArrowUp,
  Gauge,
  Globe2,
  MessageCircle,
  Power,
  Route,
  ShieldCheck,
  Timer,
  Zap,
  Activity,
  Server,
  ShieldAlert
} from 'lucide-react'
import { bytes, duration, speed, useStore } from '../store'
import { Modal, Ping, Segmented, Switch, spring } from '../ui'
import type { CaptureMode, GraphStyle, RoutingMode } from '@shared/types'

const ROUTING_LABELS: Record<RoutingMode, { label: string; hint: string }> = {
  smart: { label: 'Умный', hint: 'Российские сайты и игры — напрямую, остальное — через VPN' },
  global: { label: 'Через VPN', hint: 'Весь трафик идёт в туннель, кроме локальной сети' },
  whitelist: { label: 'Список', hint: 'Всё напрямую, в туннель — только выбранные приложения и правила' },
  direct: { label: 'Напрямую', hint: 'Туннель поднят, но трафик через него не идёт' }
}

export default function Dashboard(): JSX.Element {
  const { core, snap, traffic, totals, session, toggle, busy, patchSettings, setPage, info } = useStore()
  const [uptime, setUptime] = useState(0)
  const [elevAsk, setElevAsk] = useState(false)

  const running = core.status === 'running'
  const starting = core.status === 'starting' || core.status === 'stopping'
  const active = snap.nodes.find((n) => n.id === snap.activeNodeId)

  useEffect(() => {
    if (!running || !core.since) {
      setUptime(0)
      return
    }
    const t = setInterval(() => setUptime(Date.now() - core.since!), 1000)
    setUptime(Date.now() - core.since)
    return () => clearInterval(t)
  }, [running, core.since])

  const last = traffic[traffic.length - 1]

  /* Повышение прав. На Windows приложение перезапускается через UAC и этот
     процесс умирает. На macOS перезапуск не нужен: ставится помощник, после
     чего надо лишь перечитать сведения о системе — elevated станет true. */
  const elevate = async (): Promise<void> => {
    try {
      if (!(await window.prism.core.elevate())) {
        useStore.getState().toast('warn', 'Установка отменена')
        return
      }
    } catch (e) {
      useStore.getState().toast('error', String((e as Error)?.message ?? e))
      return
    }
    if (info?.isWindows) return // сейчас перезапустимся
    useStore.setState({ info: await window.prism.bootstrap() })
    setElevAsk(false)
    const r = await window.prism.core.start()
    if (!r.ok) useStore.getState().toast('error', r.error ?? 'Не удалось подключиться')
  }

  const onPower = async (): Promise<void> => {
    if (running || starting) return void toggle()
    if (snap.settings.captureMode === 'tun' && info && !info.elevated) {
      setElevAsk(true)
      return
    }
    const r = await window.prism.core.start()
    if (!r.ok) {
      if (r.needElevation) setElevAsk(true)
      else useStore.getState().toast('error', r.error ?? 'Не удалось подключиться')
    }
  }

  const statusTitle = running
    ? 'Защищено'
    : starting
      ? core.status === 'starting'
        ? 'Подключение…'
        : 'Отключение…'
      : core.status === 'error'
        ? 'Не удалось подключиться'
        : 'Отключено'

  const statusSub = running
    ? `${active?.name ?? 'сервер не выбран'} · ${snap.settings.captureMode === 'tun' ? 'TUN, весь трафик системы' : 'системный прокси'}`
    : core.error
      ? core.error
      : snap.nodes.length
        ? 'Нажмите кнопку, чтобы подключиться'
        : 'Сначала добавьте сервер на вкладке «Серверы»'

  return (
    <>
      <div className="dash">
        <div className="col" style={{ gap: 20 }}>
          <div className="card hero">
            <PowerControl running={running} busy={starting || busy} onClick={onPower} error={core.status === 'error'} />

            <h2>{statusTitle}</h2>
            <div className="sub">{statusSub}</div>

            <div className="row wrap" style={{ marginTop: 20, gap: 10, justifyContent: 'center' }}>
              <Segmented<CaptureMode>
                id="capture"
                value={snap.settings.captureMode}
                onChange={(v) => patchSettings({ captureMode: v })}
                options={[
                  { value: 'tun', label: 'TUN', icon: <Globe2 size={14} /> },
                  { value: 'proxy', label: 'Системный прокси', icon: <Route size={14} /> }
                ]}
              />
              <Segmented<RoutingMode>
                id="routing"
                value={snap.settings.routingMode}
                onChange={(v) => patchSettings({ routingMode: v })}
                options={(['smart', 'global', 'whitelist', 'direct'] as RoutingMode[]).map((v) => ({
                  value: v,
                  label: ROUTING_LABELS[v].label
                }))}
              />
            </div>
            <div className="dim" style={{ fontSize: 12, marginTop: 9, textAlign: 'center' }}>
              {ROUTING_LABELS[snap.settings.routingMode].hint}
            </div>

            <div className="stat-grid">
              <Stat k="Скачивание" icon={<ArrowDown size={11} />} v={speed(last?.down ?? 0)} />
              <Stat k="Отдача" icon={<ArrowUp size={11} />} v={speed(last?.up ?? 0)} />
              <Stat k="За сеанс" icon={<Zap size={11} />} v={bytes(session.down + session.up)} />
              <Stat k="Время" icon={<Timer size={11} />} v={running ? duration(uptime) : '—'} />
            </div>

            <TrafficGraph style={snap.settings.graphStyle} />
          </div>

          <TopApps />
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="card pad">
            <div className="row" style={{ marginBottom: 14 }}>
              <Server size={15} className="mut" />
              <b style={{ fontSize: 13.5, flex: 1 }}>Сервер</b>
              <button className="btn sm ghost" onClick={() => setPage('servers')}>
                Сменить
              </button>
            </div>
            {active ? (
              <div className="col" style={{ gap: 7 }}>
                <div className="row">
                  <span className="grow ell" style={{ fontWeight: 550 }}>
                    {active.name}
                  </span>
                  <Ping ms={active.latency} />
                </div>
                <div className="dim" style={{ fontSize: 12 }}>
                  {active.type.toUpperCase()} · {active.server}:{active.port}
                </div>
              </div>
            ) : (
              <div className="mut" style={{ fontSize: 13 }}>
                Сервер не выбран
              </div>
            )}
          </div>

          <div className="card pad">
            <div className="row" style={{ marginBottom: 6 }}>
              <ShieldCheck size={15} className="mut" />
              <b style={{ fontSize: 13.5 }}>Быстрые настройки</b>
            </div>

            <Quick
              icon={<MessageCircle size={15} />}
              title="Discord Fix"
              hint="Процессы и домены Discord целиком в туннель, вместе с голосовым UDP"
              on={snap.settings.discordFix}
              onChange={(v) => patchSettings({ discordFix: v })}
            />
            <Quick
              icon={<ShieldAlert size={15} />}
              title="Блокировать QUIC"
              hint="Заставляет браузеры и CDN работать по TCP — так надёжнее через туннель"
              on={snap.settings.blockQuic}
              onChange={(v) => patchSettings({ blockQuic: v })}
            />
            <Quick
              icon={<Gauge size={15} />}
              title="Локальная сеть напрямую"
              hint="Роутер, принтеры и NAS остаются доступными"
              on={snap.settings.bypassPrivate}
              onChange={(v) => patchSettings({ bypassPrivate: v })}
            />
          </div>

          <div className="card pad">
            <div className="row" style={{ marginBottom: 10 }}>
              <b style={{ fontSize: 13.5, flex: 1 }}>Всего передано</b>
            </div>
            <div className="row" style={{ gap: 20 }}>
              <div className="col grow">
                <span className="dim" style={{ fontSize: 11 }}>
                  Скачано
                </span>
                <b className="tnum" style={{ fontSize: 16 }}>
                  {bytes(totals.down)}
                </b>
              </div>
              <div className="col grow">
                <span className="dim" style={{ fontSize: 11 }}>
                  Отправлено
                </span>
                <b className="tnum" style={{ fontSize: 16 }}>
                  {bytes(totals.up)}
                </b>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={elevAsk}
        onClose={() => setElevAsk(false)}
        title={info?.isWindows ? 'Нужны права администратора' : 'Нужен помощник Prism'}
        icon={<ShieldAlert size={18} color="var(--warn)" />}
        footer={
          <>
            <button
              className="btn"
              onClick={() => {
                setElevAsk(false)
                void patchSettings({ captureMode: 'proxy' })
              }}
            >
              Использовать системный прокси
            </button>
            <button className="btn primary" onClick={() => void elevate()}>
              {info?.isWindows ? 'Перезапустить от администратора' : 'Установить помощник'}
            </button>
          </>
        }
      >
        <p className="mut" style={{ fontSize: 13, lineHeight: 1.6 }}>
          Режим <b>TUN</b> создаёт виртуальный сетевой адаптер и перехватывает весь трафик системы, включая UDP —
          без этого не работает голос в Discord и играх. Создавать такой адаптер система разрешает только
          привилегированному процессу.
        </p>
        {info?.isWindows ? (
          <p className="mut" style={{ fontSize: 13, lineHeight: 1.6 }}>
            Приложение перезапустится и запросит подтверждение UAC. Чтобы не подтверждать каждый раз, включите
            «Автозапуск с правами администратора» в настройках.
          </p>
        ) : (
          <p className="mut" style={{ fontSize: 13, lineHeight: 1.6 }}>
            macOS запросит пароль <b>один раз</b> — Prism поставит системный помощник, который и будет поднимать
            туннель. Дальше пароль не спрашивается. Помощник сам снимает туннель, если приложение закрылось или
            упало, так что «зависшего» адаптера после него не остаётся.
          </p>
        )}
        <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          Системный прокси прав не требует, но перехватывает только те программы, которые его учитывают, и не
          передаёт UDP.
        </p>
      </Modal>
    </>
  )
}

/* ─────────────── кнопка питания ─────────────── */

function PowerControl({
  running,
  busy,
  error,
  onClick
}: {
  running: boolean
  busy: boolean
  error: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <div className={`power${running ? ' on' : ''}${busy ? ' busy' : ''}`}>
      <div className="ring" />
      <div className="ring r2" />
      <div className="ring r3" />

      {busy && (
        <motion.div
          className="sweep"
          animate={{ rotate: 360 }}
          transition={{ duration: 1.15, repeat: Infinity, ease: 'linear' }}
        />
      )}

      {running &&
        [0, 1].map((i) => (
          <motion.div
            key={i}
            className="ring"
            style={{ borderColor: 'color-mix(in oklab, var(--accent-1) 50%, transparent)' }}
            initial={{ opacity: 0.5, scale: 0.86 }}
            animate={{ opacity: 0, scale: 1.22 }}
            transition={{ duration: 2.6, repeat: Infinity, delay: i * 1.3, ease: 'easeOut' }}
          />
        ))}

      <motion.button
        onClick={onClick}
        whileTap={{ scale: 0.94 }}
        transition={spring}
        aria-label={running ? 'Отключить' : 'Подключить'}
        style={error && !running ? { borderColor: 'color-mix(in oklab, var(--err) 45%, transparent)' } : undefined}
      >
        <Power size={40} strokeWidth={1.7} />
      </motion.button>
    </div>
  )
}

/* ─────────────── график ─────────────── */

const GW = 600 // ширина в единицах viewBox
const GH = 130
const PAD = 9
const SPAN = 60 // сколько секунд видно
const STEP = GW / SPAN

const clampY = (v: number, lo = 0, hi = GH): number => Math.max(lo, Math.min(hi, v))

/** Catmull-Rom, переведённый в кубические Безье — мягкая линия без изломов */
function smooth(p: { x: number; y: number }[], lo = 0, hi = GH): string {
  if (p.length < 2) return ''
  const f = (n: number): string => n.toFixed(1)
  let d = `M${f(p[0].x)},${f(p[0].y)}`
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]
    const p1 = p[i]
    const p2 = p[i + 1]
    const p3 = p[i + 2] ?? p2
    const t = 0.18
    d +=
      ` C${f(p1.x + (p2.x - p0.x) * t)},${f(clampY(p1.y + (p2.y - p0.y) * t, lo, hi))}` +
      ` ${f(p2.x - (p3.x - p1.x) * t)},${f(clampY(p2.y - (p3.y - p1.y) * t, lo, hi))}` +
      ` ${f(p2.x)},${f(p2.y)}`
  }
  return d
}

/** Плавно подтягивает значение к цели — чтобы масштаб не прыгал при новом пике */
function useEased(target: number): number {
  const [v, setV] = useState(target)
  const ref = useRef(target)
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      let cur = ref.current + (target - ref.current) * 0.16
      if (Math.abs(cur - target) < Math.max(1, target * 0.005)) cur = target
      ref.current = cur
      setV(cur)
      if (cur !== target) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return v
}

function TrafficGraph({ style }: { style: GraphStyle }): JSX.Element {
  const traffic = useStore((s) => s.traffic)
  const [hover, setHover] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const slideRef = useRef<SVGGElement>(null)

  // +2 точки про запас: одна уезжает за левый край во время прокрутки
  const pts = useMemo(() => traffic.slice(-(SPAN + 2)), [traffic])

  const rawDown = useMemo(() => Math.max(64 * 1024, ...pts.map((p) => p.down)), [pts])
  const rawUp = useMemo(() => Math.max(16 * 1024, ...pts.map((p) => p.up)), [pts])
  const dMax = useEased(rawDown)
  const uMax = useEased(rawUp)
  const bMax = useEased(Math.max(rawDown, rawUp))

  /* Горизонтальное скольжение: новый замер появляется справа, полотно уезжает
     влево ровно на шаг за секунду. Под курсором замораживаем, иначе подсказка убегает. */
  const lastT = pts[pts.length - 1]?.t
  useEffect(() => {
    const g = slideRef.current
    if (!g) return
    if (hover !== null) {
      g.style.transition = 'none'
      g.style.transform = 'translateX(0px)'
      return
    }
    g.style.transition = 'none'
    g.style.transform = `translateX(${STEP}px)`
    const raf = requestAnimationFrame(() => {
      g.style.transition = 'transform 1s linear'
      g.style.transform = 'translateX(0px)'
    })
    return () => cancelAnimationFrame(raf)
  }, [lastT, hover])

  const x = (i: number): number => (i - 1) * STEP
  const mid = GH / 2

  const geom = useMemo(() => {
    if (style === 'mirror') {
      const yD = (v: number): number => mid - (v / dMax) * (mid - PAD)
      const yU = (v: number): number => mid + (v / uMax) * (mid - PAD)
      const dP = pts.map((p, i) => ({ x: x(i), y: yD(p.down) }))
      const uP = pts.map((p, i) => ({ x: x(i), y: yU(p.up) }))
      const dLine = smooth(dP, PAD * 0.4, mid)
      const uLine = smooth(uP, mid, GH - PAD * 0.4)
      const close = (path: string): string =>
        path ? `${path} L${x(pts.length - 1).toFixed(1)},${mid} L${x(0).toFixed(1)},${mid} Z` : ''
      return { yD, yU, dLine, uLine, dArea: close(dLine), uArea: close(uLine) }
    }
    const y = (v: number): number => GH - PAD - (v / bMax) * (GH - PAD * 2)
    const dP = pts.map((p, i) => ({ x: x(i), y: y(p.down) }))
    const uP = pts.map((p, i) => ({ x: x(i), y: y(p.up) }))
    const dLine = smooth(dP)
    const uLine = smooth(uP)
    const close = (path: string): string =>
      path ? `${path} L${x(pts.length - 1).toFixed(1)},${GH} L${x(0).toFixed(1)},${GH} Z` : ''
    return { yD: y, yU: y, dLine, uLine, dArea: close(dLine), uArea: close(uLine) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, style, dMax, uMax, bMax])

  const onMove = (e: React.MouseEvent): void => {
    const r = boxRef.current?.getBoundingClientRect()
    if (!r || pts.length < 2) return
    const ux = ((e.clientX - r.left) / r.width) * GW
    setHover(Math.max(1, Math.min(pts.length - 1, Math.round(ux / STEP) + 1)))
  }

  const hp = hover !== null ? pts[hover] : null
  const hx = hover !== null ? x(hover) : 0
  const tipSide = hx > GW * 0.72 ? 'right' : hx < GW * 0.28 ? 'left' : 'mid'

  return (
    <div className="graph" ref={boxRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--accent-1)' }} />
          Скачивание
        </span>
        <span>
          <i style={{ background: 'var(--accent-2)' }} />
          Отдача
        </span>
      </div>

      {/* Подписи масштаба — иначе непонятно, о каких величинах речь */}
      {style === 'mirror' ? (
        <>
          <span className="scale top">{speed(dMax)}</span>
          <span className="scale bottom">{speed(uMax)}</span>
        </>
      ) : (
        <span className="scale top">{speed(bMax)}</span>
      )}

      <svg viewBox={`0 0 ${GW} ${GH}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="g-down" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-1)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--accent-1)" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="g-up" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--accent-2)" stopOpacity="0.42" />
            <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {style === 'mirror' ? (
          <line x1="0" y1={mid} x2={GW} y2={mid} stroke="var(--line-2)" strokeWidth="1" />
        ) : (
          [0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" y1={GH * f} x2={GW} y2={GH * f} stroke="var(--line)" strokeWidth="1" />
          ))
        )}

        <g ref={slideRef}>
          {geom.uArea && <path d={geom.uArea} fill="url(#g-up)" />}
          {geom.dArea && <path d={geom.dArea} fill="url(#g-down)" />}
          {geom.uLine && (
            <path d={geom.uLine} fill="none" stroke="var(--accent-2)" strokeWidth="1.7" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          )}
          {geom.dLine && (
            <path d={geom.dLine} fill="none" stroke="var(--accent-1)" strokeWidth="2.1" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          )}

          {hp && (
            <>
              <line x1={hx} y1="0" x2={hx} y2={GH} stroke="var(--line-2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <circle cx={hx} cy={geom.yD(hp.down)} r="3.5" fill="var(--accent-1)" stroke="var(--bg)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              <circle cx={hx} cy={geom.yU(hp.up)} r="3" fill="var(--accent-2)" stroke="var(--bg)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </g>
      </svg>

      {hp && (
        <div
          className="tip"
          style={{
            left: `${(hx / GW) * 100}%`,
            transform: tipSide === 'right' ? 'translateX(-100%)' : tipSide === 'left' ? 'none' : 'translateX(-50%)'
          }}
        >
          <div className="dim" style={{ fontSize: 10.5, marginBottom: 3 }}>
            {new Date(hp.t).toLocaleTimeString('ru')}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <i style={{ background: 'var(--accent-1)' }} />
            <span className="tnum">{speed(hp.down)}</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <i style={{ background: 'var(--accent-2)' }} />
            <span className="tnum">{speed(hp.up)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────── кто сейчас качает ─────────────── */

function TopApps(): JSX.Element | null {
  const connections = useStore((s) => s.connections)
  const setPage = useStore((s) => s.setPage)

  const rows = useMemo(() => {
    const m = new Map<string, { bytes: number; proxied: number; total: number }>()
    for (const c of connections) {
      const key = c.process || 'прочее'
      const e = m.get(key) ?? { bytes: 0, proxied: 0, total: 0 }
      e.bytes += c.upload + c.download
      e.total++
      if (c.outbound !== 'direct') e.proxied++
      m.set(key, e)
    }
    return [...m.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 6)
  }, [connections])

  if (!rows.length) return null
  const max = Math.max(1, rows[0].bytes)

  return (
    <div className="card pad">
      <div className="row" style={{ marginBottom: 14 }}>
        <Activity size={15} className="mut" />
        <b style={{ fontSize: 13.5, flex: 1 }}>Кто сейчас в сети</b>
        <button className="btn sm ghost" onClick={() => setPage('connections')}>
          Подробно
        </button>
      </div>

      <div className="col" style={{ gap: 11 }}>
        {rows.map((r) => {
          const allProxy = r.proxied === r.total
          const noProxy = r.proxied === 0
          return (
            <div key={r.name} className="col" style={{ gap: 5 }}>
              <div className="row" style={{ gap: 9 }}>
                <span className="ell grow" style={{ fontSize: 12.5, fontWeight: 520 }}>
                  {r.name}
                </span>
                <span className={`chip ${allProxy ? 'acc' : noProxy ? 'ok' : 'warn'}`} style={{ padding: '1px 8px', fontSize: 10.5 }}>
                  {allProxy ? 'через VPN' : noProxy ? 'напрямую' : `${r.proxied} из ${r.total} в VPN`}
                </span>
                <span className="tnum dim" style={{ fontSize: 12, width: 66, textAlign: 'right' }}>
                  {bytes(r.bytes)}
                </span>
              </div>
              <div style={{ height: 4, background: 'var(--panel-3)', borderRadius: 99, overflow: 'hidden' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(r.bytes / max) * 100}%` }}
                  transition={spring}
                  style={{
                    height: '100%',
                    background: noProxy
                      ? 'var(--ok)'
                      : 'linear-gradient(90deg, var(--accent-1), var(--accent-2))'
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─────────────── мелочи ─────────────── */

function Stat({ k, v, icon }: { k: string; v: string; icon?: JSX.Element }): JSX.Element {
  return (
    <div className="stat">
      <span className="k">
        {icon}
        {k}
      </span>
      <span className="v">{v}</span>
    </div>
  )
}

function Quick({
  icon,
  title,
  hint,
  on,
  onChange
}: {
  icon: JSX.Element
  title: string
  hint: string
  on: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <div className="setting" style={{ gap: 12 }}>
      <span style={{ color: on ? 'var(--accent-1)' : 'var(--dim)', transition: 'color .2s' }}>{icon}</span>
      <div className="txt">
        <b>{title}</b>
        <span>{hint}</span>
      </div>
      <div className="ctl">
        <Switch on={on} onChange={onChange} />
      </div>
    </div>
  )
}
