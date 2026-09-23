/* Инструменты вокруг zapret — то, что в сборке живёт в service.bat:
   диагностика, починка конфликтов, кэш Discord, файл hosts, сброс сети. */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ZapretCheck, ZapretHostsInfo } from '@shared/types'
import {
  ZAPRET_HOSTS_URL,
  ZAPRET_IPSET_URL,
  ZAPRET_REPO_URL,
  hostsAllowed,
  hostsEntries,
  hostsStatus,
  isIpLine,
  listLines,
  mergeHosts,
  removeHostsBlock
} from '@shared/zapret'
import { PS_UTF8, psUtf8 } from './win'
import { fetchBuffer } from './zapret-net'

const exec = promisify(execFile)
const run = (cmd: string, args: string[], timeout = 20000) => exec(cmd, args, { windowsHide: true, timeout })

/** Команды без проверки результата — как `>nul 2>&1` в bat */
async function quiet(cmd: string, args: string[]): Promise<boolean> {
  try {
    await run(cmd, args)
    return true
  } catch {
    return false
  }
}

/* Имена служб из PowerShell: одно имя приходит строкой, пустота — null или {}.
   В 1.6.0 пустой {} считался «нашлась одна служба», и диагностика показывала
   всем конфликт с Killer, Check Point и SmartByte, которых у них нет. */
const names = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string' && x !== '')

/* ─────────────────────────── диагностика ─────────────────────────── */

