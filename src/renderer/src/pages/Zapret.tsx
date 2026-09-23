import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Download,
  Eraser,
  ExternalLink,
  Feather,
  FileArchive,
  FileText,
  Fingerprint,
  FlaskConical,
  FolderOpen,
  Gauge,
  HardDrive,
  LockOpen,
  Package,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Square,
  Stethoscope
} from 'lucide-react'
import type { ZapretGameFilter, ZapretIpsetMode, ZapretLists, ZapretState } from '@shared/types'
import { EXTRA_DOMAINS, EXTRA_DOMAINS_NOTE, EXTRA_DOMAIN_GROUPS, ZAPRET_REPO_URL, compareVersions, strategyLabel } from '@shared/zapret'
import { duration, plural, useStore } from '../store'
import { Empty, Segmented, Setting, Switch } from '../ui'
import { DiagnosticsModal, DiscordModal, HostsModal, ListModal, TestModal, type ListName } from './ZapretModals'

const GAME_OPTIONS: { value: ZapretGameFilter; label: string }[] = [
  { value: 'off', label: 'Выкл' },
  { value: 'all', label: 'TCP и UDP' },
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' }
]

const IPSET_OPTIONS: { value: ZapretIpsetMode; label: string }[] = [
  { value: 'none', label: 'Выкл' },
  { value: 'loaded', label: 'По списку' },
  { value: 'any', label: 'Любой IP' }
]

const IPSET_HINTS: Record<ZapretIpsetMode, string> = {
  none: 'Обход работает только по спискам доменов. Самый безопасный режим — сайты, которые и так открываются, не задеваются.',
  loaded: 'Дополнительно обходятся адреса из списка IPSet: сети Cloudflare, игровых и прочих сервисов, которые узнаются не по домену.',
  any: 'Под обход попадает любой адрес. Помогает играм, но ломает многие сайты — не держите этот режим включённым постоянно.'
}

const LIST_TABS: { value: keyof ZapretLists; label: string; kind: 'domain' | 'ip'; hint: string; placeholder: string }[] = [
  {
    value: 'general',
    label: 'Свои домены',
    kind: 'domain',
    hint: 'Домены, которые надо обходить. Поддомены учитываются сами.',
    placeholder: 'example.com\nstatic.example.net'
  },
  {
    value: 'exclude',
    label: 'Не трогать домены',
    kind: 'domain',
    hint: 'Домены, к которым обход не применяется, даже если их адрес попал в IPSet.',
    placeholder: 'bank.example.ru'
  },
  {
    value: 'ipset',
    label: 'Свои IP',
    kind: 'ip',
    hint: 'Адреса и подсети — добавляются к IPSet в режиме «По списку». Переживают обновление списка.',
    placeholder: '203.0.113.0/24\n2001:db8::/32'
  },
  {
    value: 'ipsetExclude',
    label: 'Не трогать IP',
    kind: 'ip',
    hint: 'Адреса и подсети, к которым обход не применяется. Локальная сеть исключена всегда.',
    placeholder: '198.51.100.7'
  }
]

/** Значок семейства стратегий */
function StrategyIcon({ label }: { label: string }): JSX.Element {
  if (/^ALT/i.test(label)) return <Shuffle size={15} />
  if (/^FAKE TLS/i.test(label)) return <Fingerprint size={15} />
  if (/^SIMPLE FAKE/i.test(label)) return <Feather size={15} />
  if (/^EXP/i.test(label)) return <FlaskConical size={15} />
  return <Sparkles size={15} />
}

export default function ZapretPage(): JSX.Element {
  const z = useStore((s) => s.zapret)

  useEffect(() => {
    void window.prism.zapret.refresh()
  }, [])

  return (
    <>
      <div className="page-head">
        <h1>Zapret</h1>
        <p>
          Обход блокировок без VPN: Discord, YouTube и сайты за Cloudflare открываются напрямую через вашего провайдера — без
          сервера и без потери скорости. Внутри — сборка zapret-discord-youtube от Flowseal.
        </p>
      </div>

      {!z.supported ? (
        <div className="card">
          <Empty
            icon={<LockOpen size={36} strokeWidth={1.4} />}
            title="Zapret работает только в Windows"
            text="Обход держится на драйвере WinDivert, который подменяет пакеты прямо в сетевом стеке Windows. На macOS такого драйвера нет — здесь поможет VPN."
          />
        </div>
      ) : !z.pack ? (
        <InstallCard />
      ) : (
        <Installed />
      )}
    </>
  )
}

