/* Zapret: чистая логика без Electron и файловой системы.

   Сборка Flowseal описывает стратегии bat-файлами: в каждом одна длинная
   команда `start … winws.exe <аргументы>` с переменными %BIN%, %LISTS% и
   %GameFilter*%. Prism не запускает эти файлы через cmd — он разбирает
   команду, подставляет свои пути и сам стартует winws.exe. Так не нужен
   service.bat, который правит файлы сборки на месте, и не нужна консоль. */

import type { ZapretConfig, ZapretGameFilter, ZapretIpsetMode, ZapretStrategyResult, ZapretTestKind } from './types'

export const ZAPRET_REPO = 'Flowseal/zapret-discord-youtube'
export const ZAPRET_REPO_URL = `https://github.com/${ZAPRET_REPO}`
const RAW = `https://raw.githubusercontent.com/${ZAPRET_REPO}/refs/heads/main/.service`
export const ZAPRET_IPSET_URL = `${RAW}/ipset-service.txt`
export const ZAPRET_HOSTS_URL = `${RAW}/hosts`
export const ZAPRET_RELEASE_API = `https://api.github.com/repos/${ZAPRET_REPO}/releases/latest`
/** Набор DPI-чекеров hyperion-cs/dpi-checkers — тот же, что берёт утилита тестов сборки */
export const ZAPRET_DPI_SUITE_URL = 'https://hyperion-cs.github.io/dpi-checkers/ru/tcp-16-20/suite.v2.json'

/** Адрес из диапазона для документации: так сборка помечает «пустой» ipset */
export const IPSET_PLACEHOLDER = '203.0.113.113/32'
/** Пустой hostlist в winws значит «любой домен» — поэтому пустым список не бывает */
export const DOMAIN_PLACEHOLDER = 'domain.example.abc'

export const DEFAULT_ZAPRET: ZapretConfig = {
  strategy: 'general',
  gameFilter: 'off',
  /* В сборке ipset-all.txt по умолчанию содержит только заглушку, а настоящий
     список лежит в .backup — то есть из коробки режим none. Держимся того же:
     «any» и «loaded» задевают сайты, которые без обхода и так работают. */
  ipsetMode: 'none',
  fakeDiscord: '',
  fakeGame: '',
  extraDomains: true,
  autoStart: false,
  checkUpdates: true,
  lists: { general: [], exclude: [], ipset: [], ipsetExclude: [] }
}

/**
 * Домены, которых нет в списках сборки, а без них у людей не работает.
 * Проверено на живой Windows: без них обложки Spotify не грузятся вовсе
 * (0 из 8 запросов), а веб-версия Telegram открывается через раз.
 * Запись покрывает и поддомены: telegram.org — это и web.telegram.org.
 */
export const EXTRA_DOMAIN_GROUPS: { group: string; note: string; domains: string[] }[] = [
  { group: 'Telegram', note: 'веб-версия и превью ссылок', domains: ['telegram.org', 't.me', 'telegram.me', 'telesco.pe', 'tg.dev'] },
  { group: 'Spotify', note: 'обложки альбомов и картинки интерфейса', domains: ['scdn.co', 'spotifycdn.com', 'spotify.com'] }
]

/** Про что обход бессилен — об этом честно сказать рядом с переключателем */
export const EXTRA_DOMAINS_NOTE =
  'Telegram Desktop так не чинится: его дата-центры закрыты по IP, а обход правит только содержимое пакетов — тут нужен VPN.'

export const EXTRA_DOMAINS = EXTRA_DOMAIN_GROUPS.flatMap((g) => g.domains)

export const GAME_FILTERS: readonly ZapretGameFilter[] = ['off', 'all', 'tcp', 'udp']
export const IPSET_MODES: readonly ZapretIpsetMode[] = ['none', 'loaded', 'any']

/* ─────────────────────────── стратегии ─────────────────────────── */

