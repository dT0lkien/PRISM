import { app, BrowserWindow } from 'electron'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = process.cwd()
mkdirSync(join(ROOT, 'shots/gfx'), { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
app.disableHardwareAcceleration()
setTimeout(() => { console.log('ВЫШЛИ ПО ТАЙМЕРУ'); app.exit(2) }, 40000)
app.whenReady().then(async () => {
  const theme = process.env.PRISM_THEME || 'dark'
  const win = new BrowserWindow({ width: 1280, height: 860, show: false, frame: false, backgroundColor: '#0a0a0a',
    webPreferences: { preload: join(ROOT, 'scripts/shoot-preload.js'), contextIsolation: false, sandbox: false } })
  await win.loadFile(join(ROOT, 'out/renderer/index.html'))
  console.log('загружено')
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='${theme}'; true`)
  await wait(2200)
  await win.webContents.executeJavaScript(`document.querySelectorAll('.main > div').forEach(el => { el.style.opacity='1'; el.style.transform='none' }); true`)
  await wait(500)
  console.log('снимаю…')
  const img = await win.webContents.capturePage()
  writeFileSync(join(ROOT, `shots/gfx/${theme}-full.png`), img.toPNG())
  console.log('✓', theme)
  app.exit(0)
})
