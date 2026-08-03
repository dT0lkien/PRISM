/* Снимает скриншоты всех экранов из собранного renderer с подставными данными.
   Запуск: npx electron scripts/shoot.mjs */
import { app, BrowserWindow } from 'electron'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const OUT = process.env.SHOT_DIR || join(ROOT, 'shots')
mkdirSync(OUT, { recursive: true })

const PAGES = ['dashboard', 'servers', 'routing', 'apps', 'connections', 'logs', 'settings']
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    frame: false,
    backgroundColor: '#070a11',
    webPreferences: {
      preload: join(ROOT, 'scripts/shoot-preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false
    }
  })

  await win.loadFile(join(ROOT, 'out/renderer/index.html'))
  await wait(1400)

  for (let i = 0; i < PAGES.length; i++) {
    await win.webContents.executeJavaScript(
      `document.querySelectorAll('.nav-item')[${i}]?.click(); true`
    )
    await wait(1500)
    const img = await win.webContents.capturePage()
    const file = join(OUT, `${i + 1}-${PAGES[i]}.png`)
    writeFileSync(file, img.toPNG())
    console.log('✓', file)
  }

  // Светлая тема — отдельным кадром
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light'; true`)
  await win.webContents.executeJavaScript(`document.querySelectorAll('.nav-item')[0]?.click(); true`)
  await wait(1400)
  writeFileSync(join(OUT, '8-dashboard-light.png'), (await win.webContents.capturePage()).toPNG())
  console.log('✓ светлая тема')

  app.exit(0)
})