/** «general (ALT5)» → «ALT5», «general» → «general» */
export function strategyLabel(id: string): string {
  return id.match(/^general\s*\((.+)\)$/i)?.[1]?.trim() ?? id
}

/** Порядок как в меню сборки: числа сравниваются как числа, ALT2 раньше ALT10 */
export function compareStrategies(a: string, b: string): number {
  const pad = (s: string): string => s.replace(/\d+/g, (d) => d.padStart(8, '0'))
  return pad(a.toLowerCase()) < pad(b.toLowerCase()) ? -1 : pad(a.toLowerCase()) > pad(b.toLowerCase()) ? 1 : 0
}

/**
 * Достаёт аргументы winws.exe из bat-файла стратегии.
 * Возвращает argv так, как его увидит winws: кавычки сняты, `^` раскрыт,
 * переменные вида %BIN% оставлены — их подставляет expandStrategy.
 */
export function parseStrategy(text: string): string[] | null {
  const lines = text.replace(/\r/g, '').split('\n')
  const start = lines.findIndex((l) => /winws\.exe/i.test(l))
  if (start < 0) return null

  // Команда продолжается на следующей строке, если строка кончается на ^
  let cmd = ''
  for (let i = start; i < lines.length; i++) {
    const l = lines[i].trimEnd()
    if (l.endsWith('^') && !l.endsWith('^^')) {
      cmd += `${l.slice(0, -1)} `
      continue
    }
    cmd += l
    break
  }

  const m = /winws\.exe"?/i.exec(cmd)
  if (!m) return null
  return tokenizeCmd(cmd.slice(m.index + m[0].length))
}

/** Разбор хвоста командной строки cmd: пробелы делят, кавычки группируют, ^ экранирует вне кавычек */
function tokenizeCmd(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let has = false
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '"') {
      quoted = !quoted
      has = true
    } else if (c === '^' && !quoted && i + 1 < s.length) {
      cur += s[++i]
      has = true
    } else if ((c === ' ' || c === '\t') && !quoted) {
      if (has) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += c
      has = true
    }
  }
  if (has) out.push(cur)
  return out
}

/**
 * Коротко о приёмах стратегии: «multisplit + fake · ts». Смотрим только
 * TCP-секции: QUIC и голос Discord во всех стратегиях подделываются
 * одинаково, и в описании они бы только шумели.
 */
export function summarizeStrategy(args: string[]): string {
  const desync = new Set<string>()
  const fooling = new Set<string>()
  let section: string[] = []
  const flush = (): void => {
    if (section.some((a) => a.startsWith('--filter-tcp='))) {
      for (const a of section) {
        const d = a.match(/^--dpi-desync=(.+)$/)
        if (d) d[1].split(',').forEach((x) => desync.add(x))
        const f = a.match(/^--dpi-desync-fooling=(.+)$/)
        if (f) f[1].split(',').forEach((x) => fooling.add(x))
      }
    }
    section = []
  }
  for (const a of args) {
    if (a === '--new') flush()
    else section.push(a)
  }
  flush()
  const s = [...desync].join(' + ')
  return fooling.size ? `${s} · ${[...fooling].join(', ')}` : s
}

export interface ExpandContext {
  /** Каталог bin сборки, с разделителем на конце */
  bin: string
  /** Каталог с рабочими списками, с разделителем на конце */
  lists: string
  gameFilter: ZapretGameFilter
  /** Имена .bin для ACTIVE_DISCORD_UDP.bin / ACTIVE_GAME_UDP.bin; пусто — оставить как в сборке */
  fakeDiscord?: string
  fakeGame?: string
}

/** Порты фильтра игр. «12» — так сборка выключает секцию: на этот порт никто не ходит */
export function gameFilterPorts(mode: ZapretGameFilter): { any: string; tcp: string; udp: string } {
  const on = '1024-65535'
  const off = '12'
  switch (mode) {
    case 'all':
      return { any: on, tcp: on, udp: on }
    case 'tcp':
      return { any: on, tcp: on, udp: off }
    case 'udp':
      return { any: on, tcp: off, udp: on }
    default:
      return { any: off, tcp: off, udp: off }
  }
}

