/* Проверка живучести хранилища: порча файла не должна стоить пользователю данных. */
import { writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { store, paths } from '../src/main/store'
import type { ServerNode } from '../src/shared/types'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  cond ? pass++ : fail++
}

const node = (id: string): ServerNode =>
  ({ id, name: `сервер ${id}`, type: 'vless', server: 'x.example.net', port: 443, outbound: {}, createdAt: Date.now() }) as ServerNode

console.log('\n▸ Обычная запись и чтение')
store.load()
store.patch({ nodes: [node('a'), node('b'), node('c')], activeNodeId: 'b' })
ok('файл создан', existsSync(paths.config))
store.load()
ok('серверы на месте', store.get().nodes.length === 3, `${store.get().nodes.length} шт.`)

console.log('\n▸ Появилась резервная копия')
store.patch({ nodes: [node('a'), node('b'), node('c'), node('d')], activeNodeId: 'd' })
store.setSettings({ localPort: 3412 })
ok('резервная копия создана', existsSync(paths.configBackup))
const bak = JSON.parse(readFileSync(paths.configBackup, 'utf8'))
ok('в копии последние серверы и настройки', bak.nodes.length === 4 && bak.activeNodeId === 'd' && bak.settings.localPort === 3412)

console.log('\n▸ Основной файл повреждён (как после аварийного выключения)')
writeFileSync(paths.config, '{"nodes": [{"id": "a", "nam', 'utf8')
store.loadWarning = null
store.load()
ok('данные восстановлены из копии', store.get().nodes.length === 4 && store.get().settings.localPort === 3412)
ok('пользователь предупреждён', !!store.loadWarning, store.loadWarning ?? '')
const corrupt = readdirSync(paths.data).filter((f) => f.startsWith('store.corrupt-'))
ok('битый файл сохранён для разбора', corrupt.length === 1, corrupt[0] ?? '')

console.log('\n▸ Основной файл исчез')
rmSync(paths.config)
store.load()
ok('восстановлены выбранный сервер и порт', store.get().activeNodeId === 'd' && store.get().settings.localPort === 3412)
ok('основной файл записан заново', existsSync(paths.config))

console.log('\n▸ Сохранился только законченный временный файл')
writeFileSync(`${paths.config}.tmp`, readFileSync(paths.config))
writeFileSync(paths.config, '{}')
rmSync(paths.configBackup)
store.load()
ok('пустой JSON не маскирует потерю настроек', store.get().nodes.length === 4 && !!store.loadWarning)
ok('резервная копия восстановлена', existsSync(paths.configBackup))

console.log('\n▸ Повреждены оба файла')
writeFileSync(paths.config, 'мусор', 'utf8')
writeFileSync(paths.configBackup, 'тоже мусор', 'utf8')
store.loadWarning = null
store.load()
ok('приложение не падает', true)
ok('список пуст, но предупреждение показано', store.get().nodes.length === 0 && !!store.loadWarning, store.loadWarning ?? '')

console.log(`\n${fail === 0 ? '✅' : '❌'} итог: ${pass} ок, ${fail} провалено`)
process.exit(fail === 0 ? 0 : 1)
