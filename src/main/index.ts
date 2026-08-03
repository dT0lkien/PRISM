import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { store, paths } from './store'
import { core } from './core'
import { registerIpc, setMainWindow, snapshot, wireCoreEvents } from './ipc'
import { clearSystemProxy, isElevated, killStrayCores, IS_WIN } from './win'
import { fetchSubscription, mergeSubscriptionNodes } from './subs'

const isDev = !app.isPackaged
let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

const startMinimized = process.argv.includes('--minimized')

if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}

app.setAppUserModelId('com.prism.vpn')
// Аппаратное ускорение иногда конфликтует с виртуальными адаптерами на Windows
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

function iconPath(name: string): string {
  const base = app.isPackaged ? join(process.resourcesPath, 'icons') : join(app.getAppPath(), 'resources/icons')
  return join(base, name)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#0a0d14',
    title: 'Prism',
    icon: existsSync(iconPath('icon.png')) ? iconPath('icon.png') : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  setMainWindow(win)

  win.on('ready-to-show', () => {
    if (!startMinimized) win?.show()
  })
  win.on('maximize', () => win?.webContents.send('evt:maximize', true))
  win.on('unmaximize', () => win?.webContents.send('evt:maximize', false))

  win.on('close', (e) => {
    if (!quitting && store.get().settings.closeToTray) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('minimize', () => {
    if (store.get().settings.minimizeToTray) win?.hide()
  })
  win.on('closed', () => {
    win = null
  })

  // Внешние ссылки — в системный браузер, а не в окно приложения
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/* ─────────────────────────── трей ─────────────────────────── */

function trayImage(connected: boolean): Electron.NativeImage {
  const p = iconPath(connected ? 'tray-on.png' : 'tray-off.png')
  if (existsSync(p)) {
    const img = nativeImage.createFromPath(p)
    return IS_WIN ? img : img.resize({ width: 18, height: 18 })
  }
  return nativeImage.createEmpty()
}

function buildTrayMenu(): void {
  if (!tray) return
  const st = core.getState()
  const d = store.get()
  const active = d.nodes.find((n) => n.id === d.activeNodeId)
  const running = st.status === 'running'

  tray.setToolTip(running ? `Prism — подключено${active ? `: ${active.name}` : ''}` : 'Prism — отключено')
  tray.setImage(trayImage(running))

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: running ? '● Подключено' : '○ Отключено', enabled: false },
      { type: 'separator' },
      {
        label: running ? 'Отключить' : 'Подключить',
        click: async () => {
          if (running) await core.stop()
          else await core.start()
        }
      },
      {
        label: 'Режим',
        submenu: [
          {
            label: 'TUN (весь трафик)',
            type: 'radio',
            checked: d.settings.captureMode === 'tun',
            click: async () => {
              store.setSettings({ captureMode: 'tun' })
              win?.webContents.send('evt:snapshot', snapshot())
              await core.applyIfRunning()
            }
          },
          {
            label: 'Системный прокси',
            type: 'radio',
            checked: d.settings.captureMode === 'proxy',
            click: async () => {
              store.setSettings({ captureMode: 'proxy' })
              win?.webContents.send('evt:snapshot', snapshot())
              await core.applyIfRunning()
            }
          }
        ]
      },
      { type: 'separator' },
      {
        label: 'Открыть Prism',
        click: () => {
          win?.show()
          win?.focus()
        }
      },
      {
        label: 'Выход',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

function createTray(): void {
  try {
    tray = new Tray(trayImage(false))
  } catch {
    return // без иконки трея приложение всё равно должно работать
  }
  tray.on('click', () => {
    if (win?.isVisible()) win.focus()
    else {
      win?.show()
      win?.focus()
    }
  })
  buildTrayMenu()
  core.on('state', buildTrayMenu)
}

/* ─────────────────────── автообновление подписок ─────────────────────── */

function scheduleSubscriptionUpdates(): void {
  const tick = async (): Promise<void> => {
    const d = store.get()
    const now = Date.now()
    for (const s of d.subscriptions) {
      if (!s.autoUpdate) continue
      const due = (s.updatedAt ?? 0) + Math.max(1, s.intervalHours) * 3600_000
      if (now < due) continue
      try {
        const { nodes: fresh, userInfo } = await fetchSubscription(s.url, s.id)
        const { nodes } = mergeSubscriptionNodes(store.get().nodes, fresh, s.id)
        s.updatedAt = now
        s.userInfo = userInfo
        s.lastError = undefined
        store.patch({ nodes })
        win?.webContents.send('evt:snapshot', snapshot())
      } catch (e: any) {
        s.lastError = String(e.message ?? e)
        store.save()
      }
    }
  }
  setTimeout(tick, 30_000)
  setInterval(tick, 30 * 60_000)
}

/* ─────────────────────────── жизненный цикл ─────────────────────────── */

app.on('second-instance', () => {
  if (win) {
    if (!win.isVisible()) win.show()
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(async () => {
  store.load()
  await killStrayCores(paths.runtimeConfig) // подчищаем хвосты после аварийного завершения

  registerIpc()
  wireCoreEvents()
  createWindow()
  createTray()
  scheduleSubscriptionUpdates()

  const st = store.get().settings
  if (st.autoConnect) {
    const elevated = await isElevated()
    if (st.captureMode !== 'tun' || elevated) {
      setTimeout(() => void core.start(), 1200)
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else win?.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Окно закрыто, но приложение живёт в трее — выход только через меню
    if (!store.get().settings.closeToTray) app.quit()
  }
})

app.on('before-quit', () => {
  quitting = true
})

let cleanedUp = false
async function cleanup(): Promise<void> {
  if (cleanedUp) return
  cleanedUp = true
  try {
    await core.stop(true)
  } catch {
    /* всё равно выходим */
  }
  try {
    await clearSystemProxy(store.get().savedProxy)
  } catch {
    /* всё равно выходим */
  }
  store.save(true)
}

app.on('will-quit', (e) => {
  if (cleanedUp) return
  e.preventDefault()
  void cleanup().then(() => app.exit(0))
})

process.on('uncaughtException', (e) => {
  console.error('[main] необработанная ошибка:', e)
})

export { paths }