const DIAG_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$running = @(Get-Service | Where-Object { $_.Status -eq 'Running' })
function Find($re) { @($running | Where-Object { ($_.Name + ' ' + $_.DisplayName) -match $re } | ForEach-Object { [string]$_.Name }) }
$inet = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$doh = @(Get-ChildItem -Recurse -LiteralPath 'HKLM:\System\CurrentControlSet\Services\Dnscache\InterfaceSpecificParameters' | Get-ItemProperty | Where-Object { $_.DohFlags -gt 0 }).Count
$hosts = [string](Get-Content -LiteralPath "$env:SystemRoot\System32\drivers\etc\hosts" -Raw)
$wd = Get-CimInstance Win32_SystemDriver -Filter "Name='WinDivert'"
$facts = @{
  bfe = [string](Get-Service -Name BFE).Status
  proxyOn = [int]$inet.ProxyEnable
  proxyServer = [string]$inet.ProxyServer
  tcp = [string]((cmd /c 'chcp 437 >nul & netsh interface tcp show global') -join ' ')
  adguard = @(Get-Process -Name AdguardSvc).Count
  killer = @(Find 'Killer')
  intel = @($running | Where-Object { $n = $_.Name + ' ' + $_.DisplayName; $n -match 'Intel' -and $n -match 'Connectivity' -and $n -match 'Network' } | ForEach-Object { [string]$_.Name })
  checkpoint = @(Find 'TracSrvWrapper|EPWD')
  smartbyte = @(Find 'SmartByte')
  vpn = @(Find 'VPN')
  doh = $doh
  hostsYoutube = [bool]($hosts -match 'youtube\.com|youtu\.be')
  winws = @(Get-Process -Name winws).Count
  windivert = [string]$wd.State
  conflicts = @('GoodbyeDPI', 'discordfix_zapret', 'winws1', 'winws2' | Where-Object { Get-Service -Name $_ })
  onedrive = [string]$env:OneDrive
}
${PS_UTF8}
$facts | ConvertTo-Json -Depth 3 -Compress
`

interface DiagFacts {
  bfe: string
  proxyOn: number
  proxyServer: string
  tcp: string
  adguard: number
  killer: string[]
  intel: string[]
  checkpoint: string[]
  smartbyte: string[]
  vpn: string[]
  doh: number
  hostsYoutube: boolean
  winws: number
  windivert: string
  conflicts: string[]
  onedrive: string
}

const ISSUES = 'https://github.com/Flowseal/zapret-discord-youtube/issues'

export async function runDiagnostics(opts: { root: string; packDir?: string; localPort: number }): Promise<ZapretCheck[]> {
  const f = JSON.parse((await psUtf8(DIAG_SCRIPT, 60000)) || '{}') as DiagFacts
  const out: ZapretCheck[] = []
  const add = (c: ZapretCheck): void => void out.push(c)

  add(
    f.bfe === 'Running'
      ? { id: 'bfe', level: 'ok', title: 'Служба Base Filtering Engine работает' }
      : { id: 'bfe', level: 'error', title: 'Служба Base Filtering Engine не запущена', detail: 'Без неё zapret не работает. Включите её в services.msc.' }
  )

  if (f.proxyOn === 1 && f.proxyServer) {
    const ours = f.proxyServer.includes(`127.0.0.1:${opts.localPort}`)
    add(
      ours
        ? { id: 'proxy', level: 'ok', title: 'Системный прокси — это Prism', detail: f.proxyServer }
        : {
            id: 'proxy',
            level: 'warn',
            title: `Включён системный прокси: ${f.proxyServer}`,
            detail: 'Убедитесь, что он рабочий, или выключите его, если прокси вы не пользуетесь.'
          }
    )
  } else add({ id: 'proxy', level: 'ok', title: 'Системный прокси выключен' })

  const ts = f.tcp.match(/timestamps\s*:\s*(\w+)/i)?.[1]?.toLowerCase()
  add(
    ts === 'enabled'
      ? { id: 'tcp', level: 'ok', title: 'Отметки времени TCP включены' }
      : ts === 'disabled'
        ? {
            id: 'tcp',
            level: 'error',
            title: 'Отметки времени TCP выключены',
            detail: 'Стратегии с подделкой по отметкам времени (ts) без них не работают. Prism включает их при каждом запуске обхода.',
            fix: 'tcp-timestamps'
          }
        : { id: 'tcp', level: 'warn', title: 'Не удалось проверить отметки времени TCP' }
  )

  add(
    f.adguard
      ? { id: 'adguard', level: 'error', title: 'Запущен AdGuard', detail: 'Он может мешать Discord.', link: `${ISSUES}/417` }
      : { id: 'adguard', level: 'ok', title: 'AdGuard не мешает' }
  )

  const conflict = (id: string, names: string[], title: string, detail: string, link?: string): void =>
    add(names.length ? { id, level: 'error', title, detail: `${detail} Службы: ${names.join(', ')}.`, link } : { id, level: 'ok', title: `${title.replace(/ конфликту.*$/, '')} — не найдено` })

  conflict('killer', names(f.killer), 'Службы Killer конфликтуют с zapret', 'Отключите или удалите Killer Network.', `${ISSUES}/2512#issuecomment-2821119513`)
  conflict(
    'intel',
    names(f.intel),
    'Intel Connectivity Network Service конфликтует с zapret',
    'Отключите службу в services.msc.',
    'https://github.com/ValdikSS/GoodbyeDPI/issues/541#issuecomment-2661670982'
  )
  conflict('checkpoint', names(f.checkpoint), 'Службы Check Point конфликтуют с zapret', 'Попробуйте удалить Check Point.')
  conflict('smartbyte', names(f.smartbyte), 'SmartByte конфликтует с zapret', 'Удалите SmartByte или отключите его в services.msc.')

  if (/[а-яё]/i.test(opts.root)) {
    add({ id: 'path', level: 'warn', title: 'В пути к zapret есть кириллица', detail: opts.root })
  } else add({ id: 'path', level: 'ok', title: 'Путь к zapret без кириллицы', detail: opts.root })

  if (f.onedrive && opts.root.toLowerCase().startsWith(`${f.onedrive.toLowerCase()}\\`)) {
    add({ id: 'onedrive', level: 'error', title: 'Zapret лежит в папке OneDrive', detail: 'Синхронизация может ломать файлы сборки.' })
  }

  if (opts.packDir) {
    const missing = ['winws.exe', 'WinDivert.dll', 'WinDivert64.sys', 'cygwin1.dll'].filter((n) => !existsSync(join(opts.packDir!, 'bin', n)))
    add(
      missing.length
        ? {
            id: 'files',
            level: 'error',
            title: `Не хватает файлов сборки: ${missing.join(', ')}`,
            detail: 'Скорее всего, их убрал в карантин антивирус. Добавьте каталог zapret в исключения и переустановите сборку.'
          }
        : { id: 'files', level: 'ok', title: 'Файлы WinDivert и winws.exe на месте' }
    )
  }

  const vpn = names(f.vpn)
  add(
    vpn.length
      ? { id: 'vpn', level: 'warn', title: `Найдены службы VPN: ${vpn.join(', ')}`, detail: 'Некоторые VPN конфликтуют с zapret — на время проверки выключите их.' }
      : { id: 'vpn', level: 'ok', title: 'Сторонних VPN-служб нет' }
  )

  add(
    f.doh > 0
      ? { id: 'dns', level: 'ok', title: 'Безопасный DNS настроен' }
      : {
          id: 'dns',
          level: 'warn',
          title: 'Безопасный DNS не настроен в Windows',
          detail:
            'Включите DNS-over-HTTPS в браузере (провайдер не «по умолчанию») или в параметрах Windows 11 — иначе провайдер может подменять адреса.',
          link: `${ZAPRET_REPO_URL}#%EF%B8%8Fиспользование`
        }
  )

  if (f.hostsYoutube) {
    add({ id: 'hosts', level: 'warn', title: 'В hosts есть записи для youtube.com или youtu.be', detail: 'Они могут мешать YouTube.' })
  }

  if (f.winws === 0 && /Running|Stop Pending/i.test(f.windivert)) {
    add({
      id: 'windivert',
      level: 'warn',
      title: 'WinDivert загружен, хотя winws.exe не запущен',
      detail: 'Похоже, драйвер держит другой обход. Prism может выгрузить его.',
      fix: 'remove-windivert'
    })
  }

  const conflicts = names(f.conflicts)
  if (conflicts.length) {
    add({
      id: 'conflicts',
      level: 'error',
      title: `Найдены конфликтующие обходы: ${conflicts.join(', ')}`,
      detail: 'Два обхода на одном драйвере мешают друг другу.',
      fix: 'remove-conflicts'
    })
  }

  // Сначала ошибки, затем предупреждения — остальное внизу
  const rank = { error: 0, warn: 1, ok: 2 }
  return out.sort((a, b) => rank[a.level] - rank[b.level])
}

