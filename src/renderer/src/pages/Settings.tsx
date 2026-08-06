import { useState } from 'react'
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderOpen,
  Info,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Unplug
} from 'lucide-react'
import { DNS_PRESETS_LOCAL, DNS_PRESETS_REMOTE } from '@shared/defaults'
import type { AccentName, DnsStrategy, GraphStyle, ThemeName, TunStack } from '@shared/types'
import { ACCENTS, bytes, speed, useStore } from '../store'
import { Modal, Segmented, Setting, Switch } from '../ui'
import logo from '../assets/logo.png'

const THEMES: { id: ThemeName; label: string; hint: string }[] = [
  { id: 'dark', label: 'Тёмная', hint: 'По умолчанию' },
  { id: 'light', label: 'Светлая', hint: 'Для яркого света' },
  { id: 'aero', label: 'Aero', hint: 'В духе XP и Vista' },
  { id: 'glass', label: 'Liquid Glass', hint: 'Матовое стекло' },
  { id: 'win95', label: 'Windows 95', hint: 'Серый пластик и бирюза' }
]

/** Маленький макет окна — понятнее, чем название темы в списке */
function ThemePreview({ id }: { id: ThemeName }): JSX.Element {
  const skin =
    id === 'dark'
      ? { bg: 'linear-gradient(160deg,#0e1421,#070a11)', bar: 'rgba(255,255,255,.07)', card: 'rgba(255,255,255,.07)', line: 'rgba(255,255,255,.16)', radius: 4 }
      : id === 'light'
        ? { bg: 'linear-gradient(160deg,#f7f9fc,#e8ecf4)', bar: 'rgba(15,23,42,.06)', card: '#fff', line: 'rgba(15,23,42,.14)', radius: 4 }
        : id === 'aero'
          ? { bg: 'linear-gradient(170deg,#a9cff0,#4f86c6)', bar: 'rgba(255,255,255,.65)', card: 'rgba(255,255,255,.8)', line: 'rgba(11,42,92,.3)', radius: 2 }
          : id === 'glass'
            ? { bg: 'radial-gradient(120% 100% at 15% 0%, #3b82f6 0%, #7c3aed 55%, #0a0f1c 100%)', bar: 'rgba(255,255,255,.14)', card: 'rgba(255,255,255,.16)', line: 'rgba(255,255,255,.3)', radius: 7 }
            : { bg: '#008080', bar: 'linear-gradient(90deg,#000080,#1084d0)', card: '#c0c0c0', line: '#808080', radius: 0 }

  const glossy = id === 'aero'
  return (
    <span className="theme-preview" style={{ background: skin.bg }}>
      <span style={{ position: 'absolute', inset: 0, height: 11, background: skin.bar, borderBottom: `1px solid ${skin.line}` }} />
      <span
        style={{
          position: 'absolute', left: 7, top: 18, width: 26, bottom: 8,
          background: skin.card, border: `1px solid ${skin.line}`, borderRadius: skin.radius
        }}
      />
      <span
        style={{
          position: 'absolute', left: 39, top: 18, right: 7, height: 13, borderRadius: skin.radius,
          border: glossy ? '1px solid color-mix(in srgb, var(--accent-1) 65%, #000)' : 'none',
          background: glossy
            ? 'linear-gradient(180deg, color-mix(in srgb, var(--accent-1) 40%, #fff) 0%, color-mix(in srgb, var(--accent-1) 85%, #fff) 48%, color-mix(in srgb, var(--accent-1) 90%, #000) 52%, color-mix(in srgb, var(--accent-1) 65%, #fff) 100%)'
            : 'linear-gradient(90deg, var(--accent-1), var(--accent-2))'
        }}
      />
      <span
        style={{
          position: 'absolute', left: 39, top: 36, right: 7, bottom: 8, borderRadius: skin.radius,
          background: skin.card, border: `1px solid ${skin.line}`
        }}
      />
    </span>
  )
}

function ColorPick({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <label className="color-pick" title={`${label}: ${value}`}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      {label}
    </label>
  )
}

const RELEASES_URL = 'https://github.com/dT0lkien/prism-vpn/releases/latest'

