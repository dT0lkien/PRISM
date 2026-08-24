/* Платформенные функции macOS.

   Всё привилегированное здесь делается через демон (см. helper.ts), а не
   напрямую: networksetup не setuid, а право system.services.configuration
   требует пароля админа — иначе macOS спрашивала бы его при каждом
   подключении. Демон ставится один раз, и это единственный запрос пароля. */

import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { HelperClient, probeHelper, type HelperInfo } from './helper'

const exec = promisify(execFile)

export const HELPER_LABEL = 'com.prism.vpn.helper'

/** Ресурсы, из которых ставится демон: в сборке рядом с приложением, в деве — из репозитория. */
function installSources(): { script: string; helper: string; core: string; rules: string } {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  /* В сборке всё лежит в Resources/ плоско, в деве — по своим местам репозитория.
     Скрипты в обоих случаях в helper/, поэтому развилки для них нет. */
  return {
    script: join(base, 'helper/install.sh'),
    helper: join(base, app.isPackaged ? 'helper/prism-helper' : 'resources/helper/prism-helper'),
    core: join(base, app.isPackaged ? 'core/sing-box' : 'resources/core/mac/sing-box'),
    rules: join(base, app.isPackaged ? 'rules' : 'resources/rules')
  }
}

export function helperInstallable(): boolean {
  const s = installSources()
  return existsSync(s.script) && existsSync(s.helper) && existsSync(s.core)
}

export function probe(): Promise<HelperInfo> {
  return probeHelper()
}

/**
 * Ставит демон: один запрос пароля через osascript, дальше он живёт сам.
 * Возвращает false, если пользователь отказался от запроса пароля.
 */
export async function installHelper(): Promise<{ ok: boolean; error?: string }> {
  const s = installSources()
  if (!helperInstallable()) {
    return { ok: false, error: 'В сборке нет файлов демона — соберите его: npm run build:helper' }
  }
  // Кавычки для AppleScript: внутри строки do shell script они двойные.
  const q = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`
  const cmd = `/bin/sh ${q(s.script)} ${q(s.helper)} ${q(s.core)} ${q(s.rules)} ${process.getuid?.() ?? 501}`
  const script = `do shell script "${cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges`

  try {
    await exec('/usr/bin/osascript', ['-e', script], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 })
    return { ok: true }
  } catch (e: any) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim()
    // -128 — пользователь нажал «Отмена» в запросе пароля
    if (/User cancell?ed|-128/i.test(out)) return { ok: false, error: 'Установка отменена' }
    return { ok: false, error: out || String(e.message ?? e) }
  }
}

export async function uninstallHelper(): Promise<{ ok: boolean; error?: string }> {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  const script = join(base, 'helper/uninstall.sh')
  if (!existsSync(script)) return { ok: false, error: 'Не найден скрипт удаления' }
  const cmd = `/bin/sh '${script}'`
  try {
    await exec('/usr/bin/osascript', ['-e', `do shell script "${cmd}" with administrator privileges`], { timeout: 60000 })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: String(e.message ?? e) }
  }
}

/* ─────────── системный прокси: только через демон ─────────── */

/** Одноразовое соединение для короткой команды. */
async function withHelper<T>(fn: (c: HelperClient) => Promise<T>): Promise<T> {
  const c = new HelperClient()
  await c.connect()
  try {
    return await fn(c)
  } finally {
    c.close()
  }
}

export async function setSystemProxy(port: number): Promise<void> {
  await withHelper((c) => c.setProxy(port))
}

export async function clearSystemProxy(): Promise<void> {
  await withHelper((c) => c.clearProxy())
}

/* ─────────── приложения для правил маршрутизации ─────────── */

/** Иконка приложения из .app-бандла. */
export async function getAppIcon(path: string): Promise<string | undefined> {
  try {
    const img = await app.getFileIcon(path, { size: 'normal' })
    if (img.isEmpty()) return undefined
    return img.toDataURL()
  } catch {
    return undefined
  }
}
