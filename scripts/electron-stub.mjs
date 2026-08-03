/* Заглушка модуля electron — чтобы гонять main-процесс обычным node в тестах. */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DATA = process.env.PRISM_TEST_DATA || mkdtempSync(join(tmpdir(), 'prism-e2e-'))

export const app = {
  isPackaged: false,
  getPath: () => DATA,
  getAppPath: () => process.cwd(),
  getVersion: () => '1.0.0',
  getFileIcon: async () => ({ isEmpty: () => true }),
  setLoginItemSettings: () => {},
  on: () => {},
  quit: () => {},
  exit: (c) => process.exit(c ?? 0)
}

export const nativeImage = {
  createEmpty: () => ({ isEmpty: () => true }),
  createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) })
}

export const BrowserWindow = class {}
export const ipcMain = { handle: () => {} }
export const dialog = {}
export const shell = {}
export const clipboard = { readText: () => '', writeText: () => {} }
export const Menu = { buildFromTemplate: () => ({}) }
export const Tray = class {}
export default { app, nativeImage, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu, Tray }