export async function enableTcpTimestamps(): Promise<void> {
  if (process.platform !== 'win32') return
  await quiet('netsh', ['interface', 'tcp', 'set', 'global', 'timestamps=enabled'])
}

const exists = async (name: string): Promise<boolean> => quiet('sc', ['query', name])

async function removeService(name: string): Promise<boolean> {
  await quiet('net', ['stop', name])
  await quiet('sc', ['delete', name])
  return !(await exists(name))
}

/** Починка из диагностики. Возвращает, что получилось — для уведомления */
export async function applyFix(fix: NonNullable<ZapretCheck['fix']>): Promise<string> {
  if (fix === 'tcp-timestamps') {
    await enableTcpTimestamps()
    return 'Отметки времени TCP включены'
  }
  if (fix === 'remove-windivert') {
    if (await removeService('WinDivert')) return 'WinDivert выгружен'
    // Удалить не вышло — его держит другой обход
    if (await exists('GoodbyeDPI')) {
      await removeService('GoodbyeDPI')
      if (await removeService('WinDivert')) return 'Удалён GoodbyeDPI, WinDivert выгружен'
    }
    throw new Error('WinDivert не выгружается — проверьте, какой ещё обход им пользуется')
  }
  const found: string[] = []
  for (const s of ['GoodbyeDPI', 'discordfix_zapret', 'winws1', 'winws2']) {
    if (await exists(s)) {
      await removeService(s)
      found.push(s)
    }
  }
  await removeService('WinDivert')
  await removeService('WinDivert14')
  return found.length ? `Удалены службы: ${found.join(', ')}` : 'Конфликтующих служб уже нет'
}

/* ─────────────────────────── Discord ─────────────────────────── */

const DISCORDS = [
  { exe: 'Discord.exe', name: 'Discord', dir: 'discord' },
  { exe: 'DiscordPTB.exe', name: 'Discord PTB', dir: 'discordptb' },
  { exe: 'DiscordCanary.exe', name: 'Discord Canary', dir: 'discordcanary' },
  { exe: 'DiscordDevelopment.exe', name: 'Discord Development', dir: 'discorddevelopment' }
]

