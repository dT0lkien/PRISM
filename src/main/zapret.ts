/* Zapret: обход DPI без VPN на сборке Flowseal/zapret-discord-youtube.

   Что делает этот модуль вместо bat-файлов сборки:
   - ставит сборку с GitHub (со сверкой SHA-256) или из скачанного архива;
   - сам запускает winws.exe с аргументами стратегии, без cmd и консоли;
   - ставит и снимает службу Windows — так же, как service.bat;
   - раскладывает рабочие списки: встроенные, свои и ipset под режим;
   - гоняет тест стратегий и выбирает лучшую.

   Где лежит и почему. Всё в %ProgramData%\Prism\zapret, а не в каталоге
   приложения и не в профиле: служба работает от SYSTEM и должна пережить
   обновление Prism (запущенный winws.exe держит свои файлы, и установщик
   не смог бы их заменить), а в пути профиля бывает кириллица, на которой
   сборка, по её же README, спотыкается. Каталог закрыт на запись всем,
   кроме администраторов и SYSTEM: иначе любой процесс пользователя мог бы
   подменить winws.exe и получить права SYSTEM при следующем старте службы. */

import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'
import { promisify } from 'node:util'
import type {
  ZapretConfig,
  ZapretIpsetMode,
  ZapretPack,
  ZapretState,
  ZapretStrategyResult,
  ZapretTargetResult,
  ZapretTestKind,
  ZapretTestProgress,
  ZapretTestSummary
} from '@shared/types'
import {
  DEFAULT_TARGETS,
  DOMAIN_PLACEHOLDER,
  EXTRA_DOMAINS,
  IPSET_PLACEHOLDER,
  ZAPRET_DPI_SUITE_URL,
  ZAPRET_RELEASE_API,
  ZAPRET_REPO,
  compareStrategies,
  compareVersions,
  expandStrategy,
  formatReport,
  ipsetContent,
  listLines,
  packVersionFrom,
  parseStrategy,
  parseTargets,
  pickBest,
  strategyLabel,
  summarizeStrategy,
  toCommandLine
} from '@shared/zapret'
import { store } from './store'
import { IS_WIN, PS_UTF8, isElevated, psUtf8 } from './win'
import { unzip } from './unzip'
import { CHECKS, dpiCheck, fetchBuffer, httpCheck, ping, pool } from './zapret-net'
import { downloadIpset, enableTcpTimestamps } from './zapret-tools'

const exec = promisify(execFile)
const MAX_OUTPUT = 40

export const zapretPaths = {
  get root(): string {
    return IS_WIN
      ? join(process.env.ProgramData || 'C:\\ProgramData', 'Prism', 'zapret')
      : join(app.getPath('userData'), 'zapret')
  },
  get packs(): string {
    return join(this.root, 'packs')
  },
  /** Рабочие списки для запуска из Prism и для службы */
  get run(): string {
    return join(this.root, 'run')
  },
  /** Отдельные списки для теста — чтобы не трогать работающую службу */
  get test(): string {
    return join(this.root, 'test')
  },
  /** ipset, скачанный с GitHub, общий для всех сборок */
  get ipset(): string {
    return join(this.root, 'ipset-all.txt')
  },
  get reports(): string {
    return join(app.getPath('userData'), 'zapret-tests')
  }
}

/* ─────────────────────────── сборка ─────────────────────────── */

interface Pack extends ZapretPack {
  dir: string
  templates: Map<string, string[]>
}

const REQUIRED_BIN = ['winws.exe', 'WinDivert.dll', 'WinDivert64.sys', 'cygwin1.dll']
const REQUIRED_LISTS = ['list-general.txt', 'list-google.txt', 'list-exclude.txt', 'ipset-exclude.txt']

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex')
const read = (p: string): string => readFileSync(p, 'utf8')
const errText = (e: unknown): string => String((e as Error)?.message ?? e)
const toArr = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v == null ? [] : [v])

/** Читает и проверяет установленную сборку. Бросает, если чего-то не хватает */
function readPack(dir: string): Pack {
  const bin = join(dir, 'bin')
  for (const f of REQUIRED_BIN) {
    if (!existsSync(join(bin, f))) throw new Error(`В сборке нет bin\\${f} — возможно, его удалил антивирус`)
  }
  for (const f of REQUIRED_LISTS) {
    if (!existsSync(join(dir, 'lists', f))) throw new Error(`В сборке нет lists\\${f}`)
  }

  const templates = new Map<string, string[]>()
  for (const f of readdirSync(dir)) {
    if (!/^general.*\.bat$/i.test(f)) continue
    const args = parseStrategy(read(join(dir, f)))
    if (args?.length) templates.set(f.slice(0, -4), args)
  }
  if (!templates.size) throw new Error('В сборке не нашлось ни одной стратегии')

  const svc = join(dir, 'service.bat')
  const version = (existsSync(svc) && packVersionFrom(read(svc))) || basename(dir)

  /* Какой фейк сейчас «активный», сборка хранит копией файла — узнаём по содержимому */
  const byHash = new Map<string, string>()
  const fakes: string[] = []
  for (const f of readdirSync(bin)) {
    if (!/\.bin$/i.test(f) || /^ACTIVE_/i.test(f)) continue
    const name = f.slice(0, -4)
    fakes.push(name)
    byHash.set(sha256(readFileSync(join(bin, f))), name)
  }
  const activeOf = (f: string): string | undefined =>
    existsSync(join(bin, f)) ? byHash.get(sha256(readFileSync(join(bin, f)))) : undefined
  const count = (f: string): number => listLines(read(join(dir, 'lists', f))).length

  return {
    dir,
    version,
    templates,
    strategies: [...templates.keys()]
      .sort(compareStrategies)
      .map((id) => ({ id, label: strategyLabel(id), summary: summarizeStrategy(templates.get(id)!) })),
    fakes: fakes.sort(),
    defaultFakeDiscord: activeOf('ACTIVE_DISCORD_UDP.bin'),
    defaultFakeGame: activeOf('ACTIVE_GAME_UDP.bin'),
    lists: {
      general: count('list-general.txt'),
      google: count('list-google.txt'),
      exclude: count('list-exclude.txt'),
      ipsetExclude: count('ipset-exclude.txt'),
      ipset: 0
    }
  }
}

