/* Окна инструментов zapret: диагностика, тест стратегий, hosts, кэш Discord, просмотр списков */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CirclePlay,
  Cloud,
  Copy,
  Eraser,
  ExternalLink,
  FileText,
  FolderOpen,
  Gauge,
  List,
  MessageCircle,
  Music,
  Pause,
  Play,
  RefreshCw,
  Route,
  Send,
  Settings2,
  Smartphone,
  Square,
  Stethoscope,
  Wrench,
  XCircle,
  Zap
} from 'lucide-react'
import type {
  ZapretCheck,
  ZapretCheckStatus,
  ZapretHostsInfo,
  ZapretServiceResult,
  ZapretServiceStatus,
  ZapretStrategyResult,
  ZapretTestKind
} from '@shared/types'
import { serviceName, serviceScore, strategyLabel } from '@shared/zapret'
import { plural, useStore } from '../store'
import { Modal, Segmented } from '../ui'

export type ListName = 'general' | 'google' | 'exclude' | 'ipsetExclude' | 'ipset' | 'extra'

const LIST_TITLES: Record<ListName, string> = {
  general: 'Discord, Cloudflare и DNS-over-HTTPS',
  google: 'YouTube и Google',
  exclude: 'Домены-исключения',
  ipsetExclude: 'Исключённые подсети',
  ipset: 'IPSet',
  extra: 'Домены Prism — Telegram и Spotify'
}

const note = { fontSize: 13, lineHeight: 1.6 } as const

/* ─────────────── диагностика ─────────────── */

function CheckIcon({ level }: { level: ZapretCheck['level'] }): JSX.Element {
  if (level === 'ok') return <CheckCircle2 size={17} color="var(--ok)" />
  if (level === 'warn') return <AlertTriangle size={17} color="var(--warn)" />
  return <XCircle size={17} color="var(--err)" />
}

export function DiagnosticsModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useStore((s) => s.toast)
  const [checks, setChecks] = useState<ZapretCheck[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [fixing, setFixing] = useState('')
  const [showOk, setShowOk] = useState(false)
  const [resetAsk, setResetAsk] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await window.prism.zapret.diagnostics()
      if (r.ok) setChecks(r.checks)
      else setError(r.error)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (open) void run()
    else {
      setChecks(null)
      setShowOk(false)
    }
  }, [open])

  const fix = async (c: ZapretCheck): Promise<void> => {
    if (!c.fix) return
    setFixing(c.id)
    try {
      const r = await window.prism.zapret.fix(c.fix)
      if (r.ok) toast('ok', r.message)
      else toast('error', r.error)
      await run()
    } finally {
      setFixing('')
    }
  }

  const problems = checks?.filter((c) => c.level !== 'ok') ?? []
  const passed = checks?.filter((c) => c.level === 'ok') ?? []

  return (
    <>
      <Modal
        open={open && !resetAsk}
        onClose={onClose}
        wide
        title="Диагностика"
        icon={<Stethoscope size={18} className="mut" />}
        footer={
          <>
            <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => setResetAsk(true)}>
              <Wrench size={15} />
              Сброс сети Windows…
            </button>
            <button className="btn" disabled={busy} onClick={run}>
              <RefreshCw size={15} className={busy ? 'spin' : ''} />
              Проверить снова
            </button>
          </>
        }
      >
        {!checks && busy && (
          <div className="row mut" style={{ ...note, justifyContent: 'center', padding: 30 }}>
            <RefreshCw size={16} className="spin" />
            Проверяю службы, прокси, DNS и конфликтующие программы…
          </div>
        )}
        {error && (
          <div className="upd-notes zap-note warn">
            <AlertTriangle size={16} />
            <span className="grow">{error}</span>
          </div>
        )}
        {checks && (
          <>
            <div className="row" style={{ gap: 10 }}>
              <span className={`chip ${problems.some((c) => c.level === 'error') ? 'err' : problems.length ? 'warn' : 'ok'}`}>
                {problems.length
                  ? `${problems.length} ${plural(problems.length, 'замечание', 'замечания', 'замечаний')}`
                  : 'Всё в порядке'}
              </span>
              <span className="dim" style={{ fontSize: 12.5 }}>
                {problems.length
                  ? 'Начните сверху: ошибки мешают обходу наверняка, предупреждения — иногда.'
                  : 'Частых причин поломок не нашлось. Если обход всё равно не работает — попробуйте другую стратегию.'}
              </span>
            </div>
            <div className="col" style={{ gap: 7 }}>
              {[...problems, ...(showOk ? passed : [])].map((c) => (
                <div key={c.id} className="rule zap-check">
                  <span className="ic">
                    <CheckIcon level={c.level} />
                  </span>
                  <div className="grow col" style={{ minWidth: 0 }}>
                    <b>{c.title}</b>
                    {c.detail && <span>{c.detail}</span>}
                  </div>
                  {c.link && (
                    <button className="btn icon sm ghost" title="Подробнее" onClick={() => window.prism.system.openExternal(c.link!)}>
                      <ExternalLink size={14} />
                    </button>
                  )}
                  {c.fix && (
                    <button className="btn sm" disabled={!!fixing} onClick={() => fix(c)}>
                      {fixing === c.id ? <RefreshCw size={14} className="spin" /> : <Wrench size={14} />}
                      Исправить
                    </button>
                  )}
                </div>
              ))}
            </div>
            {passed.length > 0 && (
              <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowOk(!showOk)}>
                {showOk ? 'Скрыть пройденные' : `Показать пройденные · ${passed.length}`}
              </button>
            )}
          </>
        )}
      </Modal>
      <ResetModal open={open && resetAsk} onClose={() => setResetAsk(false)} />
    </>
  )
}

function ResetModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Сбросить сеть Windows?"
      icon={<Wrench size={18} color="var(--warn)" />}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const r = await window.prism.zapret.resetNetwork()
                if (r.ok) toast('ok', 'Сеть сброшена — перезагрузите компьютер')
                else toast('error', r.error)
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <RefreshCw size={15} className="spin" />}
            Сбросить
          </button>
        </>
      }
    >
      <p className="mut" style={note}>
        Совет из README сборки на случай, когда не подходит ни одна стратегия. Prism выполнит <span className="kbd">netsh winsock reset</span>,{' '}
        <span className="kbd">netsh int ip reset all</span>, <span className="kbd">netsh winhttp reset proxy</span> и{' '}
        <span className="kbd">ipconfig /flushdns</span>.
      </p>
      <p className="mut" style={note}>
        Настройки TCP/IP вернутся к заводским: если у вас вручную прописан IP-адрес или DNS, их придётся задать заново. После сброса
        нужна перезагрузка.
      </p>
    </Modal>
  )
}

/* ─────────────── тест стратегий ─────────────── */

const SERVICE_ICON: Record<string, typeof Cloud> = {
  youtube: CirclePlay,
  discord: MessageCircle,
  'telegram-web': Send,
  'telegram-app': Smartphone,
  spotify: Music,
  cloudflare: Cloud
}

const STATUS_TEXT: Record<ZapretServiceStatus, string> = { ok: 'открывается', partial: 'частично', fail: 'не открывается' }
const STATUS_CLS: Record<ZapretServiceStatus, string> = { ok: 'ok', partial: 'warn', fail: 'err' }

const CHECK_CLS: Record<ZapretCheckStatus, string> = {
  ok: 'ok',
  unsup: 'warn',
  blocked: 'warn',
  ssl: 'err',
  error: 'err',
  fail: 'err'
}

const sec = (ms?: number): string => (ms === undefined ? '' : `${(ms / 1000).toFixed(1).replace('.', ',')} с`)
const okCount = (r: ZapretStrategyResult): number => r.services?.filter((s) => s.status === 'ok').length ?? 0
const rank = (r: ZapretStrategyResult): number =>
  r.started ? (r.services ? serviceScore(r.services) * 1000 + r.services.reduce((a, s) => a + s.ok, 0) : r.ok * 1000 + r.pingOk) : -1

