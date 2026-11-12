/* Платформенный слой: права администратора, системный прокси, автозапуск,
   перечисление приложений.

   Имя историческое — сначала поддерживалась только Windows. Теперь здесь
   развилка: ветки Windows живут прямо тут, macOS уходит в ./mac (там всё
   привилегированное делается через демон), Linux по-прежнему деградирует
   мягко — чтобы интерфейс можно было гонять в разработке. */

import { app, nativeImage } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, dirname, join } from 'node:path'
import type { DetectedApp } from '@shared/types'
import * as mac from './mac'

const exec = promisify(execFile)
export const IS_WIN = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'

const INET_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
const TASK_NAME = 'PrismVPN-AutoStart'

export const DEFAULT_BYPASS = [
  'localhost',
  '127.*',
  '10.*',
  '172.16.*',
  '172.17.*',
  '172.18.*',
  '172.19.*',
  '172.20.*',
  '172.21.*',
  '172.22.*',
  '172.23.*',
  '172.24.*',
  '172.25.*',
  '172.26.*',
  '172.27.*',
  '172.28.*',
  '172.29.*',
  '172.30.*',
  '172.31.*',
  '192.168.*',
  '<local>'
].join(';')

/* PowerShell 7 дописывает свои модули в PSModulePath, и powershell.exe 5.1,
   запущенный из-под него — из терминала pwsh или шагом CI GitHub, — пытается
   грузить их вместо своих: Get-Acl, Get-CimInstance и прочие просто пропадают.
   Без этой переменной 5.1 соберёт путь к своим модулям сам. */
function psEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'psmodulepath') delete env[k]
  return env
}

export async function ps(script: string, timeout = 20000): Promise<string> {
  const { stdout } = await exec(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: psEnv() }
  )
  return stdout
}

/**
 * PowerShell для скриптов, которые возвращают данные. Скрипт уходит через
 * -EncodedCommand — без сюрпризов с кавычками и переводами строк, — а вывод
 * переключается на UTF-8: иначе имена служб, пути с кириллицей и системные
 * сообщения приезжают в OEM-кодировке и превращаются в кракозябры.
 * Кодировку ставим в самом конце: cmd с chcp внутри скрипта её сбил бы.
 */
export async function psUtf8(script: string, timeout = 30000, env?: Record<string, string>): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const { stdout } = await exec(
    join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', env: psEnv(env) }
  )
  return stdout
}

/** Строка, которая переключает вывод PowerShell на UTF-8 — ставить прямо перед выводом результата */
export const PS_UTF8 = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8'

/* ─────────────────────────── права ─────────────────────────── */

let elevatedCheck: Promise<boolean> | undefined

export async function isElevated(): Promise<boolean> {
  /* На macOS «есть права» означает «установлен и отвечает наш демон»: сам по
     себе процесс приложения root никогда не получит. Раньше здесь безусловно
     возвращалось true, из-за чего TUN проходил проверку и падал уже в ядре —
     пользователь видел невнятную ошибку вместо «нужно поставить демон». */
  if (IS_MAC) {
    const info = await mac.probe()
    return info.reachable && info.compatible
  }
  if (!IS_WIN) return true
  // Проверяем токен процесса: net session зависит от службы LanmanServer.
  elevatedCheck ??= psUtf8(`
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  `, 10000).then((out) => out.trim() === 'True')
  return elevatedCheck
}

const ELEVATION_ARG = '--prism-elevation='
const elevationArg = process.argv.find((arg) => arg.startsWith(ELEVATION_ARG))
export const elevationAttempted = elevationArg !== undefined

export async function waitForPreviousInstance(): Promise<void> {
  const pid = Number(elevationArg?.slice(ELEVATION_ARG.length))
  if (!Number.isInteger(pid) || pid <= 0 || pid > 0xffffffff || pid === process.pid) return
  await psUtf8(`
    $previous = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
    if ($previous -and !$previous.WaitForExit(30000)) { exit 1 }
  `, 35000)
}

// Start-Process передаёт аргументы одной командной строкой Win32.
function quoteWindowsArg(arg: string): string {
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/, '$&$&')}"`
}

