/* Проверка общего ядра: один и тот же код обслуживает Windows и iOS.

   Что доказывается:
     1. Бандл исполняется в среде без единого веб-API — то есть в JavaScriptCore,
        а не только в Node. Контекст намеренно голый.
     2. Windows-ветка осталась прежней: локальные .srs, правила по процессам.
     3. iOS-ветка отличается ровно в трёх местах и больше нигде.
     4. Если рядом лежит бинарь sing-box, оба конфига проверяются им по-настоящему.

   Зависимостей нет — запускается сразу: node scripts/check-platforms.mjs
   Бандл должен быть свежим: node scripts/build-shared-js.mjs */

import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(ROOT, 'ios', 'PrismCore', 'Sources', 'PrismCore', 'Resources', 'shared.js')
const SING_BOX = join(ROOT, 'resources', 'core', 'mac', 'sing-box')

let failed = 0
const check = (label, ok, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${note ? ` — ${note}` : ''}`)
  if (!ok) failed++
}

/* ─────────── загрузка бандла в среду без веб-API ─────────── */

if (!existsSync(BUNDLE)) {
  console.error('нет ios/PrismCore/.../shared.js — собери: node scripts/build-shared-js.mjs')
  process.exit(1)
}

// Object.create(null) вместо {} — ни прототипа, ни единого хостового объекта:
// ровно то, что даёт JSContext на старте.
const ctx = vm.createContext(Object.create(null))
vm.runInContext(readFileSync(BUNDLE, 'utf8'), ctx, { filename: 'shared.js' })

console.log('--- бандл в среде без веб-API ---')
check('PrismShared определён', typeof ctx.PrismShared === 'object' && ctx.PrismShared !== null)

const LINKS = [
  'vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=VXFVG7CC-NQrdWhsTwvc830w5RpYGbFXb_4tgNTB2Dg&sid=a1b2&type=tcp&flow=xtls-rprx-vision#Reality',
  'vmess://eyJ2IjoiMiIsInBzIjoiVk1lc3MgV1MiLCJhZGQiOiJleGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjExMTExMTExLTIyMjItMzMzMy00NDQ0LTU1NTU1NTU1NTU1NSIsImFpZCI6IjAiLCJzY3kiOiJhdXRvIiwibmV0Ijoid3MiLCJ0eXBlIjoibm9uZSIsImhvc3QiOiJjZG4uZXhhbXBsZS5jb20iLCJwYXRoIjoiL3ZtIiwidGxzIjoidGxzIn0=',
  'trojan://hunter2@example.com:443?security=tls&sni=example.com&type=grpc&serviceName=grpcsvc#Trojan',
  'ss://YWVzLTI1Ni1nY206aHVudGVyMg==@example.com:8388#SS',
  'hysteria2://hunter2@example.com:443?sni=example.com#HY2',
  'tuic://11111111-2222-3333-4444-555555555555:hunter2@example.com:443?sni=example.com&congestion_control=bbr#TUIC'
]

const APP_RULES = [
  { id: 'a1', exe: 'Discord.exe', name: 'Discord', action: 'proxy', enabled: true },
  { id: 'a2', exe: 'Steam.exe', name: 'Steam', action: 'direct', enabled: true }
]

ctx.__links = LINKS
ctx.__appRules = APP_RULES

const nodesJson = vm.runInContext(
  `JSON.stringify(__links.map((l, i) => {
     const p = PrismShared.parseLink(l);
     return p ? PrismShared.parsedToNode(p, { id: 'n' + i, createdAt: 0 }) : null;
   }))`,
  ctx
)
const parsed = JSON.parse(nodesJson)
check('все ссылки разобраны', parsed.every(Boolean), `${parsed.filter(Boolean).length} из ${LINKS.length}`)
check('кириллица и base64 живы', parsed[1]?.name === 'VMess WS')

const build = (platform, rulesDir = join(ROOT, 'resources', 'rules')) => {
  ctx.__platform = platform
  ctx.__rulesDir = rulesDir
  return JSON.parse(
    vm.runInContext(
      `JSON.stringify(PrismShared.buildConfig({
         settings: PrismShared.DEFAULT_SETTINGS,
         nodes: JSON.parse(${JSON.stringify(nodesJson)}),
         activeNodeId: 'n0',
         appRules: __appRules,
         customRules: [],
         enabledPresets: PrismShared.DEFAULT_ENABLED_PRESETS,
         platform: __platform,
         rulesDir: __rulesDir,
         cachePath: '/tmp/prism-cache.db',
         clashSecret: 'secret'
       }))`,
      ctx
    )
  )
}

const win = build(undefined) // без platform — поведение по умолчанию, как было всегда
// iOS собирается без каталога правил — там их пока не кладут в приложение
const ios = build('ios', '')
const android = build('android')

/* ─────────── Windows-ветка ─────────── */

console.log('\n--- Windows-ветка ---')
const winSets = win.route.rule_set
const winProc = win.route.rules.filter((r) => r.process_name)
check('правила подключены локально', winSets.length > 0 && winSets.every((r) => r.type === 'local'), `${winSets.length} шт.`)
check('у каждого есть путь к файлу', winSets.every((r) => typeof r.path === 'string' && r.path.endsWith('.srs')))
check('маршрутизация по процессам работает', winProc.length > 0, `${winProc.length} правил`)
check('strict_route выставлен', win.inbounds.find((i) => i.type === 'tun')?.strict_route !== undefined)

/* ─────────── iOS-ветка ─────────── */

console.log('\n--- iOS-ветка ---')
const iosTun = ios.inbounds.find((i) => i.type === 'tun')
const iosSets = ios.route.rule_set
check('tun-инбаунд есть', !!iosTun)
check('strict_route убран', iosTun && !('strict_route' in iosTun))
check('auto_route сохранён', iosTun?.auto_route === win.inbounds.find((i) => i.type === 'tun')?.auto_route)
check('правила по процессам убраны', ios.route.rules.filter((r) => r.process_name).length === 0)
check('правил не осталось без условий', ios.route.rules.every((r) => Object.keys(r).some((k) => k !== 'outbound' && k !== 'action' && k !== 'method')))
check('правила подключены удалённо', iosSets.length > 0 && iosSets.every((r) => r.type === 'remote'), `${iosSets.length} шт.`)
check('локальных путей не осталось', iosSets.every((r) => !('path' in r)))
check('адреса ведут на апстрим', iosSets.every((r) => /^https:\/\/raw\.githubusercontent\.com\/SagerNet\//.test(r.url)))
check('качаются напрямую, а не через прокси', iosSets.every((r) => r.download_detour === 'direct'))

/* ─────────── платформы расходятся только там, где должны ─────────── */

console.log('\n--- за пределами трёх развилок платформы совпадают ---')
const withoutProc = (c) => c.route.rules.filter((r) => !r.process_name)
check('outbounds', JSON.stringify(win.outbounds) === JSON.stringify(ios.outbounds))
check('dns', JSON.stringify(win.dns) === JSON.stringify(ios.dns))
check('route.rules', JSON.stringify(withoutProc(win)) === JSON.stringify(withoutProc(ios)))
check('набор правил тот же', JSON.stringify(winSets.map((r) => r.tag)) === JSON.stringify(iosSets.map((r) => r.tag)))
check('experimental', JSON.stringify(win.experimental) === JSON.stringify(ios.experimental))

/* ─────────── android совпадает с ios ─────────── */

console.log('\n--- android отличается от ios только источником правил ---')
const androidSets = android.route.rule_set
check('на android правила локальные', androidSets.every((r) => r.type === 'local'), `${androidSets.length} шт.`)
const withoutSets = (c) => JSON.stringify({ ...c, route: { ...c.route, rule_set: null } })
check('всё остальное совпадает', withoutSets(ios) === withoutSets(android))

/* ─────────── подписки ─────────── */

console.log('\n--- разбор подписок (общий код для обеих платформ) ---')

const LINK_LIST = [
  'trojan://hunter2@a.example.com:443?security=tls&sni=a.example.com#Первый',
  '# комментарий, его надо пропустить',
  'ss://YWVzLTI1Ni1nY206aHVudGVyMg==@b.example.com:8388#Второй'
].join('\n')

const subNodes = (body, withYaml) => {
  ctx.__body = body
  ctx.__withYaml = !!withYaml
  return JSON.parse(
    vm.runInContext(
      `JSON.stringify(PrismShared.parseSubscriptionBody(__body, 'sub-1', __withYaml ? function (t) {
         // Заглушка вместо настоящего YAML: разбирает только строки вида «- {a: b, c: d}»
         var proxies = [];
         t.split('\\n').forEach(function (line) {
           var m = line.match(/^\\s*-\\s*\\{(.+)\\}\\s*$/);
           if (!m) return;
           var o = {};
           m[1].split(',').forEach(function (pair) {
             var kv = pair.split(':');
             if (kv.length >= 2) o[kv[0].trim()] = kv.slice(1).join(':').trim();
           });
           proxies.push(o);
         });
         return { proxies: proxies };
       } : undefined))`,
      ctx
    )
  )
}

const plain = subNodes(LINK_LIST)
check('список ссылок', plain.length === 2, `${plain.length} узла`)
check('комментарии пропущены', !plain.some((n) => n.name.includes('коммент')))
check('привязка к подписке', plain.every((n) => n.subscriptionId === 'sub-1'))
check('исходная ссылка сохранена', plain.every((n) => typeof n.link === 'string'))

const b64 = subNodes(Buffer.from(LINK_LIST, 'utf8').toString('base64'))
check('тот же список в base64', JSON.stringify(b64.map((n) => n.name)) === JSON.stringify(plain.map((n) => n.name)))

const singbox = subNodes(JSON.stringify({
  outbounds: [
    { type: 'selector', tag: 'proxy', outbounds: ['a'] },
    { type: 'direct', tag: 'direct' },
    { type: 'trojan', tag: 'Из JSON', server: 'c.example.com', server_port: 443, password: 'hunter2' }
  ]
}))
check('конфиг sing-box', singbox.length === 1 && singbox[0].name === 'Из JSON', `${singbox.length} узел`)
check('служебные outbound пропущены', !singbox.some((n) => ['selector', 'direct'].includes(n.type)))

const CLASH = 'proxies:\n  - {name: Из YAML, type: trojan, server: d.example.com, port: 443, password: hunter2}\n'
check('Clash YAML с парсером (как в Electron)', subNodes(CLASH, true).length === 1)
check('Clash YAML без парсера не роняет (как на iOS)', subNodes(CLASH, false).length === 0)
check('пустое тело', subNodes('').length === 0)
check('мусор', subNodes('это просто текст без ссылок').length === 0)

/* ─────────── проверка настоящим ядром ─────────── */

console.log('\n--- проверка бинарём sing-box ---')
if (!existsSync(SING_BOX)) {
  console.log('  ⚠ resources/core/mac/sing-box отсутствует, пропущено')
  console.log('    поставить: node scripts/fetch-resources.mjs')
} else {
  const dir = mkdtempSync(join(tmpdir(), 'prism-platforms-'))
  for (const [name, cfg] of [['windows', win], ['ios', ios]]) {
    const file = join(dir, `${name}.json`)
    writeFileSync(file, JSON.stringify(cfg, null, 2))
    try {
      execFileSync(SING_BOX, ['check', '-c', file], { stdio: 'pipe' })
      check(`конфиг ${name} принят ядром`, true)
    } catch (e) {
      const msg = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim().split('\n')[0] || String(e.message)
      check(`конфиг ${name} принят ядром`, false, msg)
    }
  }
}

console.log(failed ? `\nпровалено проверок: ${failed}` : '\nвсё сошлось')
process.exit(failed ? 1 : 0)