/**
 * Список для режима «по списку». Скачанный с GitHub главнее встроенного.
 * В самой сборке ipset-all.txt из коробки — заглушка, а настоящий список
 * лежит рядом в .backup: так service.bat переключает режимы.
 */
function loadedIpset(pack: Pack): string[] {
  if (existsSync(zapretPaths.ipset)) return listLines(read(zapretPaths.ipset))
  const main = join(pack.dir, 'lists', 'ipset-all.txt')
  const lines = existsSync(main) ? listLines(read(main)) : []
  if (lines.length && !lines.includes(IPSET_PLACEHOLDER)) return lines
  const backup = `${main}.backup`
  return existsSync(backup) ? listLines(read(backup)).filter((l) => l !== IPSET_PLACEHOLDER) : []
}

/** Почему Windows не дала запустить winws.exe — по-человечески */
function spawnMessage(e: NodeJS.ErrnoException): string {
  if (e.code === 'EPERM' || e.code === 'EACCES') {
    return 'Windows не даёт запустить winws.exe: нет доступа к файлу. Перезапустите Prism от администратора — права на каталог zapret починятся'
  }
  if (e.code === 'ENOENT') return 'winws.exe пропал из каталога сборки — скорее всего, его убрал антивирус. Переустановите сборку'
  return `winws.exe не запускается: ${errText(e)}`
}

/* ─────────────────────────── каталог ─────────────────────────── */

let rootSecured = false

/* Кому можно владеть каталогом Prism в ProgramData: администраторам и SYSTEM.
   ProgramData открыт обычным пользователям на создание каталогов, и раньше
   чужой заранее созданный «Prism» просто перехватывался: icacls забирал
   владение и переписывал права. Но перехват не отбирает дескрипторы, которые
   прежний хозяин успел открыть, а сам каталог Prism создавал с правами
   ProgramData — и до icacls в нём мог похозяйничать любой пользователь.
   Теперь чужой каталог отодвигается в сторону, а свой создаётся сразу с
   закрытыми правами: окна, в которое можно что-то подложить, нет. */
