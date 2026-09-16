/* Окна инструментов zapret: диагностика, тест стратегий, hosts, кэш Discord, просмотр списков */

import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eraser,
  ExternalLink,
  FileText,
  FolderOpen,
  Gauge,
  List,
  Play,
  RefreshCw,
  Square,
  Stethoscope,
  Wrench,
  XCircle
} from 'lucide-react'
import type { ZapretCheck, ZapretCheckStatus, ZapretHostsInfo, ZapretStrategyResult, ZapretTestKind } from '@shared/types'
import { strategyLabel } from '@shared/zapret'
import { plural, useStore } from '../store'
import { Modal, Segmented } from '../ui'

export type ListName = 'general' | 'google' | 'exclude' | 'ipsetExclude' | 'ipset'

const LIST_TITLES: Record<ListName, string> = {
  general: 'Discord, Cloudflare и DNS-over-HTTPS',
  google: 'YouTube и Google',
  exclude: 'Домены-исключения',
  ipsetExclude: 'Исключённые подсети',
  ipset: 'IPSet'
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

const CHECK_CLS: Record<ZapretCheckStatus, string> = {
  ok: 'ok',
  unsup: 'warn',
  blocked: 'warn',
  ssl: 'err',
  error: 'err',
  fail: 'err'
}

const score = (r: ZapretStrategyResult): number => (r.started ? r.ok * 1000 + r.pingOk : -1)

export function TestModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const z = useStore((s) => s.zapret)
  const test = useStore((s) => s.zapretTest)
  const core = useStore((s) => s.core)
  const patchZapret = useStore((s) => s.patchZapret)
  const toast = useStore((s) => s.toast)
  const strategies = z.pack?.strategies ?? []
  const [kind, setKind] = useState<ZapretTestKind>('standard')
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [setup, setSetup] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const selected = picked ?? new Set(strategies.map((s) => s.id))
  const running = !!test?.running
  const showSetup = !running && (setup || !test)

  // Открыли окно, пока тест идёт или уже закончился, — сразу к результатам
  useEffect(() => {
    if (open && test && (test.running || test.results.length)) setSetup(false)
  }, [open])

  const toggle = (id: string): void => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  const start = async (): Promise<void> => {
    setStarting(true)
    try {
      const r = await window.prism.zapret.testStart(kind, [...selected])
      if (r.ok) {
        setSetup(false)
        setExpanded(null)
      } else toast('error', r.error)
    } finally {
      setStarting(false)
    }
  }

  const rows = useMemo(() => [...(test?.results ?? [])].sort((a, b) => score(b) - score(a)), [test])
  const tunOn = core.status === 'running' && core.captureMode === 'tun'
  const perStrategy = kind === 'standard' ? 8 : 25
  const minutes = Math.max(1, Math.round((selected.size * perStrategy) / 60))

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Тест стратегий"
      icon={<Gauge size={18} className="mut" />}
      footer={
        showSetup ? (
          <>
            {test && test.results.length > 0 && (
              <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => setSetup(false)}>
                Прошлые результаты
              </button>
            )}
            <button className="btn primary" disabled={starting || !selected.size || !z.elevated} onClick={start}>
              {starting ? <RefreshCw size={15} className="spin" /> : <Play size={15} />}
              Запустить тест
            </button>
          </>
        ) : running ? (
          <button className="btn" onClick={() => window.prism.zapret.testCancel()}>
            <Square size={14} />
            Остановить
          </button>
        ) : (
          <>
            <button
              className="btn icon ghost"
              title="Скопировать отчёт"
              disabled={!test?.file}
              onClick={async () => {
                await window.prism.system.clipboardWrite(await window.prism.zapret.report())
                toast('ok', 'Отчёт скопирован — его можно приложить к обсуждению на GitHub сборки')
              }}
            >
              <Copy size={15} />
            </button>
            <button className="btn icon ghost" title="Папка с отчётами" onClick={() => window.prism.zapret.openReports()}>
              <FolderOpen size={15} />
            </button>
            <button className="btn" style={{ marginRight: 'auto' }} onClick={() => setSetup(true)}>
              Новый тест
            </button>
            {test?.best && (
              <button
                className="btn primary"
                onClick={async () => {
                  await patchZapret({ strategy: test.best! })
                  toast('ok', `Выбрана стратегия ${strategyLabel(test.best!)}`)
                  onClose()
                }}
              >
                <CheckCircle2 size={15} />
                Применить {strategyLabel(test.best)}
              </button>
            )}
          </>
        )
      }
    >
      {showSetup ? (
        <>
          <Segmented<ZapretTestKind>
            id="zap-test-kind"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'standard', label: 'Сайты и пинг' },
              { value: 'dpi', label: 'DPI-чекеры' }
            ]}
          />
          <p className="mut" style={note}>
            {kind === 'standard'
              ? 'С каждой стратегией Prism открывает Discord, YouTube, Google и Cloudflare по HTTP, TLS 1.2 и TLS 1.3 и пингует публичные DNS. Лучшая — где открылось больше всего.'
              : 'Проверка на «заморозку» после 16–20 КБ: так провайдеры режут соединения с зарубежными хостингами. Prism гоняет данные к серверам разных провайдеров из набора hyperion-cs/dpi-checkers. На время теста IPSet переключается на «любой IP».'}
          </p>

          <div className="col" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8 }}>
              <b style={{ fontSize: 13 }}>Стратегии</b>
              <span className="dim tnum" style={{ fontSize: 12 }}>
                {selected.size} из {strategies.length} · около {minutes} мин
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

          <div className="upd-notes zap-note">
            <RefreshCw size={16} />
            <span className="grow">
              Обход перезапускается с каждой стратегией по очереди, так что интернет может ненадолго пропадать. Если обход сейчас
              запущен, после теста он вернётся.
            </span>
          </div>
          {tunOn && (
            <div className="upd-notes zap-note warn">
              <AlertTriangle size={16} />
              <span className="grow">VPN работает в режиме TUN — отключите его на время теста, иначе проверится туннель, а не стратегия.</span>
            </div>
          )}
          {z.service.installed && (
            <div className="upd-notes zap-note warn">
              <AlertTriangle size={16} />
              <span className="grow">Установлена служба zapret — удалите её на время теста, стратегии запускаются по одной.</span>
            </div>
          )}
        </>
      ) : (
        test && (
          <>
            <div className="col" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 10 }}>
                <b style={{ fontSize: 13.5 }}>
                  {running
                    ? `Проверяю ${strategyLabel(test.current ?? '')}…`
                    : test.error
                      ? 'Тест прерван'
                      : test.best
                        ? `Лучшая стратегия — ${strategyLabel(test.best)}`
                        : 'Ни одна стратегия не прошла проверки'}
                </b>
                <span className="grow" />
                <span className="dim tnum" style={{ fontSize: 12 }}>
                  {test.done} из {test.total} · {test.kind === 'standard' ? 'сайты и пинг' : 'DPI-чекеры'}
                </span>
              </div>
              <div className="zap-progress">
                <i style={{ width: `${test.total ? (test.done / test.total) * 100 : 0}%` }} />
              </div>
            </div>

            {test.error && (
              <div className="upd-notes zap-note warn">
                <AlertTriangle size={16} />
                <span className="grow">{test.error}</span>
              </div>
            )}

            {rows.length > 0 && (
              <div className="card" style={{ overflow: 'hidden' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Стратегия</th>
                      <th style={{ textAlign: 'right' }}>Успешно</th>
                      <th style={{ textAlign: 'right' }}>Ошибки</th>
                      <th style={{ textAlign: 'right' }}>Без поддержки</th>
                      <th style={{ textAlign: 'right' }}>{test.kind === 'standard' ? 'Пинг' : 'Заморозка'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <Fragment key={r.strategy}>
                        <tr
                          className={`zap-row${r.strategy === test.best ? ' best' : ''}`}
                          onClick={() => setExpanded(expanded === r.strategy ? null : r.strategy)}
                        >
                          <td>
                            <div className="row" style={{ gap: 8 }}>
                              <b style={{ fontWeight: 560 }}>{strategyLabel(r.strategy)}</b>
                              {r.strategy === test.best && <span className="chip ok">лучшая</span>}
                              {!r.started && <span className="chip err">не запустилась</span>}
                            </div>
                          </td>
                          <td className="tnum" style={{ textAlign: 'right', color: r.ok ? 'var(--ok)' : undefined }}>
                            {r.ok}
                          </td>
                          <td className="tnum" style={{ textAlign: 'right', color: r.error ? 'var(--err)' : undefined }}>
                            {r.error}
                          </td>
                          <td className="tnum dim" style={{ textAlign: 'right' }}>
                            {r.unsup}
                          </td>
                          <td className="tnum" style={{ textAlign: 'right' }}>
                            {!r.started ? '—' : test.kind === 'standard' ? `${r.pingOk}/${r.pingOk + r.pingFail}` : r.blocked}
                          </td>
                        </tr>
                        {expanded === r.strategy && (
                          <tr>
                            <td colSpan={5} style={{ background: 'var(--panel)' }}>
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
                                    {t.ping !== undefined && (
                                      <span className="dim tnum" style={{ fontSize: 11.5 }}>
                                        {t.ping === 'Timeout' ? 'нет пинга' : t.ping.replace('ms', 'мс')}
                                      </span>
                                    )}
                                  </div>
                                ))}
                                {!r.targets.length && <span className="dim" style={{ fontSize: 12 }}>winws.exe не поднялся с этой стратегией</span>}
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
            {!running && rows.length > 0 && (
              <p className="dim" style={{ fontSize: 12 }}>
                Нажмите на строку, чтобы увидеть проверки по каждому сайту. Отчёт в формате утилиты сборки сохранён в папку отчётов.
              </p>
            )}
          </>
        )
      )}
    </Modal>
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