/** Перезапуск себя с правами администратора. Возвращает false, если пользователь отказал в UAC. */
export async function relaunchElevated(restart = false): Promise<boolean> {
  /* На macOS «повысить права» — это поставить демон. Перезапуск не нужен:
     после установки приложение просто начинает его видеть. */
  if (IS_MAC) {
    const r = await mac.installHelper()
    if (!r.ok && r.error) throw new Error(r.error)
    return r.ok
  }
  if (!IS_WIN) return false
  const exe = launcher()
  // В деве execPath — это electron.exe, ему нужен путь к приложению первым аргументом
  const args = app.isPackaged ? process.argv.slice(1) : [app.getAppPath(), ...process.argv.slice(2)]
  const all = args.filter((arg) => !arg.startsWith(ELEVATION_ARG))
  all.push(`${ELEVATION_ARG}${restart ? process.pid : 0}`)

  const out = (await psUtf8(`
    ${PS_UTF8}
    try {
      Start-Process -FilePath $env:PRISM_EXE -ArgumentList $env:PRISM_ARGS -WorkingDirectory $env:PRISM_CWD -Verb RunAs -ErrorAction Stop
      'OK'
    } catch {
      $cause = $_.Exception
      while ($cause -and $cause -isnot [ComponentModel.Win32Exception]) { $cause = $cause.InnerException }
      if ($cause -and $cause.NativeErrorCode -eq 1223) { 'CANCELLED' }
      else { $_.Exception.Message }
    }
  `, 120000, { PRISM_EXE: exe, PRISM_ARGS: all.map(quoteWindowsArg).join(' '), PRISM_CWD: dirname(exe) })).trim()

  if (out === 'CANCELLED') return false
  if (out !== 'OK') throw new Error(out || 'Windows не запустила Prism с повышенными правами')
  return true
}

/* ─────────────────────────── системный прокси ─────────────────────────── */

async function regQuery(name: string): Promise<string> {
  try {
    const { stdout } = await exec('reg', ['query', INET_KEY, '/v', name], { timeout: 8000, windowsHide: true })
    const m = stdout.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.*)`, 'i'))
    return m ? m[1].trim() : ''
  } catch {
    return ''
  }
}

export interface ProxyState {
  enable: string
  server: string
  override: string
}

export async function readSystemProxy(): Promise<ProxyState> {
  /* На macOS прежнее состояние запоминает сам демон — ему же его и
     восстанавливать, в том числе если приложение не доживёт до выключения. */
  if (!IS_WIN) return { enable: '0', server: '', override: '' }
  const [enable, server, override] = await Promise.all([
    regQuery('ProxyEnable'),
    regQuery('ProxyServer'),
    regQuery('ProxyOverride')
  ])
  return { enable: enable || '0x0', server, override }
}

/** Уведомляем WinINet, что настройки изменились — иначе браузеры подхватят их не сразу */
async function refreshWinInet(): Promise<void> {
  if (!IS_WIN) return
  try {
    await ps(
      `Add-Type -MemberDefinition '[DllImport("wininet.dll", SetLastError=true)]public static extern bool InternetSetOption(IntPtr h,int o,IntPtr b,int l);' -Name W -Namespace P -ErrorAction SilentlyContinue;` +
        `[P.W]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0)|Out-Null;` +
        `[P.W]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0)|Out-Null`,
      25000
    )
  } catch {
    /* не критично: настройки всё равно применятся, просто чуть позже */
  }
}

export async function setSystemProxy(hostPort: string, bypass = DEFAULT_BYPASS): Promise<void> {
  if (IS_MAC) {
    const port = Number(hostPort.split(':').pop())
    if (!Number.isInteger(port)) throw new Error(`не разобрать порт прокси: ${hostPort}`)
    await mac.setSystemProxy(port)
    return
  }
  if (!IS_WIN) return
  await exec('reg', ['add', INET_KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', hostPort, '/f'], { windowsHide: true })
  await exec('reg', ['add', INET_KEY, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', bypass, '/f'], { windowsHide: true })
  await exec('reg', ['add', INET_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'], { windowsHide: true })
  await refreshWinInet()
}

export async function clearSystemProxy(restore?: ProxyState): Promise<void> {
  if (IS_MAC) {
    await mac.clearSystemProxy()
    return
  }
  if (!IS_WIN) return
  try {
    const wasOn = restore && /0x1|^1$/.test(restore.enable) && restore.server
    if (wasOn) {
      await exec('reg', ['add', INET_KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', restore!.server, '/f'], {
        windowsHide: true
      })
      await exec('reg', ['add', INET_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'], { windowsHide: true })
    } else {
      await exec('reg', ['add', INET_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'], { windowsHide: true })
    }
  } catch {
    /* ключа может не быть — не страшно */
  }
  await refreshWinInet()
}

/* ─────────────────────────── автозапуск ─────────────────────────── */

/* Путь и аргументы хранятся в разных полях действия. Задача привязана
   к пользователю и работает от батареи без ограничения времени. */
const TASK_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
${PS_UTF8}
$result = 'OK'
try {
  $user = [Security.Principal.WindowsIdentity]::GetCurrent()
  $sid = $user.User.Value
  $taskName = $env:PRISM_TASK + '-' + $sid
  $tasks = Get-ScheduledTask | Where-Object { $_.TaskPath -eq '\' }
  if ($env:PRISM_ENABLED -eq '1') {
    $actionArgs = @{ Execute = $env:PRISM_EXE; WorkingDirectory = $env:PRISM_CWD }
    if ($env:PRISM_MINIMIZED -eq '1') { $actionArgs.Argument = '--minimized' }
    $action = New-ScheduledTaskAction @actionArgs
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user.Name
    $principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -Priority 4
    Register-ScheduledTask -TaskPath '\' -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  } else {
    $tasks | Where-Object { $_.TaskName -eq $taskName } | Unregister-ScheduledTask -Confirm:$false
  }
  $tasks | Where-Object {
    $_.TaskName -eq $env:PRISM_TASK -and $_.Principal.UserId -in @($sid, $user.Name)
  } | Unregister-ScheduledTask -Confirm:$false
} catch {
  $result = 'ERR:' + $_.Exception.Message
}
Write-Output $result
`