/** Блок состояния обновления: у каждого статуса своё действие */
function UpdateSection(): JSX.Element {
  const { update, info, toast } = useStore()
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const checked = update.checkedAt
    ? `проверено в ${new Date(update.checkedAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}`
    : 'ещё не проверялось'

  return (
    <div className="setting stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 12 }}>
        <span className={`upd-badge ${update.status}`}>
          {update.status === 'ready' ? (
            <PackageCheck size={18} />
          ) : update.status === 'available' ? (
            <Download size={18} />
          ) : update.status === 'error' ? (
            <AlertTriangle size={18} />
          ) : update.status === 'unsupported' ? (
            <Info size={18} />
          ) : (
            <RefreshCw size={18} className={update.status === 'checking' ? 'spin' : ''} />
          )}
        </span>

        <div className="grow col" style={{ gap: 2, minWidth: 0 }}>
          <b style={{ fontSize: 13.5 }}>
            {update.status === 'checking'
              ? 'Проверяю обновления…'
              : update.status === 'available'
                ? `Доступна версия ${update.version}`
                : update.status === 'downloading'
                  ? `Загружаю версию ${update.version}`
                  : update.status === 'ready'
                    ? `Версия ${update.version} готова к установке`
                    : update.status === 'error'
                      ? 'Не удалось проверить обновления'
                      : update.status === 'unsupported'
                        ? 'Автообновление недоступно'
                        : `У вас последняя версия — ${info?.appVersion}`}
          </b>
          <span className="dim" style={{ fontSize: 12 }}>
            {update.status === 'error' || update.status === 'unsupported'
              ? update.error
              : update.status === 'downloading'
                ? `${bytes(update.transferred ?? 0)} из ${bytes(update.total ?? 0)} · ${speed(update.bytesPerSecond ?? 0)}`
                : update.status === 'ready'
                  ? 'Prism отключит туннель, поставит обновление и запустится заново'
                  : checked}
          </span>
        </div>

        {update.status === 'available' && (
          <button className="btn primary" disabled={busy} onClick={() => run(() => window.prism.update.download())}>
            <Download size={15} />
            Скачать
          </button>
        )}
        {update.status === 'ready' && (
          <button className="btn primary" disabled={busy} onClick={() => run(() => window.prism.update.install())}>
            <PackageCheck size={15} />
            Установить
          </button>
        )}
        {update.status === 'unsupported' && (
          <button className="btn" onClick={() => window.prism.system.openExternal(RELEASES_URL)}>
            <ExternalLink size={15} />
            Открыть релизы
          </button>
        )}
        {(update.status === 'idle' || update.status === 'error') && (
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await window.prism.update.check()
                if (r.status === 'idle') toast('ok', 'Установлена последняя версия')
              })
            }
          >
            <RefreshCw size={15} className={busy ? 'spin' : ''} />
            Проверить
          </button>
        )}
      </div>

      {update.status === 'downloading' && (
        <div style={{ height: 5, background: 'var(--panel-3)', borderRadius: 99, overflow: 'hidden' }}>
          <div
            style={{
              width: `${update.percent ?? 0}%`,
              height: '100%',
              background: 'linear-gradient(90deg, var(--accent-1), var(--accent-2))',
              transition: 'width .3s ease'
            }}
          />
        </div>
      )}

      {update.status === 'available' && update.notes && (
        <div className="upd-notes">{stripHtml(update.notes).slice(0, 600)}</div>
      )}
    </div>
  )
}