function StatusChip({ s, compact }: { s?: ZapretServiceResult; compact?: boolean }): JSX.Element {
  if (!s) return <span className="dim">—</span>
  return (
    <span className={`chip ${STATUS_CLS[s.status]}`} title={s.status !== 'ok' ? s.error : undefined} style={compact ? { padding: '1px 8px', fontSize: 11 } : undefined}>
      {STATUS_TEXT[s.status]}
      {s.status === 'ok' && s.ms !== undefined && !compact && <span className="dim tnum">· {sec(s.ms)}</span>}
    </span>
  )
}

/** Точка в таблице всех стратегий: цвет — итог сервиса, подсказка — название */
function Dot({ s }: { s: ZapretServiceResult }): JSX.Element {
  const color = s.status === 'ok' ? 'var(--ok)' : s.status === 'partial' ? 'var(--warn)' : 'var(--err)'
  return <i className="zap-dot" style={{ background: color }} title={`${serviceName(s.id)}: ${STATUS_TEXT[s.status]}${s.error && s.status !== 'ok' ? ` — ${s.error}` : ''}`} />
}

/** Что Prism выключил на время теста — в винительном падеже, для «выключил …» и «включаю обратно …» */
const PAUSED_NAME = { vpn: 'VPN', service: 'службу zapret', zapret: 'обход' } as const