/* Что запускать при входе. Портативная сборка при каждом старте распаковывает
   себя во временный каталог, и process.execPath ведёт туда — после выхода
   этого файла уже нет. Настоящий exe она сообщает переменной окружения. */
const launcher = (): string => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath

let autoStartUpdate = Promise.resolve()

export async function setAutoStart(enabled: boolean, minimized: boolean): Promise<void> {
  if (!IS_WIN) {
    app.setLoginItemSettings({ openAtLogin: enabled })
    return
  }
  if (!app.isPackaged) return

  // Настройки могут измениться, пока ещё применяется задача с запуска приложения.
  const update = autoStartUpdate.then(async () => {
    const exe = launcher()
    const out = (await psUtf8(TASK_SCRIPT, 30000, {
      PRISM_EXE: exe,
      PRISM_CWD: dirname(exe),
      PRISM_ENABLED: enabled ? '1' : '0',
      PRISM_MINIMIZED: minimized ? '1' : '0',
      PRISM_TASK: TASK_NAME
    })).trim()
    if (out !== 'OK') {
      throw new Error(out.replace(/^ERR:/, '').trim() || 'Планировщик заданий не подтвердил изменение')
    }
    // Удаляем запись, созданную старыми версиями через реестр.
    app.setLoginItemSettings({ openAtLogin: false })
  })
  autoStartUpdate = update.catch(() => undefined)
  await update
}

/* ─────────────────────────── приложения ─────────────────────────── */

const iconCache = new Map<string, string>()

export async function getAppIcon(path: string): Promise<string | undefined> {
  if (IS_MAC) return mac.getAppIcon(path)
  if (!path) return undefined
  if (iconCache.has(path)) return iconCache.get(path)
  try {
    const img = await app.getFileIcon(path, { size: 'normal' })
    if (img.isEmpty()) return undefined
    const url = img.resize({ width: 32, height: 32 }).toDataURL()
    iconCache.set(path, url)
    return url
  } catch {
    return undefined
  }
}

/** Список запущенных процессов с путями — для выбора приложений */
export async function listRunningApps(): Promise<DetectedApp[]> {
  if (!IS_WIN) {
    try {
      const { stdout } = await exec('/bin/ps', ['-axo', 'comm='], { maxBuffer: 8 * 1024 * 1024 })
      const seen = new Map<string, DetectedApp>()
      for (const line of stdout.split('\n')) {
        const p = line.trim()
        if (!p.startsWith('/')) continue
        const exe = basename(p)
        if (!seen.has(exe)) seen.set(exe, { exe, name: exe, path: p, running: true })
      }
      return [...seen.values()].slice(0, 200)
    } catch {
      return []
    }
  }

  try {
    const out = await ps(
      `Get-Process | Where-Object { $_.Path } | Select-Object -Property ProcessName,Path,Description -Unique | ConvertTo-Json -Compress`,
      25000
    )
    const raw = JSON.parse(out || '[]')
    const arr: any[] = Array.isArray(raw) ? raw : [raw]
    const seen = new Map<string, DetectedApp>()
    for (const p of arr) {
      if (!p?.Path) continue
      const exe = basename(String(p.Path))
      if (seen.has(exe)) continue
      seen.set(exe, {
        exe,
        name: String(p.Description || p.ProcessName || exe),
        path: String(p.Path),
        running: true
      })
    }
    const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    // Иконки подгружаем параллельно, но не больше сотни за раз
    await Promise.all(
      list.slice(0, 100).map(async (a) => {
        a.icon = await getAppIcon(a.path)
      })
    )
    return list
  } catch (e) {
    console.error('[win] не удалось получить список процессов:', e)
    return []
  }
}