/** Описание релиза приходит разметкой — показываем текстом */
function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default function SettingsPage(): JSX.Element {
  const { snap, patchSettings, info, toast, core } = useStore()
  const s = snap.settings
  const [cfgOpen, setCfgOpen] = useState(false)
  const [cfg, setCfg] = useState('')
  const [extra, setExtra] = useState(s.extraConfig)
  const [check, setCheck] = useState<{ ok: boolean; error?: string } | null>(null)
  /** Цвета, которые сейчас реально применены */
  const pair: [string, string] = s.accentCustom
    ? [s.accentCustom.a, s.accentCustom.b]
    : (ACCENTS[s.accent] ?? ACCENTS.aurora)

  const showConfig = async (): Promise<void> => {
    setCfg(await window.prism.config.preview())
    setCfgOpen(true)
  }

  const saveExtra = async (): Promise<void> => {
    const r = await window.prism.config.validate(extra)
    setCheck(r)
    if (r.ok) {
      await patchSettings({ extraConfig: extra })
      toast('ok', 'Дополнительный конфиг применён')
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Настройки</h1>
        <p>Тонкая настройка перехвата трафика, DNS и поведения приложения.</p>
      </div>

      {/* ─── Подключение ─── */}
      <div className="section-title">Подключение</div>
      <div className="card pad">
        <Setting
          title="Способ перехвата"
          hint="TUN создаёт виртуальный адаптер и забирает весь трафик, включая UDP. Системный прокси работает без прав администратора, но его учитывают не все программы и он не передаёт UDP."
        >
          <select
            className="select"
            value={s.captureMode}
            onChange={(e) => patchSettings({ captureMode: e.target.value as 'tun' | 'proxy' })}
          >
            <option value="tun">TUN — весь трафик</option>
            <option value="proxy">Системный прокси</option>
          </select>
        </Setting>

        <Setting
          title="Локальный порт"
          hint="SOCKS5 и HTTP на одном порту. Открыт всегда — можно указывать вручную в любой программе."
        >
          <input
            className="input"
            type="number"
            min={1024}
            max={65535}
            value={s.localPort}
            onChange={(e) => patchSettings({ localPort: Number(e.target.value) || 2080 })}
          />
        </Setting>

        <Setting title="Разрешить доступ из локальной сети" hint="Другие устройства смогут пользоваться этим прокси">
          <Switch on={s.allowLan} onChange={(v) => patchSettings({ allowLan: v })} />
        </Setting>

        <Setting
          title="Локальная сеть напрямую"
          hint="Роутер, принтеры, NAS и другие устройства сети остаются доступными в обход туннеля"
        >
          <Switch on={s.bypassPrivate} onChange={(v) => patchSettings({ bypassPrivate: v })} />
        </Setting>

        <Setting
          title="Блокировать QUIC"
          hint="Отбрасывает UDP на 443 порту. Браузеры и CDN откатываются на TCP, который проксируется надёжнее — частое лекарство от «не грузятся картинки». Голосовые порты Discord не затрагиваются."
        >
          <Switch on={s.blockQuic} onChange={(v) => patchSettings({ blockQuic: v })} />
        </Setting>

        <Setting
          title="Discord Fix"
          hint="Все процессы Discord и его домены идут в туннель целиком, вместе с голосовым UDP, а DNS для них разрешается через прокси"
        >
          <Switch on={s.discordFix} onChange={(v) => patchSettings({ discordFix: v })} />
        </Setting>
      </div>

      {/* ─── TUN ─── */}
      <div className="section-title">Режим TUN</div>
      <div className="card pad" style={{ opacity: s.captureMode === 'tun' ? 1 : 0.55 }}>
        <Setting
          title="Сетевой стек"
          hint="mixed — оптимальный по умолчанию. gvisor надёжнее в необычных сетях, system быстрее, но капризнее."
        >
          <select
            className="select"
            value={s.tun.stack}
            onChange={(e) => patchSettings({ tun: { ...s.tun, stack: e.target.value as TunStack } })}
          >
            <option value="mixed">mixed</option>
            <option value="gvisor">gvisor</option>
            <option value="system">system</option>
          </select>
        </Setting>

        <Setting title="MTU" hint="Уменьшите до 1400–1500, если часть сайтов открывается наполовину">
          <input
            className="input"
            type="number"
            min={576}
            max={9000}
            value={s.tun.mtu}
            onChange={(e) => patchSettings({ tun: { ...s.tun, mtu: Number(e.target.value) || 9000 } })}
          />
        </Setting>

        <Setting title="Строгая маршрутизация" hint="Не даёт трафику утечь мимо туннеля в обход правил">
          <Switch on={s.tun.strictRoute} onChange={(v) => patchSettings({ tun: { ...s.tun, strictRoute: v } })} />
        </Setting>

        <Setting title="IPv6 в туннеле" hint="Включайте, только если ваш сервер действительно поддерживает IPv6">
          <Switch on={s.tun.ipv6} onChange={(v) => patchSettings({ tun: { ...s.tun, ipv6: v } })} />
        </Setting>
      </div>

      {/* ─── DNS ─── */}
      <div className="section-title">DNS</div>
      <div className="card pad">
        <Setting title="Через туннель" hint="Разрешает имена на той стороне — провайдер не видит запросы и не подменяет ответы">
          <input
            className="input"
            list="dns-remote"
            value={s.dns.remote}
            onChange={(e) => patchSettings({ dns: { ...s.dns, remote: e.target.value } })}
          />
          <datalist id="dns-remote">
            {DNS_PRESETS_REMOTE.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </datalist>
        </Setting>

        <Setting title="Напрямую" hint="Используется для российских сайтов и адреса самого VPN-сервера">
          <input
            className="input"
            list="dns-local"
            value={s.dns.local}
            onChange={(e) => patchSettings({ dns: { ...s.dns, local: e.target.value } })}
          />
          <datalist id="dns-local">
            {DNS_PRESETS_LOCAL.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </datalist>
        </Setting>

        <Setting title="Приоритет адресов">
          <select
            className="select"
            value={s.dns.strategy}
            onChange={(e) => patchSettings({ dns: { ...s.dns, strategy: e.target.value as DnsStrategy } })}
          >
            <option value="prefer_ipv4">Сначала IPv4</option>
            <option value="prefer_ipv6">Сначала IPv6</option>
            <option value="ipv4_only">Только IPv4</option>
            <option value="ipv6_only">Только IPv6</option>
          </select>
        </Setting>

        <Setting
          title="Российские домены — местным DNS"
          hint="Быстрее и корректнее для сайтов с российскими CDN"
        >
          <Switch on={s.dns.splitDns} onChange={(v) => patchSettings({ dns: { ...s.dns, splitDns: v } })} />
        </Setting>

        <Setting
          title="Fake-IP"
          hint="Точное совпадение правил по доменам ценой возможных проблем у игр и программ, которые кэшируют адреса сами"
        >
          <Switch on={s.dns.fakeIp} onChange={(v) => patchSettings({ dns: { ...s.dns, fakeIp: v } })} />
        </Setting>

        <Setting title="Резать рекламу на уровне DNS" hint="Рекламные домены не будут разрешаться вовсе">
          <Switch on={s.dns.blockAds} onChange={(v) => patchSettings({ dns: { ...s.dns, blockAds: v } })} />
        </Setting>
      </div>

      {/* ─── Приложение ─── */}
      <div className="section-title">Приложение</div>
      <div className="card pad">
        <Setting title="Запускать вместе с Windows">
          <Switch on={s.autoStart} onChange={(v) => patchSettings({ autoStart: v })} />
        </Setting>

        <Setting
          title="Автозапуск с правами администратора"
          hint="Создаёт задачу в планировщике, чтобы TUN поднимался при входе в систему без окна UAC. Требует подтверждения один раз."
        >
          <Switch
            on={s.startElevated}
            disabled={!s.autoStart}
            onChange={async (v) => {
              await patchSettings({ startElevated: v })
              const r = await window.prism.system.setAutoStart(s.autoStart, v)
              if (!r.ok) toast('error', r.error ?? 'Не удалось настроить автозапуск')
              else if (v) toast('ok', 'Задача автозапуска создана')
            }}
          />
        </Setting>

        <Setting title="Подключаться при запуске">
          <Switch on={s.autoConnect} onChange={(v) => patchSettings({ autoConnect: v })} />
        </Setting>

        <Setting title="Запускать свёрнутым в трей">
          <Switch on={s.startMinimized} onChange={(v) => patchSettings({ startMinimized: v })} />
        </Setting>

        <Setting title="Сворачивать в трей" hint="Кнопка «свернуть» прячет окно в область уведомлений">
          <Switch on={s.minimizeToTray} onChange={(v) => patchSettings({ minimizeToTray: v })} />
        </Setting>

        <Setting title="Закрытие окна не выключает VPN" hint="Приложение продолжит работать в трее">
          <Switch on={s.closeToTray} onChange={(v) => patchSettings({ closeToTray: v })} />
        </Setting>
      </div>

      {/* ─── Внешний вид ─── */}
      <div className="section-title">Внешний вид</div>
      <div className="card pad">
        <div className="setting stack" style={{ gap: 12 }}>
          <div className="txt">
            <b>Тема</b>
            <span>Общее оформление окна</span>
          </div>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-card${s.theme === t.id ? ' active' : ''}`}
                onClick={() => patchSettings({ theme: t.id })}
              >
                <ThemePreview id={t.id} />
                <span className="name">{t.label}</span>
                <span className="hint">{t.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <Setting title="Вид графика" hint="Как рисовать трафик на главной странице">
          <Segmented<GraphStyle>
            id="graph"
            value={s.graphStyle}
            onChange={(v) => patchSettings({ graphStyle: v })}
            options={[
              { value: 'mirror', label: 'Зеркало' },
              { value: 'area', label: 'Волна' }
            ]}
          />
        </Setting>

        <div className="setting stack" style={{ gap: 12 }}>
          <div className="txt">
            <b>Акцент</b>
            <span>Цвет кнопок, графиков и подсветки. Возьмите готовый набор или подберите свой.</span>
          </div>

          <div className="row wrap" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 7 }}>
              {(Object.keys(ACCENTS) as AccentName[]).map((a) => {
                const on = !s.accentCustom && s.accent === a
                return (
                  <button
                    key={a}
                    onClick={() => patchSettings({ accent: a, accentCustom: undefined })}
                    title={a}
                    className="accent-dot"
                    style={{
                      background: `linear-gradient(135deg, ${ACCENTS[a][0]}, ${ACCENTS[a][1]})`,
                      borderColor: on ? 'var(--text)' : 'transparent'
                    }}
                  />
                )
              })}
            </div>

            <div className="grow" />

            <div className="row" style={{ gap: 8 }}>
              <ColorPick
                label="Основной"
                value={pair[0]}
                onChange={(v) => patchSettings({ accentCustom: { a: v, b: pair[1] } })}
              />
              <ColorPick
                label="Второй"
                value={pair[1]}
                onChange={(v) => patchSettings({ accentCustom: { a: pair[0], b: v } })}
              />
              {s.accentCustom && (
                <button className="btn sm ghost" onClick={() => patchSettings({ accentCustom: undefined })}>
                  Сбросить
                </button>
              )}
            </div>
          </div>

          <div className="accent-preview" style={{ background: `linear-gradient(90deg, ${pair[0]}, ${pair[1]})` }} />
        </div>
      </div>

      {/* ─── Обновления ─── */}
      <div className="section-title">Обновления</div>
      <div className="card pad">
        <UpdateSection />
        <Setting
          title="Проверять автоматически"
          hint="Раз в шесть часов Prism смотрит, не вышла ли новая версия. Ничего не скачивается без вашего согласия."
        >
          <Switch on={s.autoUpdate} onChange={(v) => patchSettings({ autoUpdate: v })} />
        </Setting>
      </div>

      {/* ─── О программе ─── */}
      <div className="section-title">О программе</div>
      <div className="card pad">
        <div className="row" style={{ gap: 15 }}>
          <img src={logo} width={52} height={52} style={{ borderRadius: 13 }} alt="" />
          <div className="grow col" style={{ gap: 3 }}>
            <b style={{ fontSize: 15 }}>Prism {info?.appVersion}</b>
            <span className="mut" style={{ fontSize: 12.5 }}>
              Ядро sing-box {info?.coreVersion} · {info?.elevated ? 'права администратора есть' : 'обычные права'}
            </span>
            <span className="dim" style={{ fontSize: 12 }}>
              Списки маршрутизации вшиты в приложение — VPN поднимется, даже если GitHub недоступен.
            </span>
          </div>
          <span className={`chip ${core.status === 'running' ? 'ok' : ''}`}>
            <Info size={12} />
            {core.status === 'running' ? 'работает' : 'остановлено'}
          </span>
        </div>
      </div>

      <Modal
        open={cfgOpen}
        onClose={() => setCfgOpen(false)}
        wide
        title="Итоговый конфиг sing-box"
        icon={<Braces size={17} className="mut" />}
        footer={
          <button
            className="btn"
            onClick={() => {
              void window.prism.system.clipboardWrite(cfg)
              toast('ok', 'Скопировано')
            }}
          >
            Копировать
          </button>
        }
      >
        <p className="dim" style={{ fontSize: 12 }}>
          Ровно это Prism передаёт ядру. Правила идут сверху вниз, срабатывает первое подходящее.
        </p>
        <pre
          className="mono"
          style={{
            fontSize: 11,
            lineHeight: 1.55,
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r)',
            padding: 14,
            maxHeight: '52vh',
            overflow: 'auto',
            userSelect: 'text',
            whiteSpace: 'pre'
          }}
        >
          {cfg}
        </pre>
      </Modal>
    </>
  )
}