const BASE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$result = 'OK'
try {
  $p = $env:PRISM_ZAPRET_BASE
  # Путь Prism берёт из %ProgramData%, а её пользователь переопределит без прав
  # администратора — и служба SYSTEM запускала бы winws.exe из его каталога.
  # Системный каталог Windows от переменных окружения не зависит.
  $expected = Join-Path ([IO.Path]::GetPathRoot([Environment]::SystemDirectory)) 'ProgramData\Prism'
  if ($p -ne $expected) { throw ('ожидался ' + $expected + ', а переменная ProgramData ведёт в ' + $p) }
  $trusted = @('S-1-5-32-544', 'S-1-5-18')
  # Через .NET, а не Get-Acl: командлетам нужен модуль, а его автозагрузка
  # ломается, когда powershell.exe запущен из-под PowerShell 7
  function Owner {
    try {
      $sections = [Security.AccessControl.AccessControlSections]::Owner
      [IO.Directory]::GetAccessControl($p, $sections).GetOwner([Security.Principal.SecurityIdentifier]).Value
    } catch { 'не прочитать: ' + $_.Exception.Message }
  }
  if (Test-Path -LiteralPath $p) {
    $link = (Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint
    if ($link -or $trusted -notcontains (Owner)) {
      Rename-Item -LiteralPath $p -NewName ('Prism.untrusted-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    }
  }
  if (-not (Test-Path -LiteralPath $p)) {
    $sd = New-Object Security.AccessControl.DirectorySecurity
    $sd.SetAccessRuleProtection($true, $false)
    $sd.SetOwner([Security.Principal.SecurityIdentifier]'S-1-5-32-544')
    foreach ($r in @(@('S-1-5-32-544', 'FullControl'), @('S-1-5-18', 'FullControl'), @('S-1-5-32-545', 'ReadAndExecute'))) {
      $sd.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(([Security.Principal.SecurityIdentifier]$r[0]), $r[1], 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    [void][IO.Directory]::CreateDirectory($p, $sd)
  }
  # Кто-то успел создать каталог между проверкой и созданием — не принимаем
  if ($trusted -notcontains (Owner)) { throw ('владелец каталога — не администраторы: ' + (Owner)) }
} catch {
  $result = 'ERR:' + $_.Exception.Message
}
${PS_UTF8}
Write-Output $result
`

/**
 * Создаёт корень и закрывает его на запись. Каталог в ProgramData должен
 * принадлежать администраторам или SYSTEM (см. BASE_SCRIPT), а ссылки на
 * другие каталоги не принимаем вовсе.
 */
async function ensureRoot(): Promise<void> {
  const root = zapretPaths.root
  const base = IS_WIN ? dirname(root) : root
  const noLinks = (): void => {
    for (const p of [base, root, join(root, 'packs')]) {
      if (existsSync(p) && lstatSync(p).isSymbolicLink()) {
        throw new Error(`${p} — ссылка на другой каталог, пользоваться им небезопасно`)
      }
    }
  }
  if (IS_WIN && !rootSecured) {
    const out = (await psUtf8(BASE_SCRIPT, 60000, { PRISM_ZAPRET_BASE: base })).trim()
    if (out !== 'OK') throw new Error(`Каталог ${base} небезопасен, zapret им не пользуется: ${out.replace(/^ERR:/, '')}`)
  }
  noLinks()
  mkdirSync(join(root, 'packs'), { recursive: true })
  noLinks()
  if (!IS_WIN || rootSecured) return
  const icacls = (target: string, args: string[]) => exec('icacls', [target, ...args], { windowsHide: true, timeout: 60000 })
  try {
    // Владелец — для всего дерева: чужой владелец файла может переписать его права
    await icacls(base, ['/setowner', '*S-1-5-32-544', '/T', '/C', '/Q'])
    /* Права ставим только корню, без /T. В 1.6.0 здесь был /T, и это ломало
       всё: на файлах icacls снимает унаследованные записи, а разрешения с
       флагами наследования (OI)(CI) молча не выдаёт — и отвечает «успешно».
       Файлы оставались с пустым списком доступа, winws.exe не запускался
       даже от администратора (spawn EPERM). */
    await icacls(base, ['/inheritance:r', '/grant:r', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-545:(OI)(CI)RX', '/C', '/Q'])
    // Всё внутри — к правам, унаследованным от корня. Заодно чинит установки, сломанные 1.6.0
    await icacls(join(base, '*'), ['/reset', '/T', '/C', '/Q'])
    rootSecured = true
  } catch (e) {
    throw new Error(`Не удалось закрыть каталог zapret от записи: ${errText(e)}`)
  }
}

/* ─────────────────────────── служба ─────────────────────────── */

const STATUS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$s = Get-CimInstance Win32_Service -Filter "Name='zapret'"
$d = @(Get-CimInstance Win32_SystemDriver -Filter "Name='WinDivert' OR Name='WinDivert14'")
$k = (Get-ItemProperty -LiteralPath 'HKLM:\System\CurrentControlSet\Services\zapret' -Name 'zapret-discord-youtube').'zapret-discord-youtube'
$facts = @{
  service = $(if ($s) { @{ state = [string]$s.State; path = [string]$s.PathName; pid = [int]$s.ProcessId } } else { $null })
  strategy = [string]$k
  drivers = @($d | ForEach-Object { @{ name = [string]$_.Name; state = [string]$_.State } })
  winws = @(Get-CimInstance Win32_Process -Filter "Name='winws.exe'" | ForEach-Object { @{ pid = [int]$_.ProcessId; path = [string]$_.ExecutablePath } })
}
${PS_UTF8}
$facts | ConvertTo-Json -Depth 4 -Compress
`

interface StatusFacts {
  service: { state: string; path: string; pid: number } | null
  strategy: string
  drivers: { name: string; state: string }[] | { name: string; state: string }
  winws: { pid: number; path: string }[] | { pid: number; path: string }
}

const q = (s: string): string => s.replace(/'/g, "''")

/* Та же последовательность, что в service.bat, плюс ожидание: удалённая служба
   исчезает не сразу, и New-Service падал бы с «помечена для удаления».
   Командная строка службы и имя стратегии приходят переменными окружения:
   строка длиной в несколько килобайт, и вставлять её в текст скрипта —
   значит упираться в предел длины команды и думать о кавычках. */
const INSTALL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$result = 'OK'
try {
  if (Get-Service -Name zapret -ErrorAction SilentlyContinue) {
    Stop-Service -Name zapret -Force -ErrorAction SilentlyContinue
    & sc.exe delete zapret | Out-Null
    for ($i = 0; $i -lt 60 -and (Get-Service -Name zapret -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 100 }
    if (Get-Service -Name zapret -ErrorAction SilentlyContinue) { throw 'STUCK' }
  }
  New-Service -Name zapret -BinaryPathName $env:PRISM_ZAPRET_BIN -DisplayName 'zapret' -Description 'Zapret DPI bypass software' -StartupType Automatic | Out-Null
  New-ItemProperty -LiteralPath 'HKLM:\System\CurrentControlSet\Services\zapret' -Name 'zapret-discord-youtube' -Value $env:PRISM_ZAPRET_STRATEGY -PropertyType String -Force | Out-Null
  Start-Service -Name zapret
} catch {
  $result = 'ERR:' + $_.Exception.Message
}
${PS_UTF8}
Write-Output $result
`

const REMOVE_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
if (Get-Service -Name zapret) { Stop-Service -Name zapret -Force; & sc.exe delete zapret | Out-Null }
Get-Process -Name winws | Stop-Process -Force
foreach ($n in 'WinDivert', 'WinDivert14') { & sc.exe stop $n | Out-Null; & sc.exe delete $n | Out-Null }
`

/* ─────────────────────────── менеджер ─────────────────────────── */

type StartResult = { ok: boolean; error?: string; needElevation?: boolean }

export class Zapret extends EventEmitter {
  private pack: Pack | null = null
  private proc: ChildProcess | null = null
  private stopping = false
  private servicePid: number | undefined
  /** Командная строка службы — по ней видно, какую сборку она держит */
  private servicePath = ''
  private applyTimer: NodeJS.Timeout | null = null
  private notifiedVersion = ''
  private ipsetCount = { key: '', n: 0 }

  private test: ZapretTestProgress | null = null
  private testProc: ChildProcess | null = null
  private testCancel = false

  private state: ZapretState = {
    supported: IS_WIN,
    elevated: false,
    root: '',
    status: 'stopped',
    output: [],
    service: { installed: false },
    foreignWinws: 0,
    update: {}
  }

  get pid(): number | undefined {
    return this.proc?.pid
  }

  getState(): ZapretState {
    return {
      ...this.state,
      root: zapretPaths.root,
      pack: this.publicPack(),
      lastTest: store.get().zapretLastTest
    }
  }

  getTest(): ZapretTestProgress | null {
    return this.test
  }

  private publicPack(): ZapretPack | undefined {
    const p = this.pack
    if (!p) return undefined
    const src = existsSync(zapretPaths.ipset) ? zapretPaths.ipset : p.dir
    const key = `${src}:${existsSync(src) ? statSync(src).mtimeMs : 0}`
    if (this.ipsetCount.key !== key) this.ipsetCount = { key, n: loadedIpset(p).length }
    const { dir: _dir, templates: _t, ...pub } = p
    return {
      ...pub,
      lists: { ...pub.lists, ipset: this.ipsetCount.n },
      ipsetUpdatedAt: existsSync(zapretPaths.ipset) ? statSync(zapretPaths.ipset).mtimeMs : undefined
    }
  }

  private setState(p: Partial<ZapretState>): void {
    this.state = { ...this.state, ...p }
    this.emitState()
  }

  private emitState(): void {
    this.emit('state', this.getState())
  }

  private log(message: string, level = 'info'): void {
    this.emit('log', { level, message, source: 'zapret' })
  }

  /* ─── жизненный цикл ─── */

  async init(): Promise<void> {
    if (IS_WIN && existsSync(zapretPaths.root) && (await isElevated())) {
      /* Сразу, до чтения сборки: у установок, сломанных 1.6.0, файлы без прав
         на чтение, и без этого сборка выглядела бы неустановленной */
      await ensureRoot().catch((e) => this.log(errText(e), 'warn'))
    }
    this.loadPack()
    if (!IS_WIN) return this.emitState()
    await this.refresh()
    if (this.state.elevated) await this.killStrays().catch(() => undefined)

    const cfg = store.get().zapret
    const serviceUp = /running|start pending/i.test(this.state.service.state ?? '')
    if (cfg.autoStart && this.pack && !serviceUp) {
      if (this.state.elevated) setTimeout(() => void this.start(), 1500)
      else {
        const text = 'Zapret не запущен: для обхода Prism нужно открыть от администратора'
        setTimeout(() => this.emit('toast', { kind: 'warn', text }), 3500)
      }
    }

    const tick = (): void => {
      if (store.get().zapret.checkUpdates && this.pack) void this.checkUpdate(true)
    }
    setTimeout(tick, 25_000)
    setInterval(tick, 12 * 3600_000)
  }

  private loadPack(): void {
    const want = store.get().zapretPack
    const dirs = existsSync(zapretPaths.packs)
      ? readdirSync(zapretPaths.packs)
          .filter((d) => !d.startsWith('.'))
          .sort(compareVersions)
          .reverse()
      : []
    const order = want && dirs.includes(want) ? [want, ...dirs.filter((d) => d !== want)] : dirs
    for (const d of order) {
      try {
        this.pack = readPack(join(zapretPaths.packs, d))
        if (d !== want) store.patch({ zapretPack: d })
        return
      } catch (e) {
        this.log(`Сборка ${d} не читается: ${errText(e)}`, 'warn')
      }
    }
    this.pack = null
  }

  /** Состояние службы, драйвера и процессов winws.exe */
  async refresh(): Promise<ZapretState> {
    if (!IS_WIN) {
      this.emitState()
      return this.getState()
    }
    this.state.elevated = await isElevated()
    try {
      const f = JSON.parse((await psUtf8(STATUS_SCRIPT, 30000)) || '{}') as StatusFacts
      const root = zapretPaths.root.toLowerCase()
      this.servicePid = f.service?.pid || undefined
      this.servicePath = f.service?.path.toLowerCase() ?? ''
      this.state.service = f.service
        ? {
            installed: true,
            state: f.service.state,
            strategy: f.strategy || undefined,
            foreign: !f.service.path.toLowerCase().includes(root)
          }
        : { installed: false }
      this.state.windivert = toArr(f.drivers).find((d) => d.state)?.state
      this.state.foreignWinws = toArr(f.winws).filter(
        (p) =>
          p.pid !== this.proc?.pid &&
          p.pid !== this.testProc?.pid &&
          p.pid !== this.servicePid &&
          !(p.path && p.path.toLowerCase().startsWith(root))
      ).length
    } catch (e) {
      this.log(`Не удалось узнать состояние службы: ${errText(e)}`, 'warn')
    }
    this.emitState()
    return this.getState()
  }

  private async guard(): Promise<Pack> {
    if (!IS_WIN) throw new Error('Zapret работает только в Windows')
    if (!(await isElevated())) throw new Error('Нужны права администратора — перезапустите Prism от администратора')
    if (!this.pack) throw new Error('Сборка zapret не установлена')
    return this.pack
  }

  /* ─── рабочие списки и аргументы ─── */

  /** Раскладывает списки, которые читает winws: встроенные, свои и ipset под режим */
  private materialize(dir: string, pack: Pack, cfg: ZapretConfig, ipsetMode: ZapretIpsetMode = cfg.ipsetMode): void {
    mkdirSync(dir, { recursive: true })
    const write = (name: string, lines: string[]): void =>
      writeFileSync(join(dir, name), lines.length ? `${lines.join('\r\n')}\r\n` : '', 'utf8')
    for (const f of REQUIRED_LISTS) copyFileSync(join(pack.dir, 'lists', f), join(dir, f))
    // Пустой hostlist winws считает «подходит любой домен» — поэтому заглушки, как в сборке
    const l = cfg.lists
    /* Домены Prism кладём в тот же файл, что и свои: список выбирается
       аргументами стратегии, а их мы не трогаем — файлы сборки те же */
    const general = [...(cfg.extraDomains ? EXTRA_DOMAINS : []), ...l.general]
    write('list-general-user.txt', general.length ? general : ['# Never leave this file empty', DOMAIN_PLACEHOLDER])
    write('list-exclude-user.txt', l.exclude.length ? l.exclude : [DOMAIN_PLACEHOLDER])
    write('ipset-exclude-user.txt', l.ipsetExclude.length ? l.ipsetExclude : [IPSET_PLACEHOLDER])
    write('ipset-all.txt', ipsetContent(ipsetMode, ipsetMode === 'loaded' ? loadedIpset(pack) : [], l.ipset))
  }

  private args(pack: Pack, id: string, cfg: ZapretConfig, listsDir: string): string[] {
    const tpl = pack.templates.get(id)
    if (!tpl) throw new Error(`В сборке ${pack.version} нет стратегии «${strategyLabel(id)}»`)
    return expandStrategy(tpl, {
      bin: join(pack.dir, 'bin') + sep,
      lists: listsDir + sep,
      gameFilter: cfg.gameFilter,
      fakeDiscord: pack.fakes.includes(cfg.fakeDiscord) ? cfg.fakeDiscord : '',
      fakeGame: pack.fakes.includes(cfg.fakeGame) ? cfg.fakeGame : ''
    })
  }

  private spawnWinws(pack: Pack, args: string[], piped: boolean): ChildProcess {
    const bin = join(pack.dir, 'bin')
    let p: ChildProcess
    try {
      p = spawn(join(bin, 'winws.exe'), args, {
        cwd: bin,
        windowsHide: true,
        stdio: piped ? ['ignore', 'pipe', 'pipe'] : 'ignore'
      })
    } catch (e) {
      // EPERM и часть других ошибок Node бросает прямо из spawn, а не событием
      throw new Error(spawnMessage(e as NodeJS.ErrnoException))
    }
    // Без обработчика ошибка запуска (файл съел антивирус) уронила бы main-процесс
    p.on('error', (e) => this.log(`winws.exe не запускается: ${errText(e)}`, 'error'))
    return p
  }

  /** Жив ли процесс спустя ms — winws падает сразу, если драйвер не загрузился или аргумент кривой */
  private waitAlive(p: ChildProcess, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (p.exitCode !== null) return resolve(false)
      const t = setTimeout(() => resolve(true), ms)
      p.once('exit', () => {
        clearTimeout(t)
        resolve(false)
      })
      p.once('error', () => {
        clearTimeout(t)
        resolve(false)
      })
    })
  }

  private async killProc(p: ChildProcess): Promise<void> {
    if (p.exitCode !== null || p.signalCode !== null) return
    await new Promise<void>((resolve) => {
      const t = setTimeout(async () => {
        if (p.pid) await exec('taskkill', ['/PID', String(p.pid), '/F'], { windowsHide: true }).catch(() => undefined)
        resolve()
      }, 3000)
      p.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
      try {
        p.kill()
      } catch {
        /* уже завершился */
      }
    })
  }

  /** Хвосты после падения Prism: наши winws.exe без родителя. Службу не трогаем */
  private async killStrays(): Promise<void> {
    if (!IS_WIN) return
    const keep = [this.servicePid, this.proc?.pid, this.testProc?.pid].filter(Boolean).join(',') || '0'
    await psUtf8(
      `Get-CimInstance Win32_Process -Filter "Name='winws.exe'" | Where-Object { $_.ExecutablePath -like '${q(zapretPaths.root)}\\*' -and @(${keep}) -notcontains $_.ProcessId } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
    )
  }

  /* ─── запуск из Prism ─── */

  /* Два запуска подряд (кнопка и переключатель на главной) не должны поднять два winws.exe */
  private starting: Promise<StartResult> | null = null

  start(strategy?: string): Promise<StartResult> {
    if (this.starting) return this.starting
    this.starting = this.doStart(strategy).finally(() => (this.starting = null))
    return this.starting
  }

  private async doStart(strategy?: string): Promise<StartResult> {
    if (!IS_WIN) return { ok: false, error: 'Zapret работает только в Windows' }
    if (this.proc) return { ok: true }
    if (this.test?.running) return { ok: false, error: 'Идёт тест стратегий — дождитесь конца' }
    if (!(await isElevated())) return { ok: false, needElevation: true, error: 'Для обхода нужны права администратора' }
    const pack = this.pack
    if (!pack) return { ok: false, error: 'Сборка zapret не установлена' }

    const cfg = store.get().zapret
    const id = strategy ?? cfg.strategy
    await this.refresh()
    if (/running|start pending/i.test(this.state.service.state ?? '')) {
      return { ok: false, error: 'Обход уже работает как служба Windows. Чтобы запускать его из Prism, удалите службу.' }
    }
    if (this.state.foreignWinws) {
      return { ok: false, error: 'Уже запущен другой winws.exe — два обхода мешают друг другу. Остановите его и попробуйте снова.' }
    }

    this.setState({ status: 'starting', error: undefined, output: [] })
    try {
      await ensureRoot()
      await this.killStrays()
      await enableTcpTimestamps()
      this.materialize(zapretPaths.run, pack, cfg)
      const args = this.args(pack, id, cfg, zapretPaths.run)

      const p = this.spawnWinws(pack, args, true)
      let spawnError: NodeJS.ErrnoException | undefined
      p.once('error', (e) => (spawnError = e))
      this.proc = p
      const onData = (b: Buffer): void => {
        const lines = b.toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        if (!lines.length) return
        for (const l of lines) this.log(l, /error|fail|cannot|could not/i.test(l) ? 'error' : 'info')
        this.state.output = [...this.state.output, ...lines].slice(-MAX_OUTPUT)
        this.emitState()
      }
      p.stdout?.on('data', onData)
      p.stderr?.on('data', onData)
      p.on('exit', (code) => {
        if (this.proc !== p) return
        this.proc = null
        if (this.stopping) return
        const last = this.state.output[this.state.output.length - 1]
        this.log(`winws.exe завершился (код ${code ?? '?'})`, 'error')
        this.setState({
          status: 'error',
          running: undefined,
          since: undefined,
          error: last ? `winws.exe остановился: ${last}` : `winws.exe остановился (код ${code ?? '?'})`
        })
      })

      if (!(await this.waitAlive(p, 1500))) {
        this.proc = null
        if (spawnError) throw new Error(spawnMessage(spawnError))
        const out = this.state.output
        const last = out.filter((l) => /error|fail|cannot|could not/i.test(l)).at(-1) ?? out.at(-1)
        throw new Error(last ? `winws.exe не запустился: ${last}` : 'winws.exe завершился сразу после запуска')
      }
      this.setState({ status: 'running', running: id, since: Date.now(), error: undefined })
      this.log(`Обход запущен, стратегия ${strategyLabel(id)}`)
      return { ok: true }
    } catch (e) {
      const error = errText(e)
      this.setState({ status: 'error', running: undefined, since: undefined, error })
      return { ok: false, error }
    }
  }

  async stop(silent = false): Promise<void> {
    const p = this.proc
    if (!p) {
      if (this.state.status !== 'stopped') this.setState({ status: 'stopped', error: undefined, running: undefined })
      return
    }
    this.stopping = true
    this.proc = null
    await this.killProc(p)
    this.stopping = false
    this.setState({ status: 'stopped', running: undefined, since: undefined, error: undefined })
    if (!silent) this.log('Обход остановлен')
  }

  async restart(): Promise<StartResult> {
    await this.stop(true)
    return this.start()
  }

  /** Остановить winws.exe, запущенные не Prism */
  async killForeign(): Promise<void> {
    await this.guard()
    await this.refresh()
    const keep = [this.servicePid, this.proc?.pid].filter(Boolean).join(',') || '0'
    await psUtf8(
      `Get-CimInstance Win32_Process -Filter "Name='winws.exe'" | Where-Object { @(${keep}) -notcontains $_.ProcessId -and -not ($_.ExecutablePath -like '${q(zapretPaths.root)}\\*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
    )
    await this.refresh()
  }

  /* ─── служба Windows ─── */

  async installService(strategy?: string): Promise<void> {
    const pack = await this.guard()
    if (this.test?.running) throw new Error('Идёт тест стратегий — дождитесь конца')
    const cfg = store.get().zapret
    const id = strategy ?? cfg.strategy
    await this.stop(true)
    await ensureRoot()
    await this.killStrays()
    await enableTcpTimestamps()
    this.materialize(zapretPaths.run, pack, cfg)
    const args = this.args(pack, id, cfg, zapretPaths.run)
    const binPath = `"${join(pack.dir, 'bin', 'winws.exe')}" ${toCommandLine(args)}`
    const out = (await psUtf8(INSTALL_SCRIPT, 90000, { PRISM_ZAPRET_BIN: binPath, PRISM_ZAPRET_STRATEGY: id })).trim()
    if (out === 'ERR:STUCK') throw new Error('Старая служба zapret не удаляется — закройте окно «Службы» и попробуйте снова')
    if (out.startsWith('ERR:')) throw new Error(`Не удалось установить службу: ${out.slice(4)}`)
    await this.refresh()
    if (!/running/i.test(this.state.service.state ?? '')) {
      throw new Error('Служба создана, но не запустилась — загляните в диагностику')
    }
    this.log(`Установлена служба zapret, стратегия ${strategyLabel(id)}`)
  }

  /** Как «Remove Services» в service.bat: служба, все winws.exe и драйвер WinDivert */
  async removeService(): Promise<void> {
    if (!IS_WIN) throw new Error('Zapret работает только в Windows')
    if (!(await isElevated())) throw new Error('Нужны права администратора')
    if (this.test?.running) throw new Error('Идёт тест стратегий — дождитесь конца')
    await this.stop(true)
    await psUtf8(REMOVE_SCRIPT, 60000)
    await this.refresh()
    this.log('Служба zapret и драйвер WinDivert удалены')
  }

  /* ─── настройки ─── */

  /** Настройки поменялись — перезапускаем то, что работает. С задержкой, чтобы не дёргать на каждый клик */
  scheduleApply(): void {
    if (this.applyTimer) clearTimeout(this.applyTimer)
    this.applyTimer = setTimeout(() => {
      this.applyTimer = null
      void this.applyNow()
    }, 700)
  }

  private async applyNow(): Promise<void> {
    try {
      if (this.proc) {
        const r = await this.restart()
        if (!r.ok) this.emit('toast', { kind: 'error', text: r.error ?? 'Обход не перезапустился' })
      } else if (this.state.service.installed && !this.state.service.foreign) {
        await this.installService()
        this.emit('toast', { kind: 'ok', text: 'Служба zapret перезапущена с новыми настройками' })
      }
    } catch (e) {
      this.emit('toast', { kind: 'error', text: errText(e) })
    }
  }

  /* ─── установка и обновление сборки ─── */

  private inUse(dir: string): boolean {
    const d = dir.toLowerCase()
    return (!!this.proc && this.pack?.dir.toLowerCase() === d) || (!!this.servicePath && this.servicePath.includes(`${d}\\`))
  }

  /**
   * Ставит сборку из zip. Из архива берутся только нужные файлы с безопасными
   * именами — никаких «..» и вложенных путей, которые могли бы увести запись
   * за пределы каталога.
   */
  private async installZip(buf: Buffer, digest?: string): Promise<string> {
    if (digest && sha256(buf) !== digest.toLowerCase()) {
      throw new Error('Контрольная сумма архива не совпала с опубликованной на GitHub — установка отменена')
    }
    const files = unzip(buf)
    const names = [...files.keys()]
    const top = names[0]?.split('/')[0]
    const prefix = top && names.every((n) => n.startsWith(`${top}/`)) ? `${top}/` : ''

    const SEG = /^[\w .()+\-]+$/
    const picked = new Map<string, Buffer>()
    for (const [name, data] of files) {
      const rel = name.slice(prefix.length)
      const parts = rel.split('/')
      if (parts.some((p) => !SEG.test(p) || p === '.' || p === '..')) continue
      const wanted =
        (parts.length === 1 && /^(general.*|service)\.bat$/i.test(rel)) ||
        (parts.length === 2 && /^(bin|lists)$/i.test(parts[0])) ||
        /^utils\/targets\.txt$/i.test(rel)
      if (wanted) picked.set(parts.map((p, i) => (i === 0 && parts.length === 2 ? p.toLowerCase() : p)).join('/'), data)
    }

    const version = packVersionFrom(picked.get('service.bat')?.toString('utf8') ?? '')
    if (!version || !/^[\w.\-]{1,32}$/.test(version)) {
      throw new Error('Не удалось определить версию сборки — это точно архив zapret-discord-youtube?')
    }

    await ensureRoot()
    const tmp = join(zapretPaths.packs, `.tmp-${randomBytes(4).toString('hex')}`)
    try {
      for (const [rel, data] of picked) {
        const p = join(tmp, ...rel.split('/'))
        mkdirSync(dirname(p), { recursive: true })
        writeFileSync(p, data)
      }
      readPack(tmp)
      const target = join(zapretPaths.packs, version)
      if (existsSync(target)) {
        if (this.inUse(target)) throw new Error(`Сборка ${version} уже установлена и сейчас работает`)
        rmSync(target, { recursive: true, force: true })
      }
      renameSync(tmp, target)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
    this.log(`Установлена сборка zapret-discord-youtube ${version}`)
    return version
  }

  /** Переключиться на установленную сборку и перезапустить то, что работало на старой */
  private async activate(version: string): Promise<void> {
    const wasRunning = !!this.proc
    const hadService = this.state.service.installed && !this.state.service.foreign
    if (wasRunning) await this.stop(true)
    store.patch({ zapretPack: version })
    this.loadPack()
    const cfg = store.get().zapret
    if (this.pack && !this.pack.templates.has(cfg.strategy)) {
      store.patch({ zapret: { ...cfg, strategy: this.pack.strategies[0].id } })
    }
    this.emit('snapshot')
    if (wasRunning) await this.start()
    else if (hadService) await this.installService()
    this.cleanupPacks()
    this.emitState()
  }

  /** Старые сборки больше не нужны — удаляем всё, чем никто не пользуется */
  private cleanupPacks(): void {
    if (!this.pack || !existsSync(zapretPaths.packs)) return
    for (const d of readdirSync(zapretPaths.packs)) {
      const dir = join(zapretPaths.packs, d)
      if (dir === this.pack.dir || this.inUse(dir)) continue
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* занято — уберём в следующий раз */
      }
    }
  }

  private async latestRelease(): Promise<{ version: string; url: string; digest: string }> {
    const j = JSON.parse(
      (await fetchBuffer(ZAPRET_RELEASE_API, { timeoutMs: 15000, maxBytes: 1024 * 1024, headers: { accept: 'application/vnd.github+json' } })).toString('utf8')
    )
    const version = String(j.tag_name ?? '').replace(/^v/i, '')
    const asset = toArr(j.assets).find((a: { name?: string }) => /\.zip$/i.test(a?.name ?? '')) as
      | { browser_download_url?: string; digest?: string }
      | undefined
    if (!version || !asset) throw new Error('В последнем релизе сборки нет zip-архива')
    const url = String(asset.browser_download_url ?? '')
    if (!url.startsWith(`https://github.com/${ZAPRET_REPO}/releases/download/`)) throw new Error('Неожиданный адрес архива сборки')
    const digest = String(asset.digest ?? '').match(/^sha256:([0-9a-f]{64})$/i)?.[1]
    if (!digest) throw new Error('GitHub не сообщил контрольную сумму архива — скачайте его сами и установите из файла')
    return { version, url, digest }
  }

  async checkUpdate(silent = false): Promise<ZapretState> {
    this.setState({ update: { ...this.state.update, checking: true, error: undefined } })
    try {
      const rel = await this.latestRelease()
      this.setState({ update: { latest: rel.version, checkedAt: Date.now() } })
      const newer = this.pack && compareVersions(rel.version, this.pack.version) > 0
      if (newer && silent && this.notifiedVersion !== rel.version) {
        this.notifiedVersion = rel.version
        this.emit('toast', { kind: 'ok', text: `Вышла сборка стратегий zapret ${rel.version} — обновить можно на вкладке «Zapret»` })
      }
    } catch (e) {
      this.setState({ update: { ...this.state.update, checking: false, checkedAt: Date.now(), error: errText(e) } })
    }
    return this.getState()
  }

  /** Скачать последнюю сборку с GitHub, сверить SHA-256 и поставить */
  async installLatest(): Promise<void> {
    if (!IS_WIN) throw new Error('Zapret работает только в Windows')
    if (!(await isElevated())) throw new Error('Нужны права администратора — перезапустите Prism от администратора')
    this.setState({ update: { ...this.state.update, installing: true, error: undefined } })
    try {
      const rel = await this.latestRelease()
      const buf = await fetchBuffer(rel.url, { timeoutMs: 180_000, maxBytes: 64 * 1024 * 1024 })
      const version = await this.installZip(buf, rel.digest)
      this.state.update = { latest: rel.version, checkedAt: Date.now() }
      await this.activate(version)
    } catch (e) {
      this.setState({ update: { ...this.state.update, installing: false, error: errText(e) } })
      throw e
    }
  }

  /** Архив, который пользователь скачал сам — когда GitHub недоступен */
  async installFromFile(file: string): Promise<string> {
    if (IS_WIN && !(await isElevated())) throw new Error('Нужны права администратора — перезапустите Prism от администратора')
    const version = await this.installZip(readFileSync(file))
    await this.activate(version)
    return version
  }

  async updateIpset(): Promise<number> {
    await this.guard()
    await ensureRoot()
    const n = await downloadIpset(zapretPaths.ipset)
    this.log(`Список IPSet обновлён: ${n} подсетей`)
    if (store.get().zapret.ipsetMode === 'loaded') this.scheduleApply()
    this.emitState()
    return n
  }

  /** Встроенный список для просмотра. Большой ipset обрезаем — показать 30 тысяч строк нечем */
  readList(name: 'general' | 'google' | 'exclude' | 'ipsetExclude' | 'ipset' | 'extra'): { lines: string[]; total: number } {
    if (name === 'extra') return { lines: EXTRA_DOMAINS, total: EXTRA_DOMAINS.length }
    const pack = this.pack
    if (!pack) return { lines: [], total: 0 }
    const files = { general: 'list-general.txt', google: 'list-google.txt', exclude: 'list-exclude.txt', ipsetExclude: 'ipset-exclude.txt' }
    const all = name === 'ipset' ? loadedIpset(pack) : listLines(read(join(pack.dir, 'lists', files[name])))
    return { lines: all.slice(0, 3000), total: all.length }
  }

  /* ─── тест стратегий ─── */

  private emitTest(): void {
    if (this.test) this.emit('test', { ...this.test, results: [...this.test.results] })
  }

  async startTests(kind: ZapretTestKind, ids: string[], vpnTunRunning: boolean): Promise<void> {
    if (this.test?.running) throw new Error('Тест уже идёт')
    const pack = await this.guard()
    if (vpnTunRunning) throw new Error('Отключите VPN на время теста: в режиме TUN проверялся бы туннель, а не стратегия')
    await this.refresh()
    if (/running|start pending/i.test(this.state.service.state ?? '')) {
      throw new Error('Работает служба zapret — удалите её на время теста: стратегии запускаются по очереди')
    }
    if (this.state.foreignWinws) throw new Error('Запущен сторонний winws.exe — остановите его, иначе результаты будут неверны')
    const list = [...new Set(ids)].filter((id) => pack.templates.has(id)).sort(compareStrategies)
    if (!list.length) throw new Error('Не выбрано ни одной стратегии')

    const resume = this.proc ? this.state.running : undefined
    await this.stop(true)
    this.testCancel = false
    this.test = { running: true, kind, total: list.length, done: 0, results: [] }
    this.emitTest()
    void this.testLoop(pack, kind, list, resume)
  }

  cancelTests(): void {
    if (!this.test?.running) return
    this.testCancel = true
    const p = this.testProc
    if (p) void this.killProc(p)
  }

  private async testLoop(pack: Pack, kind: ZapretTestKind, list: string[], resume?: string): Promise<void> {
    const t = this.test!
    const cfg = store.get().zapret
    try {
      await ensureRoot()
      await enableTcpTimestamps()

      const targetsFile = join(pack.dir, 'utils', 'targets.txt')
      const targets = kind === 'standard' ? (existsSync(targetsFile) && parseTargets(read(targetsFile)).length ? parseTargets(read(targetsFile)) : DEFAULT_TARGETS) : []
      const suite = kind === 'dpi' ? await this.dpiSuite() : []
      // DPI-проверка честна только когда под фильтр попадает любой адрес — как в утилите сборки
      this.materialize(zapretPaths.test, pack, cfg, kind === 'dpi' ? 'any' : cfg.ipsetMode)

      for (const id of list) {
        if (this.testCancel) break
        t.current = id
        this.emitTest()

        const r: ZapretStrategyResult = { strategy: id, started: false, ok: 0, error: 0, unsup: 0, blocked: 0, pingOk: 0, pingFail: 0, targets: [] }
        const p = this.spawnWinws(pack, this.args(pack, id, cfg, zapretPaths.test), false)
        this.testProc = p
        if (await this.waitAlive(p, 1200)) {
          r.started = true
          r.targets = kind === 'standard' ? await this.standardChecks(targets) : await this.dpiChecks(suite)
          for (const tr of r.targets) {
            for (const c of tr.checks) {
              if (c.status === 'ok') r.ok++
              else if (c.status === 'unsup') r.unsup++
              else if (c.status === 'blocked') r.blocked++
              else r.error++
            }
            if (tr.ping !== undefined) tr.ping === 'Timeout' ? r.pingFail++ : r.pingOk++
          }
        }
        await this.killProc(p)
        this.testProc = null
        if (this.testCancel && r.started) break
        t.results.push(r)
        t.done++
        this.emitTest()
      }

      t.best = pickBest(t.results)
      if (t.results.length) {
        mkdirSync(zapretPaths.reports, { recursive: true })
        const d = new Date()
        const p2 = (n: number): string => String(n).padStart(2, '0')
        const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`
        t.file = join(zapretPaths.reports, `test_results_${stamp}.txt`)
        writeFileSync(t.file, formatReport(kind, t.results, t.best), 'utf8')

        const summary: ZapretTestSummary = { kind, at: Date.now(), best: t.best, scores: {} }
        for (const r of t.results) summary.scores[r.strategy] = { ok: r.ok, total: r.ok + r.error + r.unsup + r.blocked }
        store.patch({ zapretLastTest: summary })
      }
    } catch (e) {
      t.error = errText(e)
    } finally {
      if (this.testProc) await this.killProc(this.testProc)
      this.testProc = null
      t.running = false
      t.current = undefined
      t.finishedAt = Date.now()
      this.emitTest()
      this.emitState()
      if (resume && !this.proc) await this.start(resume)
    }
  }

  private async standardChecks(targets: { name: string; url?: string; ping: string }[]): Promise<ZapretTargetResult[]> {
    return pool(targets, 12, async (tg) => {
      const checks: ZapretTargetResult['checks'] = []
      if (tg.url) {
        for (const c of CHECKS) {
          const r = await httpCheck(tg.url, c.pin, 4000)
          checks.push({ label: c.label, status: r.status, detail: r.detail })
        }
      }
      return { name: tg.name, checks, ping: await ping(tg.ping) }
    })
  }

  private async dpiSuite(): Promise<{ id: string; provider: string; country: string; host: string }[]> {
    let raw: unknown
    try {
      raw = JSON.parse((await fetchBuffer(ZAPRET_DPI_SUITE_URL, { timeoutMs: 10000, maxBytes: 1024 * 1024 })).toString('utf8'))
    } catch (e) {
      throw new Error(`Не удалось загрузить список DPI-чекеров: ${errText(e)}`)
    }
    const suite = toArr(raw as Record<string, unknown>[])
      .map((e) => ({ id: String(e.id ?? ''), provider: String(e.provider ?? ''), country: String(e.country ?? ''), host: String(e.host ?? '') }))
      .filter((e) => /^[\w.\-]+(:\d{1,5})?$/.test(e.host))
      .slice(0, 100)
    if (!suite.length) throw new Error('Список DPI-чекеров пуст')
    return suite
  }

  private async dpiChecks(suite: { id: string; provider: string; country: string; host: string }[]): Promise<ZapretTargetResult[]> {
    const kb = (n: number): string => (n / 1024).toFixed(1)
    return pool(suite, 12, async (s) => {
      const checks: ZapretTargetResult['checks'] = []
      for (const c of CHECKS) {
        const d = await dpiCheck(s.host, c.pin)
        checks.push({ label: c.label, status: d.status, detail: `code=${d.code} up=${kb(d.up)} KB down=${kb(d.down)} KB time=${d.time}s` })
      }
      return { name: `${s.country ? `[${s.country}]` : ''}[${s.provider}] ${s.id}`, checks }
    })
  }
}

export const zapret = new Zapret()