/**
 * Снять зависшие процессы ядра, оставшиеся после аварийного завершения.
 * Бьём только по своим: фильтр по пути к нашему конфигу, иначе положили бы
 * ядро соседнего клиента — Hiddify, Nekoray и прочие тоже носят sing-box.exe.
 */
export interface StrayResult {
  found: number
  killed: number
}

/**
 * Снять зависшие процессы ядра, оставшиеся после аварийного завершения.
 * Ищем строго свои: по пути к нашему бинарнику и по пути к нашему конфигу —
 * иначе положили бы ядро соседнего клиента, Hiddify и Nekoray тоже носят
 * sing-box.exe. ExecutablePath читается чаще, чем CommandLine: у процесса,
 * запущенного с правами администратора, командную строку обычному
 * пользователю не покажут.
 */
export async function killStrayCores(configPath: string, corePath?: string): Promise<StrayResult> {
  const q = (v: string): string => v.replace(/'/g, "''")
  try {
    if (IS_WIN) {
      const byPath = corePath ? ` -or $_.ExecutablePath -eq '${q(corePath)}'` : ''
      const out = await ps(
        `$p = @(Get-CimInstance Win32_Process -Filter "Name='sing-box.exe'" |` +
          ` Where-Object { $_.CommandLine -like '*${q(configPath)}*'${byPath} });` +
          ` $k = 0;` +
          ` foreach ($x in $p) { try { Stop-Process -Id $x.ProcessId -Force -ErrorAction Stop; $k++ } catch {} }` +
          ` "$($p.Count) $k"`,
        20000
      )
      const [found, killed] = out.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0)
      return { found: found ?? 0, killed: killed ?? 0 }
    }
    await exec('/usr/bin/pkill', ['-f', configPath], { timeout: 10000 })
    return { found: 1, killed: 1 }
  } catch {
    return { found: 0, killed: 0 }
  }
}

/**
 * Аварийная уборка при выключении Windows. Асинхронности здесь нет:
 * на session-end система даёт считанные секунды и не ждёт промисов.
 */
export function emergencyCleanupSync(pid: number | undefined, restore?: ProxyState): void {
  if (!IS_WIN) return
  const run = (cmd: string, args: string[]): void => {
    try {
      execFileSync(cmd, args, { windowsHide: true, timeout: 4000, stdio: 'ignore' })
    } catch {
      /* уходим в любом случае */
    }
  }
  if (pid) run('taskkill', ['/PID', String(pid), '/T', '/F'])
  const wasOn = restore && /0x1|^1$/.test(restore.enable) && restore.server
  if (wasOn) {
    run('reg', ['add', INET_KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', restore!.server, '/f'])
    run('reg', ['add', INET_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'])
  } else {
    run('reg', ['add', INET_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'])
  }
}

/** Синхронно добить процесс с потомками — для уборки на выключении Windows */
export function killPidSync(pid: number | undefined): void {
  if (!IS_WIN || !pid) return
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 4000, stdio: 'ignore' })
  } catch {
    /* уже завершился */
  }
}

/**
 * После аварийного завершения в реестре мог остаться наш прокси, которого
 * уже никто не слушает — для пользователя это выглядит как «пропал интернет».
 * Возвращает true, если пришлось вмешаться.
 */
export async function clearStaleProxy(localPort: number, saved?: ProxyState): Promise<boolean> {
  if (!IS_WIN) return false
  try {
    const cur = await readSystemProxy()
    const on = /0x1|^1$/.test(cur.enable)
    if (!on || !cur.server.includes(`127.0.0.1:${localPort}`)) return false
    // Если в «сохранённых» тоже мы — восстанавливать нечего, просто выключаем
    const sane = saved && !saved.server.includes(`127.0.0.1:${localPort}`) ? saved : undefined
    await clearSystemProxy(sane)
    return true
  } catch {
    return false
  }
}

export { nativeImage }
