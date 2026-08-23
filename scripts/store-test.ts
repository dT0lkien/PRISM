/* Проверка живучести хранилища: порча файла не должна стоить пользователю данных. */
import { writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
store.save(true)
ok('файл создан', existsSync(paths.config))
store.load()
ok('серверы на месте', store.get().nodes.length === 3, `${store.get().nodes.length} шт.`)

console.log('\n▸ Появилась резервная копия')
store.patch({ nodes: [node('a'), node('b'), node('c'), node('d')] })
store.save(true)
ok('резервная копия создана', existsSync(paths.configBackup))
const bak = JSON.parse(readFileSync(paths.configBackup, 'utf8'))
ok('в копии предыдущее состояние', bak.nodes.length === 3, `${bak.nodes.length} шт.`)

console.log('\n▸ Основной файл повреждён (как после аварийного выключения)')
writeFileSync(paths.config, '{"nodes": [{"id": "a", "nam', 'utf8')
store.loadWarning = null
store.load()
ok('данные восстановлены из копии', store.get().nodes.length === 3, `${store.get().nodes.length} шт.`)
ok('пользователь предупреждён', !!store.loadWarning, store.loadWarning ?? '')
const corrupt = readdirSync(paths.data).filter((f) => f.startsWith('store.corrupt-'))
ok('битый файл сохранён для разбора', corrupt.length === 1, corrupt[0] ?? '')

console.log('\n▸ Повреждены оба файла')
writeFileSync(paths.config, 'мусор', 'utf8')
writeFileSync(paths.configBackup, 'тоже мусор', 'utf8')
store.loadWarning = null
store.load()
ok('приложение не падает', true)
ok('список пуст, но предупреждение показано', store.get().nodes.length === 0 && !!store.loadWarning, store.loadWarning ?? '')

console.log(`\n${fail === 0 ? '✅' : '❌'} итог: ${pass} ок, ${fail} провалено`)
process.exit(fail === 0 ? 0 : 1)