/* ─────────────── сборка не установлена ─────────────── */

function InstallCard(): JSX.Element {
  const z = useStore((s) => s.zapret)
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState(false)

  const install = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.prism.zapret.installLatest()
      if (r.ok) toast('ok', 'Zapret установлен — выберите стратегию и запустите обход')
      else toast('error', r.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="card pad">
        <div className="row" style={{ gap: 15, alignItems: 'flex-start' }}>
          <span className="upd-badge available">
            <Download size={18} />
          </span>
          <div className="grow col" style={{ gap: 6 }}>
            <b style={{ fontSize: 15 }}>Сборка ещё не установлена</b>
            <span className="mut" style={{ fontSize: 13, lineHeight: 1.55 }}>
              Prism скачает последнюю сборку с GitHub — около 1,5 МБ — и сверит её контрольную сумму с опубликованной. Файлы
              лягут в <span className="mono">{z.root}</span>, куда писать могут только администраторы.
            </span>
            <span className="dim" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
              Антивирус может ругаться на WinDivert. Это драйвер перехвата пакетов, без которого обход не работает, а не вирус.
              Если файлы пропадут после установки — добавьте каталог в исключения антивируса.
            </span>
          </div>
        </div>
        <div className="row wrap" style={{ justifyContent: 'flex-end', gap: 9, marginTop: 16 }}>
          <InstallFromFile disabled={busy || !z.elevated} />
          <button className="btn primary" disabled={busy || !z.elevated || z.update.installing} onClick={install}>
            {busy ? <RefreshCw size={15} className="spin" /> : <Download size={15} />}
            {busy ? 'Скачиваю…' : 'Скачать и установить'}
          </button>
        </div>
        {!z.elevated && <ElevateNote />}
      </div>

      <div className="section-title">Что внутри</div>
      <div className="preset-grid zap-tools">
        {[
          { icon: <Shuffle size={16} />, t: 'Два десятка стратегий', d: 'Разные способы обмануть DPI. Какая сработает — зависит от провайдера, поэтому их много.' },
          { icon: <HardDrive size={16} />, t: 'Служба Windows', d: 'Обход стартует вместе с системой и работает, даже когда Prism закрыт.' },
          { icon: <Gauge size={16} />, t: 'Тест в одну кнопку', d: 'Prism сам переберёт стратегии на YouTube, Discord, Telegram и Spotify и включит лучшую.' },
          { icon: <Stethoscope size={16} />, t: 'Диагностика', d: 'Находит конфликтующие программы, VPN и выключенные службы, мешающие обходу.' }
        ].map((f) => (
          <div key={f.t} className="preset" style={{ cursor: 'default' }}>
            <div className="top">
              <span className="ico">{f.icon}</span>
              <b>{f.t}</b>
            </div>
            <p>{f.d}</p>
          </div>
        ))}
      </div>
    </>
  )
}

function InstallFromFile({ disabled, sm }: { disabled?: boolean; sm?: boolean }): JSX.Element {
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  return (
    <button
      className={`btn${sm ? ' icon ghost' : ''}`}
      disabled={disabled || busy}
      title="Установить из скачанного архива — если GitHub недоступен"
      onClick={async () => {
        setBusy(true)
        try {
          const r = await window.prism.zapret.installFromFile()
          if (r.ok) toast('ok', `Установлена сборка ${r.version}`)
          else if (r.error) toast('error', r.error)
        } finally {
          setBusy(false)
        }
      }}
    >
      <FileArchive size={15} />
      {!sm && 'Из архива…'}
    </button>
  )
}

function ElevateNote(): JSX.Element {
  const toast = useStore((s) => s.toast)
  return (
    <div className="upd-notes zap-note warn">
      <ShieldAlert size={16} />
      <span className="grow">
        Zapret подменяет пакеты драйвером WinDivert — Windows разрешает это только программам, запущенным от администратора.
      </span>
      <button
        className="btn sm"
        onClick={async () => {
          if (!(await window.prism.core.elevate())) toast('warn', 'Запуск от администратора отменён')
        }}
      >
        <ShieldCheck size={14} />
        Перезапустить от администратора
      </button>
    </div>
  )
}

/* ─────────────── основная страница ─────────────── */

type Modal = 'diag' | 'test' | 'hosts' | 'discord' | null

