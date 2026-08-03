/* Всё, что специфично для Windows: права администратора, системный прокси,
   автозапуск, перечисление приложений. На macOS/Linux функции деградируют
   мягко — чтобы интерфейс можно было гонять в разработке. */

import { app, nativeImage } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename } from 'node:path'
import type { DetectedApp } from '@shared/types'

const exec = promisify(execFile)
export const IS_WIN = process.platform === 'win32'

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

async function ps(script: string, timeout = 20000): Promise<string> {
  const { stdout } = await exec(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
  )
  return stdout
}

/* ─────────────────────────── права ─────────────────────────── */

let elevatedCache: boolean | null = null

export async function isElevated(): Promise<boolean> {
  if (!IS_WIN) return true // в деве на mac считаем, что прав хватает
  if (elevatedCache !== null) return elevatedCache
  try {
    await exec('net', ['session'], { timeout: 8000, windowsHide: true })
    elevatedCache = true
  } catch {
    elevatedCache = false
  }
  return elevatedCache
}

/** Перезапуск себя с правами администратора. Возвращает false, если пользователь отказал в UAC. */
export async function relaunchElevated(extraArgs: string[] = []): Promise<boolean> {
  if (!IS_WIN) return false
  const exe = process.execPath
  // В деве execPath — это electron.exe, ему нужен путь к приложению первым аргументом
  const args = app.isPackaged ? process.argv.slice(1) : [app.getAppPath(), ...process.argv.slice(2)]
  const all = [...args, ...extraArgs].filter((a) => a !== '--elevated')
  all.push('--elevated')

  const list = all.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
  const argPart = all.length ? `-ArgumentList ${list}` : ''
  try {
    await ps(`Start-Process -FilePath '${exe.replace(/'/g, "''")}' ${argPart} -Verb RunAs`, 60000)
    return true
  } catch {
    return false // почти всегда — «Нет» в окне UAC
  }
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

export async function readSystemProxy(): Promise<{ enable: string; server: string; override: string }> {
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
  if (!IS_WIN) return
  await exec('reg', ['add', INET_KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', hostPort, '/f'], { windowsHide: true })
  await exec('reg', ['add', INET_KEY, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', bypass, '/f'], { windowsHide: true })
  await exec('reg', ['add', INET_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'], { windowsHide: true })
  await refreshWinInet()
}

export async function clearSystemProxy(restore?: { enable: string; server: string; override: string }): Promise<void> {
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

export async function setAutoStart(enabled: boolean, elevated: boolean, minimized: boolean): Promise<void> {
  if (!IS_WIN) {
    app.setLoginItemSettings({ openAtLogin: enabled })
    return
  }
  // Обычный автозапуск через реестр — снимаем всегда, чтобы не было двух записей
  app.setLoginItemSettings({ openAtLogin: enabled && !elevated, args: minimized ? ['--minimized'] : [] })

  if (elevated && enabled) {
    // Задача планировщика с наивысшими правами: автозапуск без окна UAC
    const exe = process.execPath
    const tr = `\\"${exe}\\"${minimized ? ' --minimized' : ''} --elevated`
    try {
      await exec(
        'schtasks',
        ['/create', '/tn', TASK_NAME, '/tr', tr, '/sc', 'onlogon', '/rl', 'highest', '/f'],
        { timeout: 20000, windowsHide: true }
      )
    } catch (e) {
      throw new Error('Не удалось создать задачу автозапуска — нужны права администратора')
    }
  } else {
    try {
      await exec('schtasks', ['/delete', '/tn', TASK_NAME, '/f'], { timeout: 20000, windowsHide: true })
    } catch {
      /* задачи не было */
    }
  }
}

export async function hasAutoStartTask(): Promise<boolean> {
  if (!IS_WIN) return false
  try {
    await exec('schtasks', ['/query', '/tn', TASK_NAME], { timeout: 10000, windowsHide: true })
    return true
  } catch {
    return false
  }
}

/* ─────────────────────────── приложения ─────────────────────────── */

const iconCache = new Map<string, string>()

export async function getAppIcon(path: string): Promise<string | undefined> {
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
export async function killStrayCores(configPath: string): Promise<void> {
  const needle = configPath.replace(/'/g, "''")
  try {
    if (IS_WIN) {
      await ps(
        `Get-CimInstance Win32_Process -Filter "Name='sing-box.exe'" |` +
          ` Where-Object { $_.CommandLine -like '*${needle}*' } |` +
          ` ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        15000
      )
    } else {
      await exec('/usr/bin/pkill', ['-f', configPath], { timeout: 10000 })
    }
  } catch {
    /* нечего убивать — это норма */
  }
}

export { nativeImage }