export function TestModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const z = useStore((s) => s.zapret)
  const test = useStore((s) => s.zapretTest)
  const cfg = useStore((s) => s.snap.zapret)
  const patchZapret = useStore((s) => s.patchZapret)
  const setPage = useStore((s) => s.setPage)
  const toast = useStore((s) => s.toast)
  const strategies = z.pack?.strategies ?? []
  const [setup, setSetup] = useState(false)
  const [kind, setKind] = useState<ZapretTestKind>('standard')
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)
  const launched = useRef(false)

  const selected = picked ?? new Set(strategies.map((s) => s.id))
  const running = !!test?.running

  const run = async (k: ZapretTestKind = 'standard', ids: string[] = []): Promise<void> => {
    setBusy(true)
    setError('')
    setSetup(false)
    setExpanded(null)
    setShowAll(false)
    try {
      const r = await window.prism.zapret.testStart(k, ids)
      if (!r.ok) setError(r.error)
    } finally {
      setBusy(false)
    }
  }

  // Нажали «Тест» — значит, тест: запускаем сразу, без экрана настроек
  useEffect(() => {
    if (!open) {
      launched.current = false
      return
    }
    if (launched.current) return
    launched.current = true
    if (!useStore.getState().zapretTest?.running) void run()
  }, [open])

  // Пока идёт тест — раз в секунду обновляем «осталось примерно»
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [running])

  const toggle = (id: string): void => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  const useBest = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.prism.zapret.useStrategy(id)
      if (r.ok) {
        toast('ok', `Обход включён со стратегией ${strategyLabel(id)}`)
        onClose()
      } else toast('error', r.error)
    } finally {
      setBusy(false)
    }
  }

  const rows = useMemo(() => [...(test?.results ?? [])].sort((a, b) => rank(b) - rank(a)), [test])
  const best = test?.best ? test.results.find((r) => r.strategy === test.best) : undefined
  const services = test?.kind === 'standard'

  /* ── что показывать ── */
  let body: JSX.Element
  let footer: JSX.Element

  if (setup) {
    body = (
      <>
        <Segmented<ZapretTestKind>
          id="zap-test-kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'standard', label: 'Доступность сервисов' },
            { value: 'dpi', label: 'DPI-чекеры' }
          ]}
        />
        <p className="mut" style={note}>
          {kind === 'standard'
            ? 'То же, что по кнопке «Тест», но можно выбрать стратегии — например, перепроверить две-три лучшие.'
            : 'Для опытных: проверка «заморозки» после 16–20 КБ на серверах разных хостингов из набора hyperion-cs/dpi-checkers. На время теста IPSet переключается на «любой IP». Идёт заметно дольше.'}
        </p>
        <div className="col" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <b style={{ fontSize: 13 }}>Стратегии</b>
            <span className="dim tnum" style={{ fontSize: 12 }}>
              {selected.size} из {strategies.length}
            </span>
            <span className="grow" />
            <button className="btn sm ghost" onClick={() => setPicked(new Set(strategies.map((s) => s.id)))}>
              Все
            </button>
            <button className="btn sm ghost" onClick={() => setPicked(new Set())}>
              Ни одной
            </button>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {strategies.map((s) => (
              <button key={s.id} className={`chip${selected.has(s.id) ? ' acc' : ''}`} style={{ cursor: 'pointer' }} onClick={() => toggle(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </>
    )
    footer = (
      <>
        <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => setSetup(false)}>
          Назад
        </button>
        <button className="btn primary" disabled={busy || !selected.size} onClick={() => run(kind, [...selected])}>
          <Play size={15} />
          Запустить
        </button>
      </>
    )
  } else if (error && !running) {
    const needAdmin = /администратор/i.test(error)
    const foreign = /сторонний winws/i.test(error)
    body = (
      <div className="rule zap-check">
        <span className="ic">
          <XCircle size={17} color="var(--err)" />
        </span>
        <div className="grow col">
          <b>Тест не запустился</b>
          <span>{error}</span>
        </div>
        {needAdmin && (
          <button className="btn sm" onClick={() => window.prism.core.elevate()}>
            Перезапустить от администратора
          </button>
        )}
        {foreign && (
          <button
            className="btn sm"
            onClick={async () => {
              const r = await window.prism.zapret.killForeign()
              if (r.ok) void run()
              else toast('error', r.error)
            }}
          >
            Остановить и проверить
          </button>
        )}
      </div>
    )
    footer = (
      <>
        <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => setSetup(true)}>
          <Settings2 size={15} />
          Настроить…
        </button>
        <button className="btn primary" disabled={busy} onClick={() => run()}>
          <RefreshCw size={15} className={busy ? 'spin' : ''} />
          Проверить снова
        </button>
      </>
    )
  } else if (!test || (busy && !running)) {
    body = (
      <div className="row mut" style={{ ...note, justifyContent: 'center', padding: 30 }}>
        <RefreshCw size={16} className="spin" />
        Готовлю проверку…
      </div>
    )
    footer = <></>
  } else if (running) {
    const elapsed = Date.now() - (test.startedAt ?? Date.now())
    const left = test.done > 0 ? Math.max(0, Math.round(((elapsed / test.done) * (test.total - test.done)) / 60000)) : undefined
    const phase =
      test.phase === 'baseline'
        ? 'Смотрю, что открывается без обхода…'
        : test.phase === 'restore'
          ? `Включаю обратно ${(test.paused ?? []).map((p) => PAUSED_NAME[p]).join(' и ')}…`
          : `Пробую стратегию ${strategyLabel(test.current ?? '')} · ${Math.min(test.done + 1, test.total)} из ${test.total}`
    const bestNow = test.best ? test.results.find((r) => r.strategy === test.best) : undefined
    body = (
      <>
        <div className="col" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 10 }}>
            <b style={{ fontSize: 13.5 }}>{phase}</b>
            <span className="grow" />
            {test.phase === 'strategies' && (
              <span className="dim tnum" style={{ fontSize: 12 }}>
                {left === undefined ? 'считаю время…' : left < 1 ? 'меньше минуты' : `осталось около ${left} мин`}
              </span>
            )}
          </div>
          <div className="zap-progress">
            <i style={{ width: `${test.total ? (test.done / test.total) * 100 : 0}%` }} />
          </div>
        </div>
        {!!test.paused?.length && (
          <div className="upd-notes zap-note">
            <Pause size={16} />
            <span className="grow">
              На время проверки Prism выключил {test.paused.map((p) => PAUSED_NAME[p]).join(' и ')} — включит обратно сам, когда закончит.
            </span>
          </div>
        )}
        {services && test.baseline && (
          <ServiceTable baseline={test.baseline} withLabel={bestNow ? `Лучшая пока — ${strategyLabel(bestNow.strategy)}` : 'Лучшая пока'} withServices={bestNow?.services} compact />
        )}
        {!services && rows.length > 0 && <DpiTable rows={rows} best={test.best} expanded={expanded} setExpanded={setExpanded} />}
      </>
    )
    footer = (
      <button className="btn" onClick={() => window.prism.zapret.testCancel()} disabled={test.phase === 'restore'}>
        <Square size={14} />
        Остановить
      </button>
    )
  } else {
    /* ── итог ── */
    const base = test.baseline ?? []
    const fixed = services && best ? best.services!.filter((s) => s.status === 'ok' && base.find((b) => b.id === s.id)?.status !== 'ok') : []
    const failing = services && best ? best.services!.filter((s) => s.status !== 'ok') : []
    const appBlocked = failing.some((s) => s.id === 'telegram-app') && base.find((b) => b.id === 'telegram-app')?.status === 'fail'
    const needExtra = !cfg.extraDomains && failing.some((s) => s.id === 'telegram-web' || s.id === 'spotify')
    const names = (l: ZapretServiceResult[]): string => l.map((s) => serviceName(s.id)).join(', ')

    body = (
      <>
        {test.error && (
          <div className="upd-notes zap-note warn">
            <AlertTriangle size={16} />
            <span className="grow">{test.error}</span>
          </div>
        )}
        {services ? (
          <>
            <div className="rule zap-check zap-verdict">
              <span className="ic">
                {!best ? (
                  <XCircle size={22} color="var(--err)" />
                ) : failing.length ? (
                  <AlertTriangle size={22} color="var(--warn)" />
                ) : (
                  <CheckCircle2 size={22} color="var(--ok)" />
                )}
              </span>
              <div className="grow col">
                <b>
                  {!best
                    ? 'Ни одна стратегия не помогла'
                    : failing.length
                      ? `Лучшая стратегия — ${strategyLabel(best.strategy)}`
                      : `Всё открывается со стратегией ${strategyLabel(best.strategy)}`}
                </b>
                <span>
                  {!best
                    ? 'Загляните в «Диагностику»: чаще всего мешает другой обход, VPN или антивирус.'
                    : [
                        fixed.length ? `Обход открыл: ${names(fixed)}.` : 'Всё, что открывается, открывается и без обхода.',
                        failing.length ? `Не открывается: ${names(failing)}.` : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                </span>
              </div>
            </div>

            {best && <ServiceTable baseline={base} withLabel={`Со стратегией ${strategyLabel(best.strategy)}`} withServices={best.services} />}

            {appBlocked && (
              <div className="upd-notes zap-note warn">
                <Smartphone size={16} />
                <span className="grow">
                  Приложение Telegram не пускают к его серверам по адресу. Обход меняет только содержимое пакетов и тут бессилен: нужен VPN
                  (пресет Telegram на вкладке «Маршруты») или MTProto-прокси в настройках самого Telegram. Сайт и веб-версию обход открывает.
                </span>
                <button
                  className="btn sm"
                  onClick={() => {
                    onClose()
                    setPage('routing')
                  }}
                >
                  <Route size={14} />
                  Маршруты
                </button>
              </div>
            )}
            {needExtra && (
              <div className="upd-notes zap-note warn">
                <AlertTriangle size={16} />
                <span className="grow">Выключены «Домены Prism» — без них обход не трогает Telegram и Spotify.</span>
                <button className="btn sm" onClick={() => patchZapret({ extraDomains: true }).then(() => run())}>
                  Включить и проверить
                </button>
              </div>
            )}

            {rows.length > 0 && (
              <>
                <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAll(!showAll)}>
                  {showAll ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Все стратегии · {rows.length}
                </button>
                {showAll && (
                  <div className="card" style={{ overflow: 'hidden' }}>
                    <table className="table">
                      <tbody>
                        {rows.map((r) => (
                          <Fragment key={r.strategy}>
                            <tr className={`zap-row${r.strategy === test.best ? ' best' : ''}`} onClick={() => setExpanded(expanded === r.strategy ? null : r.strategy)}>
                              <td style={{ width: 170 }}>
                                <b style={{ fontWeight: 560 }}>{strategyLabel(r.strategy)}</b>
                              </td>
                              <td>
                                {r.started ? (
                                  <span className="row" style={{ gap: 5 }}>
                                    {r.services?.map((s) => <Dot key={s.id} s={s} />)}
                                  </span>
                                ) : (
                                  <span className="chip err" style={{ padding: '1px 8px', fontSize: 11 }}>
                                    не запустилась
                                  </span>
                                )}
                              </td>
                              <td className="tnum dim" style={{ textAlign: 'right', width: 90 }}>
                                {r.started ? `${okCount(r)} из ${r.services?.length ?? 0}` : '—'}
                              </td>
                            </tr>
                            {expanded === r.strategy && r.services && (
                              <tr>
                                <td colSpan={3} style={{ background: 'var(--panel)' }}>
                                  <div className="col" style={{ gap: 6, padding: '4px 0' }}>
                                    {r.services.map((s) => (
                                      <div key={s.id} className="row wrap" style={{ gap: 6, fontSize: 12 }}>
                                        <span style={{ width: 200 }}>{serviceName(s.id)}</span>
                                        {s.checks.map((c) => (
                                          <span key={c.target} className={`chip ${c.ok ? 'ok' : 'err'}`} title={c.ok ? sec(c.ms) : c.error} style={{ padding: '1px 7px', fontSize: 10.5 }}>
                                            {c.target.split('/')[0]}
                                          </span>
                                        ))}
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <b style={{ fontSize: 13.5 }}>{test.best ? `Лучшая стратегия — ${strategyLabel(test.best)}` : 'Ни одна стратегия не прошла проверки'}</b>
            {rows.length > 0 && <DpiTable rows={rows} best={test.best} expanded={expanded} setExpanded={setExpanded} />}
          </>
        )}
      </>
    )
    footer = (
      <>
        <button
          className="btn icon ghost"
          title="Скопировать отчёт"
          disabled={!test.file}
          onClick={async () => {
            await window.prism.system.clipboardWrite(await window.prism.zapret.report())
            toast('ok', 'Отчёт скопирован — им можно поделиться')
          }}
        >
          <Copy size={15} />
        </button>
        <button className="btn icon ghost" title="Папка с отчётами" onClick={() => window.prism.zapret.openReports()}>
          <FolderOpen size={15} />
        </button>
        <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => setSetup(true)}>
          <Settings2 size={15} />
          Настроить…
        </button>
        <button className="btn" disabled={busy} onClick={() => run()}>
          <RefreshCw size={15} />
          Проверить снова
        </button>
        {test.best && (
          <button className="btn primary" disabled={busy} onClick={() => useBest(test.best!)}>
            <Zap size={15} />
            Включить с {strategyLabel(test.best)}
          </button>
        )}
      </>
    )
  }

  return (
    <Modal open={open} onClose={onClose} wide title="Проверка доступности" icon={<Gauge size={18} className="mut" />} footer={footer}>
      {body}
    </Modal>
  )
}

/** Сервисы: как было без обхода и как стало со стратегией */
function ServiceTable({
  baseline,
  withLabel,
  withServices,
  compact
}: {
  baseline: ZapretServiceResult[]
  withLabel: string
  withServices?: ZapretServiceResult[]
  compact?: boolean
}): JSX.Element {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Сервис</th>
            <th>Без обхода</th>
            <th>{withLabel}</th>
          </tr>
        </thead>
        <tbody>
          {baseline.map((b) => {
            const Icon = SERVICE_ICON[b.id] ?? Cloud
            return (
              <tr key={b.id}>
                <td>
                  <span className="row" style={{ gap: 9 }}>
                    <Icon size={15} className="dim" />
                    {serviceName(b.id)}
                  </span>
                </td>
                <td>
                  <StatusChip s={b} compact />
                </td>
                <td>
                  <StatusChip s={withServices?.find((s) => s.id === b.id)} compact={compact} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Результаты DPI-чекеров — для опытных, как в утилите сборки */
function DpiTable({
  rows,
  best,
  expanded,
  setExpanded
}: {
  rows: ZapretStrategyResult[]
  best?: string
  expanded: string | null
  setExpanded: (v: string | null) => void
}): JSX.Element {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Стратегия</th>
            <th style={{ textAlign: 'right' }}>Успешно</th>
            <th style={{ textAlign: 'right' }}>Ошибки</th>
            <th style={{ textAlign: 'right' }}>Заморозка</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.strategy}>
              <tr className={`zap-row${r.strategy === best ? ' best' : ''}`} onClick={() => setExpanded(expanded === r.strategy ? null : r.strategy)}>
                <td>
                  <b style={{ fontWeight: 560 }}>{strategyLabel(r.strategy)}</b>
                  {!r.started && (
                    <span className="chip err" style={{ marginLeft: 8, padding: '1px 8px', fontSize: 11 }}>
                      не запустилась
                    </span>
                  )}
                </td>
                <td className="tnum" style={{ textAlign: 'right', color: r.ok ? 'var(--ok)' : undefined }}>
                  {r.ok}
                </td>
                <td className="tnum" style={{ textAlign: 'right', color: r.error ? 'var(--err)' : undefined }}>
                  {r.error}
                </td>
                <td className="tnum" style={{ textAlign: 'right' }}>
                  {r.started ? r.blocked : '—'}
                </td>
              </tr>
              {expanded === r.strategy && (
                <tr>
                  <td colSpan={4} style={{ background: 'var(--panel)' }}>
                    <div className="col" style={{ gap: 6, padding: '4px 0' }}>
                      {r.targets.map((t) => (
                        <div key={t.name} className="row wrap" style={{ gap: 6 }}>
                          <span className="ell" style={{ width: 210, fontSize: 12 }} title={t.name}>
                            {t.name}
                          </span>
                          {t.checks.map((c) => (
                            <span key={c.label} className={`chip ${CHECK_CLS[c.status]}`} title={c.detail} style={{ padding: '1px 7px', fontSize: 10.5 }}>
                              {c.label}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ─────────────── hosts ─────────────── */

export function HostsModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useStore((s) => s.toast)
  const elevated = useStore((s) => s.zapret.elevated)
  const [info, setInfo] = useState<ZapretHostsInfo | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'load' | 'apply' | 'remove' | null>(null)

  const call = async (kind: 'load' | 'apply' | 'remove'): Promise<void> => {
    setBusy(kind)
    setError('')
    try {
      const api = window.prism.zapret
      const r = kind === 'load' ? await api.hosts() : kind === 'apply' ? await api.hostsApply() : await api.hostsRemove()
      if (r.ok) {
        setInfo(r.info)
        if (kind === 'apply') toast('ok', 'Файл hosts обновлён')
        if (kind === 'remove') toast('ok', 'Записи Prism убраны из hosts')
      } else setError(r.error)
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (open) void call('load')
    else setInfo(null)
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Файл hosts"
      icon={<FileText size={18} className="mut" />}
      footer={
        <>
          {info?.managed && (
            <button className="btn ghost" style={{ marginRight: 'auto' }} disabled={!!busy || !elevated} onClick={() => call('remove')}>
              {busy === 'remove' && <RefreshCw size={15} className="spin" />}
              Убрать записи Prism
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
          <button className="btn primary" disabled={!!busy || !info || info.upToDate || !elevated} onClick={() => call('apply')}>
            {busy === 'apply' ? <RefreshCw size={15} className="spin" /> : <CheckCircle2 size={15} />}
            {info?.managed ? 'Обновить записи' : 'Добавить в hosts'}
          </button>
        </>
      }
    >
      <p className="mut" style={note}>
        Помогает, когда не открывается веб-версия Telegram или голосовой чат Discord бесконечно «подключается»: прописывает рабочие
        адреса для доменов Telegram, Discord и GitHub из репозитория сборки. Prism кладёт их отдельным блоком, который убирается одной
        кнопкой, — остальной файл не трогается.
      </p>

      {busy === 'load' && !info && (
        <div className="row mut" style={{ ...note, justifyContent: 'center', padding: 20 }}>
          <RefreshCw size={16} className="spin" />
          Сверяю hosts со свежим списком…
        </div>
      )}
      {error && (
        <div className="upd-notes zap-note warn">
          <AlertTriangle size={16} />
          <span className="grow">{error}</span>
        </div>
      )}
      {info && (
        <>
          <div className="rule zap-check">
            <span className="ic">
              {info.upToDate ? <CheckCircle2 size={17} color="var(--ok)" /> : <AlertTriangle size={17} color="var(--warn)" />}
            </span>
            <div className="grow col">
              <b>{info.upToDate ? 'Файл hosts актуален' : `Не хватает ${info.missing} из ${info.total} записей`}</b>
              <span>
                {info.stale > 0
                  ? `Ещё ${info.stale} ${plural(info.stale, 'устаревшая строка', 'устаревшие строки', 'устаревших строк')} для тех же адресов — при обновлении они заменятся.`
                  : info.managed
                    ? 'Записи добавлены Prism.'
                    : info.upToDate
                      ? 'Записи уже есть в файле.'
                      : 'Записи добавятся в конец файла.'}
              </span>
            </div>
          </div>
          {info.skipped > 0 && (
            <p className="mut" style={note}>
              Ещё {info.skipped} {plural(info.skipped, 'запись', 'записи', 'записей')} из списка сборки — для других сайтов. Их Prism не
              пишет: менять hosts он готов только для Telegram, Discord и GitHub.
            </p>
          )}
          <pre className="upd-notes mono" style={{ fontSize: 11, maxHeight: 220 }}>
            {info.entries.join('\n')}
          </pre>
        </>
      )}
    </Modal>
  )
}

/* ─────────────── кэш Discord ─────────────── */

export function DiscordModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Очистить кэш Discord?"
      icon={<Eraser size={18} className="mut" />}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const r = await window.prism.zapret.clearDiscord()
                if (!r.ok) toast('error', r.error)
                else if (!r.found.length) toast('warn', 'Discord на этом компьютере не найден')
                else if (r.failed.length) toast('warn', `Не всё удалилось: ${r.failed.length} ${plural(r.failed.length, 'папка', 'папки', 'папок')} заняты`)
                else toast('ok', `Кэш очищен: ${r.found.join(', ')}`)
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? <RefreshCw size={15} className="spin" /> : <Eraser size={15} />}
            Очистить
          </button>
        </>
      }
    >
      <p className="mut" style={note}>
        Prism закроет Discord — Stable, PTB, Canary и Development, какие найдутся, — и удалит у них папки <span className="kbd">Cache</span>,{' '}
        <span className="kbd">Code Cache</span> и <span className="kbd">GPUCache</span>.
      </p>
      <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
        Вход, настройки и сообщения не пострадают — Discord просто заново скачает интерфейс. Помогает, если он внезапно перестал
        грузиться, хотя в браузере работает.
      </p>
    </Modal>
  )
}

/* ─────────────── просмотр встроенного списка ─────────────── */

export function ListModal({ name, onClose }: { name: ListName | null; onClose: () => void }): JSX.Element {
  const [data, setData] = useState<{ lines: string[]; total: number } | null>(null)
  useEffect(() => {
    setData(null)
    if (name) void window.prism.zapret.readList(name).then(setData)
  }, [name])

  return (
    <Modal open={!!name} onClose={onClose} title={name ? LIST_TITLES[name] : ''} icon={<List size={18} className="mut" />}>
      {data && (
        <>
          <span className="dim" style={{ fontSize: 12 }}>
            {data.total > data.lines.length
              ? `Показаны первые ${data.lines.length.toLocaleString('ru')} из ${data.total.toLocaleString('ru')}`
              : `${data.total} ${plural(data.total, 'запись', 'записи', 'записей')}`}{' '}
            · встроенные списки меняются вместе со сборкой, свои — на вкладке списков
          </span>
          <pre className="upd-notes mono" style={{ fontSize: 11.5, maxHeight: '52vh' }}>
            {data.lines.join('\n') || 'Список пуст'}
          </pre>
        </>
      )}
    </Modal>
  )
}