/** Закрывает Discord и удаляет Cache, Code Cache и GPUCache — всех установленных версий */
export async function clearDiscordCache(): Promise<{ found: string[]; failed: string[] }> {
  const appdata = process.env.APPDATA
  const found: string[] = []
  const failed: string[] = []
  if (!appdata) return { found, failed }
  for (const d of DISCORDS) {
    const base = join(appdata, d.dir)
    if (!existsSync(base)) continue
    found.push(d.name)
    await quiet('taskkill', ['/IM', d.exe, '/F'])
    for (const sub of ['Cache', 'Code Cache', 'GPUCache']) {
      const p = join(base, sub)
      try {
        rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 })
      } catch {
        failed.push(p)
      }
    }
  }
  return { found, failed }
}

/* ─────────────────────────── сброс сети ─────────────────────────── */

/** «Ни одна стратегия не подходит» из README сборки. После него нужна перезагрузка */
export async function resetNetwork(): Promise<void> {
  await quiet('netsh', ['winsock', 'reset'])
  await quiet('netsh', ['int', 'ip', 'reset', 'all'])
  await quiet('netsh', ['winhttp', 'reset', 'proxy'])
  await quiet('ipconfig', ['/flushdns'])
}

/* ─────────────────────────── hosts ─────────────────────────── */

const HOSTS_FILE = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
let hostsCache: { at: number; entries: string[]; skipped: number } | null = null

async function remoteHosts(): Promise<{ entries: string[]; skipped: number }> {
  if (hostsCache && Date.now() - hostsCache.at < 5 * 60_000) return hostsCache
  const text = (await fetchBuffer(`${ZAPRET_HOSTS_URL}?t=${Date.now()}`, { maxBytes: 256 * 1024 })).toString('utf8')
  const all = hostsEntries(text)
  // В системный hosts уезжают только пары «адрес имя» — ничего похожего на что-то ещё
  if (!all.length || all.length > 1000 || all.some((l) => !/^[0-9a-f.:]+\s+[a-z0-9.\-]+$/i.test(l))) {
    throw new Error('Список hosts из репозитория выглядит странно — применять не буду')
  }
  // И только для своих доменов: чужие записи не пишем, но и всё остальное не бросаем
  const entries = all.filter(hostsAllowed)
  if (!entries.length) throw new Error('В списке hosts из репозитория нет записей для Telegram, Discord и GitHub — применять нечего')
  hostsCache = { at: Date.now(), entries, skipped: all.length - entries.length }
  return hostsCache
}

/* latin1 — чтобы байт в байт сохранить то, чего мы не понимаем: комментарии
   в hosts бывают в любой кодировке, а наши записи — чистый ASCII */
const readHosts = (): string => (existsSync(HOSTS_FILE) ? readFileSync(HOSTS_FILE, 'latin1') : '')

export async function hostsInfo(): Promise<ZapretHostsInfo> {
  const { entries, skipped } = await remoteHosts()
  return { ...hostsStatus(readHosts(), entries), entries, skipped }
}

function writeHosts(text: string): void {
  try {
    writeFileSync(HOSTS_FILE, text, 'latin1')
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES') {
      throw new Error('Файл hosts защищён от записи — нужны права администратора, или его охраняет антивирус')
    }
    throw e
  }
}

export async function hostsApply(): Promise<ZapretHostsInfo> {
  const { entries, skipped } = await remoteHosts()
  writeHosts(mergeHosts(readHosts(), entries))
  await quiet('ipconfig', ['/flushdns'])
  return { ...hostsStatus(readHosts(), entries), entries, skipped }
}

export async function hostsRemove(): Promise<ZapretHostsInfo> {
  writeHosts(removeHostsBlock(readHosts()))
  await quiet('ipconfig', ['/flushdns'])
  return hostsInfo()
}

/* ─────────────────────────── ipset ─────────────────────────── */

/** Свежий ipset-all.txt из репозитория сборки. Возвращает число подсетей */
export async function downloadIpset(dest: string): Promise<number> {
  const text = (await fetchBuffer(`${ZAPRET_IPSET_URL}?t=${Date.now()}`, { maxBytes: 16 * 1024 * 1024 })).toString('utf8')
  const lines = listLines(text)
  const valid = lines.filter(isIpLine)
  if (valid.length < 100 || valid.length < lines.length * 0.98) {
    throw new Error('Скачанный список адресов не похож на ipset — оставляю прежний')
  }
  const tmp = `${dest}.tmp`
  writeFileSync(tmp, `${valid.join('\r\n')}\r\n`, 'utf8')
  renameSync(tmp, dest)
  return valid.length
}
