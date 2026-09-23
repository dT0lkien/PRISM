/* Общие типы, разделяемые между main и renderer */

export type NodeType =
  | 'vless'
  | 'vmess'
  | 'trojan'
  | 'shadowsocks'
  | 'hysteria2'
  | 'hysteria'
  | 'tuic'
  | 'anytls'
  | 'wireguard'
  | 'ssh'
  | 'http'
  | 'socks'
  | 'shadowtls'

/** Один сервер (превращается в sing-box outbound) */
export interface ServerNode {
  id: string
  name: string
  type: NodeType
  server: string
  port: number
  /** Готовый sing-box outbound без поля tag */
  outbound: Record<string, unknown>
  /** Исходная ссылка, если импортировали из URL */
  link?: string
  subscriptionId?: string
  /** Задержка в мс, -1 = недоступен, undefined = не проверяли */
  latency?: number
  latencyCheckedAt?: number
  createdAt: number
}

export interface Subscription {
  id: string
  name: string
  url: string
  autoUpdate: boolean
  intervalHours: number
  updatedAt?: number
  lastError?: string
  /** Данные из заголовка subscription-userinfo */
  userInfo?: {
    upload?: number
    download?: number
    total?: number
    expire?: number
  }
}

/* ─────────────────────────── Маршрутизация ─────────────────────────── */

export type RuleAction = 'proxy' | 'direct' | 'block'

export type MatcherKind =
  | 'process' // имена .exe
  | 'process_path' // полные пути
  | 'domain' // полное совпадение
  | 'domain_suffix'
  | 'domain_keyword'
  | 'domain_regex'
  | 'ip_cidr'
  | 'port'
  | 'port_range'
  | 'ruleset' // теги локальных/удалённых rule-set
  | 'network' // tcp | udp
  | 'protocol' // http/tls/quic/dns/stun/bittorrent

export interface Matcher {
  kind: MatcherKind
  values: string[]
}

export interface RoutingRule {
  id: string
  name: string
  enabled: boolean
  action: RuleAction
  matchers: Matcher[]
  /** Явно выбранный outbound-тег (иначе берётся из action) */
  outboundTag?: string
  /** Правило пришло из пресета — можно отключить, но не удалить */
  preset?: string
}

/** Приложение в списке per-app маршрутизации */
export interface AppRule {
  id: string
  /** Имя исполняемого файла, напр. Discord.exe */
  exe: string
  /** Отображаемое имя */
  name: string
  /** Полный путь (если известен) */
  path?: string
  /** Иконка в data:image/png;base64 */
  icon?: string
  action: RuleAction
  enabled: boolean
}

export type RoutingMode = 'global' | 'smart' | 'whitelist' | 'direct'
export type CaptureMode = 'tun' | 'proxy'
export type TunStack = 'mixed' | 'gvisor' | 'system'
export type DnsStrategy = 'prefer_ipv4' | 'prefer_ipv6' | 'ipv4_only' | 'ipv6_only'

export interface Settings {
  captureMode: CaptureMode
  routingMode: RoutingMode

  /** Локальный mixed-порт (SOCKS5 + HTTP), открыт всегда */
  localPort: number
  allowLan: boolean
  clashPort: number

  tun: {
    stack: TunStack
    mtu: number
    autoRoute: boolean
    strictRoute: boolean
    ipv6: boolean
  }

  dns: {
    remote: string
    local: string
    strategy: DnsStrategy
    fakeIp: boolean
    blockAds: boolean
    /** Домены RU-зоны резолвить локальным DNS */
    splitDns: boolean
  }

  /** Специальные фиксы */
  discordFix: boolean
  blockQuic: boolean
  bypassPrivate: boolean

  /** Поведение приложения */
  autoStart: boolean
  /** Проверять обновления в фоне */
  autoUpdate: boolean
  autoConnect: boolean
  startElevated: boolean
  minimizeToTray: boolean
  closeToTray: boolean
  startMinimized: boolean

