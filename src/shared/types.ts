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
    /** Исключить эти приложения из TUN на уровне ядра (не заворачивать вовсе) */
    excludePackages: string[]
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
  killSwitch: boolean

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
  language: 'ru' | 'en'
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error'

  /** Сырой JSON, который сливается поверх сгенерированного конфига */
  extraConfig: string
  /** Полностью ручной конфиг вместо генератора */
  manualConfig: boolean
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
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

export type ThemeName = 'dark' | 'light' | 'aero'
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
  source: 'core' | 'app'
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