/**
 * Подставляет пути и порты в аргументы стратегии. Бросает ошибку, если
 * осталась непонятная переменная или аргумент нельзя безопасно передать:
 * тот же argv уезжает в командную строку службы Windows.
 */
export function expandStrategy(args: string[], ctx: ExpandContext): string[] {
  const ports = gameFilterPorts(ctx.gameFilter)
  const vars: Record<string, string> = {
    BIN: ctx.bin,
    LISTS: ctx.lists,
    GameFilter: ports.any,
    GameFilterTCP: ports.tcp,
    GameFilterUDP: ports.udp
  }
  return args.map((a) => {
    let v = a.replace(/%(\w+)%/g, (whole, name: string) => {
      if (!(name in vars)) throw new Error(`Стратегия использует неизвестную переменную ${whole}`)
      return vars[name]
    })
    if (ctx.fakeDiscord) v = v.split('ACTIVE_DISCORD_UDP.bin').join(`${ctx.fakeDiscord}.bin`)
    if (ctx.fakeGame) v = v.split('ACTIVE_GAME_UDP.bin').join(`${ctx.fakeGame}.bin`)
    if (/["\r\n\0]/.test(v) || v.includes('%')) throw new Error(`Недопустимый аргумент стратегии: ${a}`)
    return v
  })
}

/**
 * argv → командная строка Windows. Нужна для службы: у неё путь и аргументы
 * хранятся одной строкой. Кавычки внутри аргументов expandStrategy не пускает,
 * поэтому достаточно обернуть аргумент с пробелом и удвоить хвостовые \.
 */
export function toCommandLine(argv: string[]): string {
  return argv
    .map((a) => {
      if (a && !/[\s]/.test(a)) return a
      return `"${a.replace(/(\\+)$/, '$1$1')}"`
    })
    .join(' ')
}

/** Версия сборки из service.bat: set "LOCAL_VERSION=1.10.2" */
export function packVersionFrom(serviceBat: string): string | undefined {
  return serviceBat.match(/LOCAL_VERSION=([\w.\-]+)/)?.[1]
}

/** Сравнение версий вида 1.10.2; нечисловые хвосты игнорируются */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.\-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

/* ─────────────────────────── списки ─────────────────────────── */

const DOMAIN_RE = /^\^?[\p{L}\p{N}._\-]+$/u
const IP_RE = /^(\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?|[0-9a-f:]+(\/\d{1,3})?)$/i

/** Строки файла списка без пустых и комментариев */
export function listLines(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

/** Чистит ввод пользователя: по одному значению в строке, без мусора и повторов */
export function cleanList(values: unknown, kind: 'domain' | 'ip'): string[] {
  if (!Array.isArray(values)) return []
  const re = kind === 'domain' ? DOMAIN_RE : IP_RE
  const seen = new Set<string>()
  for (const raw of values) {
    if (typeof raw !== 'string') continue
    let v = raw.trim()
    if (kind === 'domain') v = v.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
    if (!v || v.length > 253 || !re.test(v) || v === DOMAIN_PLACEHOLDER || v === IPSET_PLACEHOLDER) continue
    seen.add(v)
    if (seen.size >= 5000) break
  }
  return [...seen]
}

export function isIpLine(v: string): boolean {
  return IP_RE.test(v)
}

/** Содержимое ipset-all.txt под режим. any — пустой файл: пустой ipset в winws значит «любой адрес» */
export function ipsetContent(mode: ZapretIpsetMode, loaded: string[], user: string[]): string[] {
  if (mode === 'any') return []
  if (mode === 'none') return [IPSET_PLACEHOLDER]
  const all = [...loaded, ...user]
  return all.length ? all : [IPSET_PLACEHOLDER]
}

/* ─────────────────────────── hosts ─────────────────────────── */

export const HOSTS_BEGIN = '# >>> Prism: zapret-discord-youtube'
export const HOSTS_END = '# <<< Prism: zapret-discord-youtube'

const hostsKey = (line: string): string => line.trim().split(/\s+/).join(' ').toLowerCase()
const hostsName = (line: string): string | undefined => line.trim().split(/\s+/)[1]?.toLowerCase()

/** Записи из файла hosts сборки — без пустых строк и комментариев */
export function hostsEntries(text: string): string[] {
  return listLines(text).filter((l) => /^\S+\s+\S+/.test(l))
}

/**
 * Для каких доменов Prism согласен править системный hosts — ровно то, что
 * обещает окно: Telegram, Discord и GitHub. Список приезжает с main-ветки
 * чужого репозитория, и без этой границы любой коммит туда увёл бы на свой
 * адрес что угодно, от банка до сервера обновлений, — у всех сразу.
 */
export const HOSTS_ALLOWED_DOMAINS = [
  'telegram.org',
  'telegram.me',
  'telegram.dog',
  'telegram.space',
  't.me',
  'telesco.pe',
  'tg.dev',
  'discord.com',
  'discord.gg',
  'discord.media',
  'discordapp.com',
  'discordapp.net',
  'github.com',
  'githubusercontent.com'
]

export function hostsAllowed(entry: string): boolean {
  const name = hostsName(entry)
  return !!name && HOSTS_ALLOWED_DOMAINS.some((d) => name === d || name.endsWith(`.${d}`))
}

/** Делит hosts на «свой блок» и всё остальное */
function splitHosts(current: string): { outside: string[]; block: string[] } {
  const lines = current.replace(/\r/g, '').split('\n')
  const outside: string[] = []
  const block: string[] = []
  let inside = false
  for (const l of lines) {
    if (l.trim() === HOSTS_BEGIN) inside = true
    else if (l.trim() === HOSTS_END) inside = false
    else (inside ? block : outside).push(l)
  }
  return { outside, block }
}

export function hostsStatus(current: string, entries: string[]) {
  const { outside, block } = splitHosts(current)
  const present = new Set(current.replace(/\r/g, '').split('\n').map(hostsKey))
  const names = new Set(entries.map(hostsName))
  const wanted = new Set(entries.map(hostsKey))
  const missing = entries.filter((e) => !present.has(hostsKey(e))).length
  const stale = outside.filter((l) => {
    const t = l.trim()
    return t && !t.startsWith('#') && names.has(hostsName(t)) && !wanted.has(hostsKey(t))
  }).length
  return { upToDate: missing === 0 && stale === 0, total: entries.length, missing, stale, managed: block.length > 0 }
}

/**
 * Новый hosts: свой блок заменяется целиком, а строки для тех же имён вне
 * блока убираются — это копии старой версии списка, вставленные руками.
 * Первое совпадение в hosts побеждает, так что без этого обновление не
 * подействовало бы. Остальные строки пользователя не трогаем.
 */
export function mergeHosts(current: string, entries: string[]): string {
  const names = new Set(entries.map(hostsName))
  const { outside } = splitHosts(current)
  const kept = outside.filter((l) => {
    const t = l.trim()
    return !t || t.startsWith('#') || !names.has(hostsName(t))
  })
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop()
  return [...kept, '', HOSTS_BEGIN, ...entries, HOSTS_END, ''].join('\r\n')
}

export function removeHostsBlock(current: string): string {
  const { outside } = splitHosts(current)
  while (outside.length && !outside[outside.length - 1].trim()) outside.pop()
  return [...outside, ''].join('\r\n')
}

/* ─────────────────────────── тесты ─────────────────────────── */

/** Цели обычного теста из utils/targets.txt: Имя = "https://…" или "PING:1.2.3.4" */
export function parseTargets(text: string): { name: string; url?: string; ping: string }[] {
  const out: { name: string; url?: string; ping: string }[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const m = line.match(/^\s*(\w+)\s*=\s*"(.+)"\s*$/)
    if (!m) continue
    const v = m[2].trim()
    if (/^PING:/i.test(v)) out.push({ name: m[1], ping: v.replace(/^PING:\s*/i, '') })
    else if (/^https?:\/\//i.test(v)) out.push({ name: m[1], url: v, ping: v.replace(/^https?:\/\//i, '').replace(/[/:].*$/, '') })
  }
  return out
}

export const DEFAULT_TARGETS = parseTargets(`
DiscordMain = "https://discord.com"
DiscordGateway = "https://gateway.discord.gg"
DiscordCDN = "https://cdn.discordapp.com"
DiscordUpdates = "https://updates.discord.com"
YouTubeWeb = "https://www.youtube.com"
YouTubeShort = "https://youtu.be"
YouTubeImage = "https://i.ytimg.com"
YouTubeVideoRedirect = "https://redirector.googlevideo.com"
GoogleMain = "https://www.google.com"
GoogleGstatic = "https://www.gstatic.com"
CloudflareWeb = "https://www.cloudflare.com"
CloudflareCDN = "https://cdnjs.cloudflare.com"
CloudflareDNS1111 = "PING:1.1.1.1"
CloudflareDNS1001 = "PING:1.0.0.1"
GoogleDNS8888 = "PING:8.8.8.8"
GoogleDNS8844 = "PING:8.8.4.4"
`)

/**
 * Лучшая стратегия — как в утилите сборки: больше всего успешных проверок,
 * при равенстве — больше ответивших пингов. Не поднявшиеся не участвуют.
 */
export function pickBest(results: ZapretStrategyResult[]): string | undefined {
  let best: ZapretStrategyResult | undefined
  for (const r of results) {
    if (!r.started || r.ok === 0) continue
    if (!best || r.ok > best.ok || (r.ok === best.ok && r.pingOk > best.pingOk)) best = r
  }
  return best?.strategy
}

/** Отчёт в том же виде, что пишет «test zapret.ps1» — чтобы им можно было делиться в обсуждениях сборки */
export function formatReport(kind: ZapretTestKind, results: ZapretStrategyResult[], best?: string): string {
  const lines: string[] = []
  for (const r of results) {
    lines.push(`Config: ${r.strategy}.bat (Type: ${kind})`)
    if (!r.started) lines.push('  strategy failed to start (winws process not found)')
    for (const t of r.targets) {
      const checks = t.checks.map((c) => `${c.label}:${c.status.toUpperCase()}${c.detail ? ` ${c.detail}` : ''}`).join(' ')
      lines.push(`  ${t.name} : ${checks}${t.ping !== undefined ? ` | Ping: ${t.ping}` : ''}`)
    }
    lines.push('')
  }
  lines.push('=== ANALYTICS ===')
  const w = Math.max(0, ...results.map((r) => r.strategy.length + 4))
  for (const r of results) {
    const name = `${r.strategy}.bat`.padEnd(w)
    lines.push(
      kind === 'standard'
        ? `${name} : HTTP OK: ${pad3(r.ok)}, ERR: ${pad3(r.error)}, UNSUP: ${pad3(r.unsup)}, Ping OK: ${pad3(r.pingOk)}, Fail: ${pad3(r.pingFail)}`
        : `${name} : OK: ${pad3(r.ok)}, FAIL: ${pad3(r.error)}, UNSUP: ${pad3(r.unsup)}, BLOCKED: ${pad3(r.blocked)}`
    )
  }
  lines.push(`Best strategy: ${best ? `${best}.bat` : '—'}`)
  return lines.join('\r\n')
}

const pad3 = (n: number): string => String(n).padStart(3)