  theme: ThemeName
  accent: AccentName
  /** Свои цвета акцента; заданы — пресет не используется */
  accentCustom?: { a: string; b: string }
  graphStyle: GraphStyle
  language: 'ru' | 'en'
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error'

  /** Сырой JSON, который сливается поверх сгенерированного конфига */
  extraConfig: string
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error'
  /** Портативная сборка и режим разработки обновлять себя не умеют */
  | 'unsupported'

export interface UpdateState {
  status: UpdateStatus
  /** Версия, которую предлагают поставить */
  version?: string
  notes?: string
  releasedAt?: string
  /** 0..100 */
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  error?: string
  checkedAt?: number
}

export type ThemeName = 'dark' | 'light' | 'aero' | 'glass' | 'win95' | 'frutiger' | 'cats' | 'chrome'
/** Как рисовать график трафика */
export type GraphStyle = 'mirror' | 'area'
export type AccentName = 'aurora' | 'violet' | 'ember' | 'ocean' | 'rose' | 'lime'

/* ─────────────────────────── Рантайм ─────────────────────────── */

export type CoreStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

export interface CoreState {
  status: CoreStatus
  since?: number
  error?: string
  elevated: boolean
  captureMode: CaptureMode
  activeNodeId?: string
  /** Реально применённый системный прокси */
  systemProxyOn: boolean
}

export interface TrafficSample {
  up: number
  down: number
  t: number
}

export interface TrafficTotals {
  up: number
  down: number
}

export interface LogEntry {
  id: number
  level: string
  message: string
  t: number
  source: 'core' | 'app' | 'zapret'
}

export interface ConnectionItem {
  id: string
  host: string
  ip: string
  port: number
  network: string
  process: string
  processPath: string
  outbound: string
  chains: string[]
  upload: number
  download: number
  start: number
  rule: string
}

export interface ProfileBundle {
  nodes: ServerNode[]
  subscriptions: Subscription[]
  activeNodeId?: string
}

export interface ImportResult {
  ok: boolean
  added: number
  updated: number
  skipped: number
  error?: string
  names: string[]
}

/** Информация об установленном/запущенном приложении для пикера */
export interface DetectedApp {
  exe: string
  name: string
  path: string
  icon?: string
  running: boolean
}

/* ─────────────────────────── Zapret ─────────────────────────── */
/* Обход DPI без VPN на основе сборки Flowseal/zapret-discord-youtube.
   Работает только в Windows: пакеты перехватывает драйвер WinDivert. */

/** Обход для игр — порты выше 1023. off — выключен */
export type ZapretGameFilter = 'off' | 'all' | 'tcp' | 'udp'
/** Кого ловит ipset: none — никого, loaded — адреса из списка, any — любой IP */
export type ZapretIpsetMode = 'none' | 'loaded' | 'any'

/** Свои списки пользователя — то, что в сборке лежит в *-user.txt */
export interface ZapretLists {
  /** Домены для обхода, поддомены учитываются сами */
  general: string[]
  /** Домены, которые обходить не надо */
  exclude: string[]
  /** Свои IP и подсети — дописываются к ipset-all.txt */
  ipset: string[]
  /** IP и подсети, которые обходить не надо */
  ipsetExclude: string[]
}

export interface ZapretConfig {
  /** Стратегия — имя .bat из сборки без расширения, напр. «general (ALT5)» */
  strategy: string
  gameFilter: ZapretGameFilter
  ipsetMode: ZapretIpsetMode
  /** Фейк для голоса Discord — имя .bin из сборки; пусто — как задумано в сборке */
  fakeDiscord: string
  /** Фейк для UDP игр */
  fakeGame: string
  /** Добавлять к спискам сборки домены Prism — Telegram-веб и картинки Spotify */
  extraDomains: boolean
  /** Поднимать обход при запуске Prism */
  autoStart: boolean
  /** Проверять, не вышла ли новая сборка стратегий */
  checkUpdates: boolean
  lists: ZapretLists
}

export interface ZapretStrategy {
  /** Имя файла без .bat */
  id: string
  /** Коротко: general, ALT5, FAKE TLS AUTO */
  label: string
  /** Чем обманывает DPI — собрано из аргументов */
  summary: string
}

export interface ZapretPack {
  version: string
  strategies: ZapretStrategy[]
  /** Файлы фейков из bin без расширения, кроме ACTIVE_* */
  fakes: string[]
  /** Какой фейк сборка ставит по умолчанию — по совпадению содержимого */
  defaultFakeDiscord?: string
  defaultFakeGame?: string
  /** Размеры встроенных списков */
  lists: { general: number; google: number; exclude: number; ipsetExclude: number; ipset: number }
  /** Когда ipset обновлялся с GitHub; не задано — список из сборки */
  ipsetUpdatedAt?: number
}

export type ZapretStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface ZapretState {
  /** Windows — единственная платформа, где это работает */
  supported: boolean
  elevated: boolean
  /** Каталог, где лежат сборки и рабочие списки */
  root: string
  /** Сборка не установлена — undefined */
  pack?: ZapretPack
  status: ZapretStatus
  /** Какая стратегия запущена сейчас */
  running?: string
  since?: number
  error?: string
  /** Последние строки вывода winws.exe */
  output: string[]
  service: {
    installed: boolean
    /** Running, Stopped, Stop Pending… */
    state?: string
    strategy?: string
    /** Служба смотрит не в каталог Prism — её ставил service.bat или другая сборка */
    foreign?: boolean
  }
  /** Драйвер WinDivert загружен */
  windivert?: string
  /** Сколько запущено winws.exe, которые запускал не Prism */
  foreignWinws: number
  update: {
    checking?: boolean
    installing?: boolean
    latest?: string
    checkedAt?: number
    error?: string
  }
  /** Итог последнего теста стратегий */
  lastTest?: ZapretTestSummary
}

export type ZapretTestKind = 'standard' | 'dpi'
export type ZapretCheckStatus = 'ok' | 'error' | 'ssl' | 'unsup' | 'blocked' | 'fail'

export interface ZapretTargetResult {
  name: string
  checks: { label: string; status: ZapretCheckStatus; detail?: string }[]
  /** «12 мс», «Timeout» или undefined для DPI-проверок */
  ping?: string
}

export interface ZapretStrategyResult {
  strategy: string
  /** winws.exe поднялся с этой стратегией */
  started: boolean
  ok: number
  error: number
  unsup: number
  blocked: number
  pingOk: number
  pingFail: number
  targets: ZapretTargetResult[]
}

export interface ZapretTestProgress {
  running: boolean
  kind: ZapretTestKind
  total: number
  done: number
  current?: string
  results: ZapretStrategyResult[]
  best?: string
  error?: string
  /** Куда сохранён отчёт */
  file?: string
  finishedAt?: number
}

export interface ZapretTestSummary {
  kind: ZapretTestKind
  at: number
  best?: string
  /** стратегия → «сколько проверок прошло из скольких» */
  scores: Record<string, { ok: number; total: number }>
}

export interface ZapretCheck {
  id: string
  level: 'ok' | 'warn' | 'error'
  title: string
  detail?: string
  link?: string
  /** Prism умеет починить сам */
  fix?: 'tcp-timestamps' | 'remove-windivert' | 'remove-conflicts'
}

export interface ZapretHostsInfo {
  /** Все адреса из списка уже в hosts */
  upToDate: boolean
  total: number
  missing: number
  /** Строк вне блока Prism для тех же имён — заменятся при обновлении */
  stale: number
  /** В hosts есть блок, который добавил Prism */
  managed: boolean
  /** Что добавится — для предпросмотра */
  entries: string[]
  /** Записей для других доменов в списке сборки — Prism их не пишет */
  skipped: number
}