function Installed(): JSX.Element {
  const z = useStore((s) => s.zapret)
  const snap = useStore((s) => s.snap)
  const patchZapret = useStore((s) => s.patchZapret)
  const toast = useStore((s) => s.toast)
  const cfg = snap.zapret
  const pack = z.pack!
  const [modal, setModal] = useState<Modal>(null)
  const [list, setList] = useState<ListName | null>(null)
  const [ipsetBusy, setIpsetBusy] = useState(false)

  const updateIpset = async (): Promise<void> => {
    setIpsetBusy(true)
    try {
      const r = await window.prism.zapret.updateIpset()
      if (r.ok) toast('ok', `IPSet обновлён: ${r.count.toLocaleString('ru')} ${plural(r.count, 'подсеть', 'подсети', 'подсетей')}`)
      else toast('error', r.error)
    } finally {
      setIpsetBusy(false)
    }
  }

  const fakeHint = (def?: string): string => (def ? `Как в сборке (${def})` : 'Как в сборке')

  return (
    <>
      <StatusCard />

      {/* ─── Стратегия ─── */}
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span>Стратегия</span>
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setModal('test')}>
          <Gauge size={14} />
          Найти рабочую
        </button>
      </div>
      <p className="mut zap-lead">
        Стратегии по-разному обманывают DPI провайдера, и со временем провайдер учится их замечать. Не знаете, какую выбрать, или
        что-то перестало открываться — нажмите «Найти рабочую»: Prism проверит все сам.
      </p>
      <div className="preset-grid zap-grid">
        {pack.strategies.map((s) => {
          const on = cfg.strategy === s.id
          const score = z.lastTest?.scores[s.id]
          const best = z.lastTest?.best === s.id
          return (
            <button key={s.id} className={`preset${on ? ' on' : ''}`} onClick={() => patchZapret({ strategy: s.id })}>
              <div className="top">
                <span className="ico">
                  <StrategyIcon label={s.label} />
                </span>
                <b>{s.label}</b>
                {on && <CheckCircle2 size={16} color="var(--accent-1)" style={{ flexShrink: 0 }} />}
              </div>
              <div className="zap-meta">
                <p>{s.summary || '—'}</p>
                {best ? (
                  <span className="chip ok">лучшая</span>
                ) : score ? (
                  <span className="chip tnum" title="Сколько сервисов открылось в последнем тесте">
                    {score.ok}/{score.total}
                  </span>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>

      {/* ─── Запуск ─── */}
      <div className="section-title">Запуск</div>
      <div className="card pad">
        <ServiceSetting />
        <Setting title="Запускать вместе с Prism" hint="Обход поднимется при старте Prism и выключится при выходе из него.">
          <Switch on={cfg.autoStart} disabled={z.service.installed} onChange={(v) => patchZapret({ autoStart: v })} />
        </Setting>
      </div>

      {/* ─── Фильтры ─── */}
      <div className="section-title">Фильтры</div>
      <div className="card pad">
        <Setting
          title="Игры"
          hint="Обход для игр и программ, которые ходят на порты выше 1023. Включайте, только если игра не работает: под фильтр попадает много лишнего трафика."
        >
          <Segmented<ZapretGameFilter> id="zap-game" value={cfg.gameFilter} options={GAME_OPTIONS} onChange={(v) => patchZapret({ gameFilter: v })} />
        </Setting>

        <Setting title="IPSet" hint={IPSET_HINTS[cfg.ipsetMode]}>
          <Segmented<ZapretIpsetMode> id="zap-ipset" value={cfg.ipsetMode} options={IPSET_OPTIONS} onChange={(v) => patchZapret({ ipsetMode: v })} />
        </Setting>

        <Setting
          title="Список IPSet"
          hint={`${pack.lists.ipset.toLocaleString('ru')} ${plural(pack.lists.ipset, 'подсеть', 'подсети', 'подсетей')} · ${
            pack.ipsetUpdatedAt
              ? `обновлён ${new Date(pack.ipsetUpdatedAt).toLocaleDateString('ru', { day: 'numeric', month: 'long' })}`
              : 'из сборки'
          }`}
        >
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm ghost" onClick={() => setList('ipset')}>
              Посмотреть
            </button>
            <button className="btn sm" disabled={ipsetBusy || !z.elevated} onClick={updateIpset}>
              <RefreshCw size={14} className={ipsetBusy ? 'spin' : ''} />
              Обновить с GitHub
            </button>
          </div>
        </Setting>

        <Setting
          title="Домены Prism"
          hint={`Чего нет в списках сборки: ${EXTRA_DOMAIN_GROUPS.map((g) => `${g.group} — ${g.note}`).join(', ')}. ${EXTRA_DOMAINS_NOTE}`}
        >
          <div className="row" style={{ gap: 7 }}>
            <button className="btn sm ghost" onClick={() => setList('extra')}>
              Посмотреть
            </button>
            <Switch on={cfg.extraDomains} onChange={(v) => patchZapret({ extraDomains: v })} />
          </div>
        </Setting>

        <Setting title="Фейк для голоса Discord" hint="Каким пакетом притворяется голосовой трафик Discord. Если голос не подключается — попробуйте другой.">
          <select className="select zap-fake" value={cfg.fakeDiscord} onChange={(e) => patchZapret({ fakeDiscord: e.target.value })}>
            <option value="">{fakeHint(pack.defaultFakeDiscord)}</option>
            {pack.fakes.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Setting>

        <Setting title="Фейк для игр" hint="То же для UDP игр — действует, когда включён фильтр игр.">
          <select className="select zap-fake" value={cfg.fakeGame} onChange={(e) => patchZapret({ fakeGame: e.target.value })}>
            <option value="">{fakeHint(pack.defaultFakeGame)}</option>
            {pack.fakes.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Setting>
      </div>

      {/* ─── Списки ─── */}
      <div className="section-title">Списки адресов</div>
      <ListsCard onView={setList} />

      {/* ─── Инструменты ─── */}
      <div className="section-title">Инструменты</div>
      <div className="preset-grid zap-tools">
        <Tool icon={<Stethoscope size={16} />} title="Диагностика" onClick={() => setModal('diag')}>
          Ищет частые причины, по которым обход не работает: конфликтующие программы, VPN, выключенные службы, DNS.
        </Tool>
        <Tool icon={<Gauge size={16} />} title="Тест доступности" onClick={() => setModal('test')}>
          Одна кнопка: Prism переберёт все стратегии на YouTube, Discord, Telegram, Spotify и сайтах за Cloudflare и включит лучшую.
        </Tool>
        <Tool icon={<FileText size={16} />} title="Файл hosts" onClick={() => setModal('hosts')}>
          Чинит веб-версию Telegram и бесконечное «Подключение» к голосовому чату Discord.
        </Tool>
        <Tool icon={<Eraser size={16} />} title="Кэш Discord" onClick={() => setModal('discord')}>
          Закрывает Discord и чистит его кэш — помогает, если он внезапно перестал грузиться.
        </Tool>
      </div>

      {/* ─── Сборка ─── */}
      <div className="section-title">Сборка</div>
      <PackCard />

      <DiagnosticsModal open={modal === 'diag'} onClose={() => setModal(null)} />
      <TestModal open={modal === 'test'} onClose={() => setModal(null)} />
      <HostsModal open={modal === 'hosts'} onClose={() => setModal(null)} />
      <DiscordModal open={modal === 'discord'} onClose={() => setModal(null)} />
      <ListModal name={list} onClose={() => setList(null)} />
    </>
  )
}

function Tool({ icon, title, children, onClick }: { icon: JSX.Element; title: string; children: string; onClick: () => void }): JSX.Element {
  return (
    <button className="preset" onClick={onClick}>
      <div className="top">
        <span className="ico">{icon}</span>
        <b>{title}</b>
        <ChevronRight size={16} className="dim" />
      </div>
      <p>{children}</p>
    </button>
  )
}

/* ─────────────── состояние ─────────────── */

const serviceUp = (z: ZapretState): boolean => /running|start pending/i.test(z.service.state ?? '')

function StatusCard(): JSX.Element {
  const z = useStore((s) => s.zapret)
  const cfg = useStore((s) => s.snap.zapret)
  const core = useStore((s) => s.core)
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const [uptime, setUptime] = useState(0)

  const running = z.status === 'running'
  const svc = z.service.installed
  const svcUp = serviceUp(z)

  useEffect(() => {
    if (!running || !z.since) return setUptime(0)
    const t = setInterval(() => setUptime(Date.now() - z.since!), 1000)
    setUptime(Date.now() - z.since)
    return () => clearInterval(t)
  }, [running, z.since])

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const start = (): Promise<void> =>
    act(async () => {
      const r = await window.prism.zapret.start()
      if (!r.ok && r.error) toast('error', r.error)
    })

  const game = GAME_OPTIONS.find((g) => g.value === cfg.gameFilter)!.label
  const ipset = IPSET_OPTIONS.find((g) => g.value === cfg.ipsetMode)!.label
  const filters = `игры: ${game.toLowerCase()} · IPSet: ${ipset.toLowerCase()}`

  let badge = ''
  let icon = <LockOpen size={18} />
  let title = 'Обход выключен'
  let sub = `Стратегия ${strategyLabel(cfg.strategy)} · ${filters}`
  if (svc) {
    badge = svcUp ? 'ready' : 'error'
    icon = svcUp ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />
    title = svcUp ? 'Обход работает как служба Windows' : 'Служба zapret установлена, но не работает'
    sub = z.service.foreign
      ? 'Службу ставил не Prism — скорее всего, service.bat. Её можно удалить и поставить заново отсюда.'
      : `Стратегия ${strategyLabel(z.service.strategy ?? cfg.strategy)} · запускается вместе с Windows, даже без Prism`
  } else if (running) {
    badge = 'ready'
    icon = <ShieldCheck size={18} />
    title = 'Обход работает'
    sub = `Стратегия ${strategyLabel(z.running ?? cfg.strategy)} · ${duration(uptime)} · ${filters}`
  } else if (z.status === 'starting') {
    badge = 'downloading'
    icon = <RefreshCw size={18} className="spin" />
    title = 'Запускаю обход…'
  } else if (z.status === 'error') {
    badge = 'error'
    icon = <AlertTriangle size={18} />
    title = 'Обход не работает'
    sub = z.error ?? 'winws.exe остановился'
  }

  const tunOn = core.status === 'running' && core.captureMode === 'tun'

  return (
    <div className="card pad">
      <div className="row wrap" style={{ gap: 14 }}>
        <span className={`upd-badge ${badge}`}>{icon}</span>
        <div className="grow col" style={{ gap: 2, minWidth: 220 }}>
          <b style={{ fontSize: 15 }}>{title}</b>
          <span className="dim" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
            {sub}
          </span>
        </div>

        {!svc && (
          <div className="row" style={{ gap: 7 }}>
            {running && (
              <button className="btn icon ghost" title="Перезапустить" disabled={busy} onClick={() => act(() => window.prism.zapret.stop().then(start))}>
                <RotateCcw size={15} />
              </button>
            )}
            {running || z.status === 'starting' ? (
              <button className="btn" disabled={busy} onClick={() => act(() => window.prism.zapret.stop())}>
                <Square size={14} />
                Остановить
              </button>
            ) : (
              <button className="btn primary" disabled={busy || !z.elevated} onClick={start}>
                {busy ? <RefreshCw size={15} className="spin" /> : <Play size={15} />}
                Запустить
              </button>
            )}
          </div>
        )}
      </div>

      {z.status === 'error' && z.output.length > 0 && !svc && (
        <div className="upd-notes mono zap-output">{z.output.slice(-8).join('\n')}</div>
      )}

      {!z.elevated && <ElevateNote />}

      {z.foreignWinws > 0 && (
        <div className="upd-notes zap-note warn">
          <AlertTriangle size={16} />
          <span className="grow">
            Работает сторонний winws.exe ({z.foreignWinws}) — наверное, запущенный из папки сборки вручную. Два обхода мешают
            друг другу.
          </span>
          <button
            className="btn sm"
            disabled={!z.elevated}
            onClick={async () => {
              const r = await window.prism.zapret.killForeign()
              if (!r.ok) toast('error', r.error)
            }}
          >
            Остановить
          </button>
        </div>
      )}

      {tunOn && (running || svcUp) && (
        <div className="upd-notes zap-note">
          <ShieldCheck size={16} />
          <span className="grow">
            VPN тоже включён. Трафик, который идёт в туннель, zapret не трогает — обход действует только на то, что Prism
            пускает напрямую.
          </span>
        </div>
      )}
    </div>
  )
}

function ServiceSetting(): JSX.Element {
  const z = useStore((s) => s.zapret)
  const cfg = useStore((s) => s.snap.zapret)
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState<'install' | 'remove' | null>(null)

  const run = async (kind: 'install' | 'remove'): Promise<void> => {
    setBusy(kind)
    try {
      const r = kind === 'install' ? await window.prism.zapret.installService() : await window.prism.zapret.removeService()
      if (!r.ok) toast('error', r.error)
      else toast('ok', kind === 'install' ? `Служба zapret установлена — стратегия ${strategyLabel(cfg.strategy)}` : 'Служба zapret и WinDivert удалены')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Setting
      title="Служба Windows"
      hint="Обход стартует вместе с Windows, ещё до входа в систему, и работает, даже когда Prism закрыт. Изменения на этой странице применяются к службе сразу."
    >
      <div className="row wrap" style={{ gap: 7, justifyContent: 'flex-end' }}>
        {z.service.installed ? (
          <>
            <span className={`chip ${serviceUp(z) ? 'ok' : 'warn'}`}>
              {serviceUp(z) ? 'работает' : (z.service.state ?? 'остановлена').toLowerCase()}
            </span>
            <button className="btn sm" disabled={!!busy || !z.elevated} onClick={() => run('install')}>
              <RefreshCw size={14} className={busy === 'install' ? 'spin' : ''} />
              Переустановить
            </button>
            <button className="btn sm danger" disabled={!!busy || !z.elevated} onClick={() => run('remove')}>
              {busy === 'remove' && <RefreshCw size={14} className="spin" />}
              Удалить
            </button>
          </>
        ) : (
          <button className="btn" disabled={!!busy || !z.elevated} onClick={() => run('install')}>
            {busy ? <RefreshCw size={15} className="spin" /> : <HardDrive size={15} />}
            Установить службу
          </button>
        )}
      </div>
    </Setting>
  )
}

/* ─────────────── свои списки ─────────────── */

function ListsCard({ onView }: { onView: (n: ListName) => void }): JSX.Element {
  const z = useStore((s) => s.zapret)
  const lists = useStore((s) => s.snap.zapret.lists)
  const patchZapret = useStore((s) => s.patchZapret)
  const toast = useStore((s) => s.toast)
  const [tab, setTab] = useState<keyof ZapretLists>('general')
  const [drafts, setDrafts] = useState<Partial<Record<keyof ZapretLists, string>>>({})
  const meta = LIST_TABS.find((t) => t.value === tab)!
  const saved = lists[tab].join('\n')
  const text = drafts[tab] ?? saved
  const dirty = text.trim() !== saved.trim()
  const pack = z.pack!

  const lines = useMemo(() => text.split(/[\n,;]+/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')), [text])

  const save = async (): Promise<void> => {
    await patchZapret({ lists: { ...lists, [tab]: lines } })
    const kept = useStore.getState().snap.zapret.lists[tab].length
    setDrafts((d) => ({ ...d, [tab]: undefined }))
    if (kept < lines.length) {
      const skipped = lines.length - kept
      toast('warn', `Сохранено ${kept}, пропущено ${skipped}: ${meta.kind === 'domain' ? 'не похоже на домен' : 'не похоже на IP или подсеть'} или повтор`)
    } else toast('ok', 'Список сохранён')
  }

  return (
    <div className="card pad">
      <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
        <Segmented<keyof ZapretLists>
          id="zap-lists"
          value={tab}
          onChange={setTab}
          options={LIST_TABS.map((t) => ({ value: t.value, label: lists[t.value].length ? `${t.label} · ${lists[t.value].length}` : t.label }))}
        />
      </div>
      <textarea
        className="input"
        style={{ minHeight: 132 }}
        spellCheck={false}
        placeholder={meta.placeholder}
        value={text}
        onChange={(e) => setDrafts((d) => ({ ...d, [tab]: e.target.value }))}
      />
      <div className="row wrap" style={{ marginTop: 10, gap: 8 }}>
        <span className="dim grow" style={{ fontSize: 12, minWidth: 220 }}>
          {meta.hint} По одному в строке.
        </span>
        {dirty && (
          <button className="btn sm ghost" onClick={() => setDrafts((d) => ({ ...d, [tab]: undefined }))}>
            Отменить
          </button>
        )}
        <button className="btn sm primary" disabled={!dirty} onClick={save}>
          Сохранить
        </button>
      </div>

      <div className="divider" style={{ margin: '16px 0 12px' }} />
      <div className="row wrap" style={{ gap: 7 }}>
        <span className="dim" style={{ fontSize: 12, marginRight: 2 }}>
          Встроенные:
        </span>
        {(
          [
            ['general', 'Discord, Cloudflare и DNS', pack.lists.general],
            ['google', 'YouTube и Google', pack.lists.google],
            ['exclude', 'Исключения', pack.lists.exclude],
            ['ipsetExclude', 'Локальные сети', pack.lists.ipsetExclude],
            ['extra', 'Домены Prism', EXTRA_DOMAINS.length]
          ] as [ListName, string, number][]
        ).map(([n, label, count]) => (
          <button key={n} className="chip" style={{ cursor: 'pointer' }} onClick={() => onView(n)}>
            {label} · {count}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ─────────────── сборка и обновления ─────────────── */

function PackCard(): JSX.Element {
  const z = useStore((s) => s.zapret)
  const cfg = useStore((s) => s.snap.zapret)
  const patchZapret = useStore((s) => s.patchZapret)
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const pack = z.pack!
  const u = z.update
  const newer = !!u.latest && compareVersions(u.latest, pack.version) > 0

  const open = (url: string) => () => void window.prism.system.openExternal(url)

  return (
    <div className="card pad">
      <div className="setting stack" style={{ gap: 12 }}>
        <div className="row wrap" style={{ gap: 12 }}>
          <span className={`upd-badge ${newer ? 'available' : u.error ? 'error' : ''}`}>
            {u.installing ? <RefreshCw size={18} className="spin" /> : <Package size={18} />}
          </span>
          <div className="grow col" style={{ gap: 2, minWidth: 200 }}>
            <b style={{ fontSize: 13.5 }}>
              {u.installing ? `Устанавливаю сборку ${u.latest ?? ''}…` : newer ? `Доступна сборка ${u.latest}` : `zapret-discord-youtube ${pack.version}`}
            </b>
            <span className="dim" style={{ fontSize: 12 }}>
              {u.error
                ? u.error
                : newer
                  ? `Установлена ${pack.version} · новые стратегии и списки`
                  : `${pack.strategies.length} ${plural(pack.strategies.length, 'стратегия', 'стратегии', 'стратегий')} · ${
                      u.checkedAt ? `проверено в ${new Date(u.checkedAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}` : 'обновления ещё не проверялись'
                    }`}
            </span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {newer ? (
              <button
                className="btn primary"
                disabled={busy || u.installing || !z.elevated}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await window.prism.zapret.installLatest()
                    if (r.ok) toast('ok', `Сборка обновлена до ${u.latest}`)
                    else toast('error', r.error)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Download size={15} />
                Обновить
              </button>
            ) : (
              <button
                className="btn"
                disabled={busy || u.checking}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const s = await window.prism.zapret.checkUpdate()
                    if (!s.update.error && s.update.latest && s.pack && compareVersions(s.update.latest, s.pack.version) <= 0) {
                      toast('ok', 'Установлена последняя сборка')
                    }
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <RefreshCw size={15} className={busy || u.checking ? 'spin' : ''} />
                Проверить
              </button>
            )}
            <InstallFromFile sm disabled={!z.elevated || u.installing} />
            <button className="btn icon ghost" title="Открыть каталог zapret" onClick={() => window.prism.zapret.openRoot()}>
              <FolderOpen size={15} />
            </button>
          </div>
        </div>
      </div>

      <Setting
        title="Проверять обновления сборки"
        hint="Раз в 12 часов Prism смотрит, не вышла ли новая сборка стратегий, и сообщает об этом. Ничего не скачивается без вашего согласия."
      >
        <Switch on={cfg.checkUpdates} onChange={(v) => patchZapret({ checkUpdates: v })} />
      </Setting>

      <div className="setting">
        <div className="txt">
          <span style={{ marginTop: 0 }}>
            Сделано на{' '}
            <a className="link" onClick={open('https://github.com/bol-van/zapret')}>
              zapret
            </a>{' '}
            от bol-van со стратегиями и списками{' '}
            <a className="link" onClick={open(ZAPRET_REPO_URL)}>
              Flowseal
            </a>{' '}
            — обе под лицензией MIT; драйвер{' '}
            <a className="link" onClick={open('https://github.com/basil00/WinDivert')}>
              WinDivert
            </a>{' '}
            — LGPL-3.0. Сборка скачивается с GitHub авторов и в установщик Prism не входит.
          </span>
        </div>
        <button className="btn sm ghost" onClick={open(`${ZAPRET_REPO_URL}#распространенные-вопросы-и-проблемы`)}>
          <ExternalLink size={14} />
          Частые вопросы
        </button>
      </div>
    </div>
  )
}
