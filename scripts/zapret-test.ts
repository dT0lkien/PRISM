/* Проверка zapret без Windows: разбор стратегий, списки, hosts, установка сборки.
   winws.exe здесь не запустить, зато всё, что готовит ему аргументы и файлы,
   гоняется на настоящем релизе Flowseal — если сборка поменяет формат, тест
   это заметит раньше пользователей. */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deflateRawSync } from 'node:zlib'
import {
  DEFAULT_ZAPRET,
  EXTRA_DOMAINS,
  IPSET_PLACEHOLDER,
  cleanList,
  compareStrategies,
  expandStrategy,
  formatReport,
  hostsAllowed,
  hostsStatus,
  ipsetContent,
  mergeHosts,
  TEST_SERVICES,
  formatServicesReport,
  parseStrategy,
  pickBest,
  serviceStatus,
  removeHostsBlock,
  strategyLabel,
  summarizeStrategy,
  toCommandLine
} from '../src/shared/zapret'
import { unzip } from '../src/main/unzip'
import { store } from '../src/main/store'
import { zapret, zapretPaths } from '../src/main/zapret'
import type { ZapretServiceResult, ZapretStrategyResult } from '../src/shared/types'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  cond ? pass++ : fail++
}
const throws = (fn: () => unknown): boolean => {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

/* ─── маленький zip-писатель: deflate, без зависимостей ─── */
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (b: Buffer): number => {
  let c = 0xffffffff
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function zip(files: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let off = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content)
    const comp = deflateRawSync(data)
    const n = Buffer.from(name)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(8, 8)
    lh.writeUInt32LE(crc32(data), 14)
    lh.writeUInt32LE(comp.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(n.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(8, 10)
    ch.writeUInt32LE(crc32(data), 16)
    ch.writeUInt32LE(comp.length, 20)
    ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(n.length, 28)
    ch.writeUInt32LE(off, 42)
    locals.push(lh, n, comp)
    central.push(ch, n)
    off += 30 + n.length + comp.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(off, 16)
  return Buffer.concat([...locals, cd, end])
}

async function main(): Promise<void> {
  /* Второй процесс для проверки на Windows: так моделируется новый запуск
     Prism, который заново настраивает права на уже установленную сборку */
  if (process.env.ZAPRET_TEST_REOPEN) {
    store.load()
    await zapret.init()
    process.exit(0)
  }
  /* ─────────────────────────── разбор стратегии ─────────────────────────── */

  console.log('\n▸ Разбор bat-файла стратегии')
  const BAT = [
    '@echo off',
    'set "BIN=%~dp0bin\\"',
    'start "zapret: %~n0" /min "%BIN%winws.exe" --wf-tcp=80,443,%GameFilterTCP% --wf-udp=443,%GameFilterUDP% ^',
    '--filter-udp=443 --hostlist="%LISTS%list-general.txt" --dpi-desync=fake --dpi-desync-fake-quic="%BIN%quic_initial_www_google_com.bin" --new ^',
    '--filter-tcp=443 --dpi-desync=fake,multisplit --dpi-desync-fooling=ts --dpi-desync-fake-tls=^! --new ^',
    '--filter-udp=%GameFilterUDP% --dpi-desync-fake-unknown-udp="%BIN%ACTIVE_GAME_UDP.bin"',
    'echo done'
  ].join('\r\n')
  const args = parseStrategy(BAT)!
  ok('аргументы найдены', !!args && args.length === 14, `${args?.length} шт.`)
  ok('переносы строк ^ склеены, echo не попал', !args.some((a) => a.includes('echo')))
  ok('кавычки сняты', args.includes('--hostlist=%LISTS%list-general.txt'))
  ok('^! раскрыт в !', args.includes('--dpi-desync-fake-tls=!'))
  ok('описание берёт только TCP-секции', summarizeStrategy(args) === 'fake + multisplit · ts', summarizeStrategy(args))
  ok('без winws.exe — null', parseStrategy('@echo off\r\necho hi') === null)

  console.log('\n▸ Подстановка путей и портов')
  const ctx = { bin: 'C:\\Z\\bin\\', lists: 'C:\\Z\\run\\', gameFilter: 'off' as const }
  const off = expandStrategy(args, ctx)
  ok('игры выключены — порт-заглушка 12', off[0] === '--wf-tcp=80,443,12' && off.includes('--filter-udp=12'))
  const all = expandStrategy(args, { ...ctx, gameFilter: 'tcp', fakeGame: 'stun' })
  ok('игры по TCP — 1024-65535 только для TCP', all[0] === '--wf-tcp=80,443,1024-65535' && all[1] === '--wf-udp=443,12')
  ok('фейк для игр подменён', all.includes('--dpi-desync-fake-unknown-udp=C:\\Z\\bin\\stun.bin'))
  ok('пути подставлены', off.includes('--hostlist=C:\\Z\\run\\list-general.txt'))
  ok('неизвестная переменная — ошибка', throws(() => expandStrategy(['--x=%SECRET%'], ctx)))
  ok('кавычка в аргументе — ошибка', throws(() => expandStrategy(['--x="a"'], ctx)))
  ok('командная строка службы', toCommandLine(['--a=1', '--b=C:\\Program Data\\x.txt']) === '--a=1 "--b=C:\\Program Data\\x.txt"')

  console.log('\n▸ Порядок и подписи')
  const order = ['general (ALT10)', 'general', 'general (ALT2)', 'general (ALT)'].sort(compareStrategies)
  ok('ALT2 раньше ALT10', order.join('|') === 'general|general (ALT)|general (ALT2)|general (ALT10)', order.join(', '))
  ok('подпись стратегии', strategyLabel('general (FAKE TLS AUTO ALT2)') === 'FAKE TLS AUTO ALT2' && strategyLabel('general') === 'general')

  /* ─────────────────────────── списки ─────────────────────────── */

  console.log('\n▸ Свои списки')
  const doms = cleanList(['https://Example.com/path', 'bad domain', '^dns.google', 'example.com', '', 42, 'домен.рф'], 'domain')
  ok('домены почищены и без повторов', doms.join(',') === 'example.com,^dns.google,домен.рф', doms.join(', '))
  const ips = cleanList(['10.0.0.0/8', '1.2.3.4', 'nope', '2001:db8::/32', IPSET_PLACEHOLDER], 'ip')
  ok('адреса почищены, заглушка не пролезает', ips.join(',') === '10.0.0.0/8,1.2.3.4,2001:db8::/32', ips.join(', '))
  ok('ipset none — только заглушка', ipsetContent('none', ['1.1.1.1'], ['2.2.2.2']).join() === IPSET_PLACEHOLDER)
  ok('ipset any — пустой файл', ipsetContent('any', ['1.1.1.1'], []).length === 0)
  ok('ipset loaded — список и свои адреса', ipsetContent('loaded', ['1.1.1.1'], ['2.2.2.2']).join() === '1.1.1.1,2.2.2.2')
  ok('ipset loaded без адресов — не пустой', ipsetContent('loaded', [], []).join() === IPSET_PLACEHOLDER)

  /* ─────────────────────────── hosts ─────────────────────────── */

  console.log('\n▸ Файл hosts')
  const entries = ['149.154.167.220 web.telegram.org', '162.159.138.232 discord.com']
  const userHosts = '# мой hosts\r\n127.0.0.1 localhost\r\n1.2.3.4 web.telegram.org\r\n'
  const st0 = hostsStatus(userHosts, entries)
  ok('видно, чего не хватает, и устаревшую строку', st0.missing === 2 && st0.stale === 1 && !st0.managed, JSON.stringify(st0))
  const merged = mergeHosts(userHosts, entries)
  const st1 = hostsStatus(merged, entries)
  ok('после обновления актуален', st1.upToDate && st1.managed, JSON.stringify(st1))
  ok('строки пользователя на месте', merged.includes('127.0.0.1 localhost') && merged.includes('# мой hosts'))
  ok('старая строка для того же имени убрана', !merged.includes('1.2.3.4 web.telegram.org'))
  ok('повторное обновление ничего не множит', mergeHosts(merged, entries) === merged)
  const removed = removeHostsBlock(merged)
  ok('блок Prism убирается целиком', !removed.includes('discord.com') && removed.includes('127.0.0.1 localhost'))
  const allowed = [
    '149.154.167.220 web.telegram.org',
    '140.82.121.3 github.com',
    '146.75.22.132 raw.githubusercontent.com',
    '162.159.138.232 discord.com'
  ]
  const foreign = ['6.6.6.6 online.sberbank.ru', '6.6.6.6 update.microsoft.com', '6.6.6.6 evilgithub.com', '6.6.6.6 github.com.evil.ru']
  ok('Telegram, Discord и GitHub в hosts пускаются', allowed.every(hostsAllowed))
  ok('чужие домены и подделки под свои — нет', !foreign.some(hostsAllowed), foreign.filter(hostsAllowed).join(', '))

  /* ─────────────────────────── тест стратегий ─────────────────────────── */

  console.log('\n▸ Итоги теста: DPI-чекеры')
  const res = (strategy: string, okN: number, pingOk: number, started = true): ZapretStrategyResult => ({
    strategy, started, ok: okN, error: 36 - okN, unsup: 0, blocked: 0, pingOk, pingFail: 4 - pingOk, targets: []
  })
  ok('лучшая — больше успехов', pickBest([res('a', 20, 4), res('b', 30, 1), res('c', 99, 4, false)]) === 'b')
  ok('ни одной рабочей — нет лучшей', pickBest([res('a', 0, 4)]) === undefined)
  ok('отчёт в формате утилиты сборки', formatReport('dpi', [res('general', 30, 4)], 'general').includes('Best strategy: general.bat'))

  console.log('\n▸ Итоги теста: доступность сервисов')
  const sv = (id: string, okN: number, total: number, ms = 300, any = false): ZapretServiceResult => ({
    id, ok: okN, total, ms: okN ? ms : undefined, status: serviceStatus(okN, total, any), error: okN < total ? 'таймаут' : undefined,
    checks: Array.from({ length: total }, (_, i) => ({ target: `${id}-${i}`, ok: i < okN, ms: i < okN ? ms : undefined, error: i < okN ? undefined : 'таймаут' }))
  })
  const withServices = (strategy: string, services: ZapretServiceResult[], started = true): ZapretStrategyResult => ({
    ...res(strategy, 0, 0, started), services, ok: services.reduce((a, x) => a + x.ok, 0)
  })
  ok('сервис: всё прошло — открывается', serviceStatus(3, 3) === 'ok')
  ok('сервис: часть — частично', serviceStatus(1, 3) === 'partial')
  ok('приложению Telegram хватит одного дата-центра', serviceStatus(1, 3, true) === 'ok')
  ok('сервис: ничего — не открывается', serviceStatus(0, 3) === 'fail')
  ok('каждый сервис из списка проверяется', TEST_SERVICES.every((x) => x.checks.length > 0) && TEST_SERVICES.some((x) => x.id === 'telegram-app'))
  const a = withServices('general (A)', [sv('youtube', 3, 3), sv('discord', 3, 3), sv('telegram-web', 0, 3)])
  const b = withServices('general (B)', [sv('youtube', 3, 3), sv('discord', 2, 3), sv('telegram-web', 3, 3)])
  const c = withServices('general (C)', [sv('youtube', 3, 3), sv('discord', 3, 3), sv('telegram-web', 3, 3)], false)
  ok('лучшая — больше открывшихся сервисов', pickBest([a, b, c]) === 'general (B)', pickBest([a, b, c]))
  const fast = withServices('general (F)', [sv('youtube', 3, 3, 100), sv('discord', 3, 3, 100)])
  const slow = withServices('general (S)', [sv('youtube', 3, 3, 900), sv('discord', 3, 3, 900)])
  ok('при равенстве — быстрее', pickBest([slow, fast]) === 'general (F)')
  ok('не открылось ничего — лучшей нет', pickBest([withServices('general (Z)', [sv('youtube', 0, 3)])]) === undefined)
  const report = formatServicesReport([sv('youtube', 0, 3)], [b], 'general (B)')
  ok('отчёт: без обхода, лучшая и подробности', report.includes('Без обхода: YouTube — нет') && report.includes('Лучшая стратегия: B') && report.includes('discord-2: нет — таймаут'))

  /* ─────────────────────────── установка сборки ─────────────────────────── */

  console.log('\n▸ Установка сборки из архива')
  const packFiles = (v: string, extra: Record<string, string> = {}): Record<string, string | Buffer> => ({
    [`zapret-discord-youtube-${v}/service.bat`]: `@echo off\r\nset "LOCAL_VERSION=${v}"\r\n`,
    [`zapret-discord-youtube-${v}/general.bat`]: BAT,
    [`zapret-discord-youtube-${v}/general (ALT2).bat`]: BAT.replace('multisplit', 'multidisorder'),
    [`zapret-discord-youtube-${v}/bin/winws.exe`]: 'MZ',
    [`zapret-discord-youtube-${v}/bin/WinDivert.dll`]: 'x',
    [`zapret-discord-youtube-${v}/bin/WinDivert64.sys`]: 'x',
    [`zapret-discord-youtube-${v}/bin/cygwin1.dll`]: 'x',
    [`zapret-discord-youtube-${v}/bin/stun.bin`]: 'STUN',
    [`zapret-discord-youtube-${v}/bin/quic_initial_www_google_com.bin`]: 'QUIC',
    [`zapret-discord-youtube-${v}/bin/ACTIVE_GAME_UDP.bin`]: 'STUN',
    [`zapret-discord-youtube-${v}/lists/list-general.txt`]: 'discord.com\r\n',
    [`zapret-discord-youtube-${v}/lists/list-google.txt`]: 'youtube.com\r\n',
    [`zapret-discord-youtube-${v}/lists/list-exclude.txt`]: 'ya.ru\r\n',
    [`zapret-discord-youtube-${v}/lists/ipset-exclude.txt`]: '10.0.0.0/8\r\n',
    [`zapret-discord-youtube-${v}/lists/ipset-all.txt`]: `${IPSET_PLACEHOLDER}\r\n`,
    [`zapret-discord-youtube-${v}/lists/ipset-all.txt.backup`]: '1.1.1.0/24\r\n8.8.8.0/24\r\n',
    ...extra
  })

  const work = mkdtempSync(join(tmpdir(), 'prism-zapret-zip-'))
  const arc = unzip(zip({ 'a.txt': 'привет', 'dir/b.bin': Buffer.from([0, 1, 2]) }))
  ok('распаковка zip', arc.get('a.txt')?.toString() === 'привет' && arc.get('dir/b.bin')?.length === 3)
  /* zip-бомба: 16 МБ нулей, а в центральном каталоге записано «16 байт».
     Без потолка inflate развернул бы всё и лишь потом сверил бы размер */
  const bomb = zip({ 'zeros.bin': Buffer.alloc(16 * 1024 * 1024) })
  const cd = bomb.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  bomb.writeUInt32LE(16, cd + 24)
  let bombErr = ''
  try {
    unzip(bomb)
  } catch (e) {
    bombErr = (e as Error).message
  }
  ok('zip-бомба с заниженным размером отвергнута', bombErr === 'Архив повреждён', bombErr || 'распаковалась')

  store.load()
  const good = join(work, 'good.zip')
  writeFileSync(good, zip(packFiles('9.9.1', { 'zapret-discord-youtube-9.9.1/../../evil.txt': 'x', 'zapret-discord-youtube-9.9.1/bin/sub/deep.exe': 'x' })))
  await zapret.installFromFile(good)
  let s = zapret.getState()
  ok('сборка установлена', s.pack?.version === '9.9.1', s.pack?.version)
  ok('стратегии прочитаны', s.pack?.strategies.map((x) => x.label).join() === 'general,ALT2')
  ok('активный фейк узнан по содержимому', s.pack?.defaultFakeGame === 'stun', s.pack?.defaultFakeGame)
  ok('ipset из .backup, раз в основном заглушка', s.pack?.lists.ipset === 2, String(s.pack?.lists.ipset))
  ok('опасные имена из архива не распакованы', !existsSync(join(zapretPaths.root, 'evil.txt')) && !existsSync(join(zapretPaths.packs, '9.9.1', 'bin', 'sub')))

  const bad = join(work, 'bad.zip')
  writeFileSync(bad, zip({ 'x/service.bat': 'set "LOCAL_VERSION=1.0"', 'x/general.bat': BAT }))
  let err = ''
  await zapret.installFromFile(bad).catch((e: Error) => (err = e.message))
  ok('неполная сборка отвергнута', /нет bin/.test(err), err)
  ok('прежняя сборка осталась активной', zapret.getState().pack?.version === '9.9.1')

  writeFileSync(good, zip(packFiles('9.9.2')))
  await zapret.installFromFile(good)
  ok('новая версия заменила старую', zapret.getState().pack?.version === '9.9.2' && readdirSync(zapretPaths.packs).join() === '9.9.2', readdirSync(zapretPaths.packs).join())

  console.log('\n▸ Рабочие списки')
  const run = join(work, 'run')
  const internal = zapret as unknown as {
    pack: unknown
    materialize: (dir: string, pack: unknown, cfg: typeof DEFAULT_ZAPRET, mode?: string) => void
    args: (pack: unknown, id: string, cfg: typeof DEFAULT_ZAPRET, dir: string) => string[]
  }
  const cfg = { ...DEFAULT_ZAPRET, ipsetMode: 'loaded' as const, lists: { ...DEFAULT_ZAPRET.lists, ipset: ['5.5.5.5'], general: ['мой.example'] } }
  internal.materialize(run, internal.pack, cfg)
  const rd = (f: string): string => readFileSync(join(run, f), 'utf8')
  const general = (): string[] => rd('list-general-user.txt').trim().split(/\r?\n/)
  ok('домены Prism и свои — в одном списке', EXTRA_DOMAINS.every((d) => general().includes(d)) && general().includes('мой.example'), general().join(', '))
  internal.materialize(run, internal.pack, { ...cfg, extraDomains: false })
  ok('переключатель выключен — только свои домены', general().join(',') === 'мой.example', general().join(', '))
  internal.materialize(run, internal.pack, { ...cfg, extraDomains: false, lists: { ...cfg.lists, general: [] } })
  ok('пустой свой список — не пустой файл', rd('list-general-user.txt').includes('domain.example.abc'))
  internal.materialize(run, internal.pack, cfg)
  ok('ipset по списку со своими адресами', rd('ipset-all.txt') === '1.1.1.0/24\r\n8.8.8.0/24\r\n5.5.5.5\r\n', JSON.stringify(rd('ipset-all.txt')))
  internal.materialize(run, internal.pack, cfg, 'any')
  ok('ipset any — ноль байт', rd('ipset-all.txt') === '')
  const argv = internal.args(internal.pack, 'general', cfg, run)
  ok('аргументы ссылаются на рабочие списки', argv.includes(`--hostlist=${join(run, 'list-general.txt')}`))

  /* ─────────────────────────── настоящий релиз ─────────────────────────── */

  console.log('\n▸ Последний релиз Flowseal/zapret-discord-youtube')
  try {
    const api = await fetch('https://api.github.com/repos/Flowseal/zapret-discord-youtube/releases/latest', {
      headers: { 'user-agent': 'Prism-test', accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20000)
    })
    if (!api.ok) throw new Error(`GitHub ответил ${api.status}`)
    const rel = (await api.json()) as { tag_name: string; assets: { name: string; browser_download_url: string; digest?: string }[] }
    const asset = rel.assets.find((a) => a.name.endsWith('.zip'))!
    const buf = Buffer.from(await (await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(120000) })).arrayBuffer())
    const digest = asset.digest?.replace(/^sha256:/, '')
    ok(`контрольная сумма ${rel.tag_name} сходится с GitHub`, !!digest && createHash('sha256').update(buf).digest('hex') === digest)

    const file = join(work, 'real.zip')
    writeFileSync(file, buf)
    await zapret.installFromFile(file)
    s = zapret.getState()
    ok('версия прочитана из service.bat', s.pack?.version === rel.tag_name, s.pack?.version)
    ok('стратегии разобраны', (s.pack?.strategies.length ?? 0) >= 10, `${s.pack?.strategies.length} шт.`)
    ok('у фейков есть активные по умолчанию', !!s.pack?.defaultFakeDiscord && !!s.pack?.defaultFakeGame, `${s.pack?.defaultFakeDiscord}, ${s.pack?.defaultFakeGame}`)
    ok('IPSet не пустой', (s.pack?.lists.ipset ?? 0) > 1000, String(s.pack?.lists.ipset))

    internal.materialize(run, internal.pack, DEFAULT_ZAPRET)
    const broken: string[] = []
    for (const st of s.pack!.strategies) {
      for (const gameFilter of ['off', 'all'] as const) {
        try {
          const a = internal.args(internal.pack, st.id, { ...DEFAULT_ZAPRET, gameFilter, fakeDiscord: s.pack!.fakes[0] }, run)
          // Каждый файл, на который ссылается стратегия, должен существовать
          for (const x of a) {
            const f = x.match(/=(.+\.(?:bin|txt))$/)?.[1]
            if (f && !existsSync(f)) broken.push(`${st.label}: ${f}`)
          }
          if (a.some((x) => !x.startsWith('--'))) broken.push(`${st.label}: аргумент без --`)
        } catch (e) {
          broken.push(`${st.label}: ${(e as Error).message}`)
        }
      }
    }
    ok('все стратегии собираются в аргументы, файлы на месте', broken.length === 0, broken.slice(0, 3).join('; '))

    if (process.platform === 'win32') {
      /* В 1.6.0 повторная настройка прав оставляла файлы сборки с пустым
         списком доступа, и winws.exe не запускался даже от администратора */
      console.log('\n▸ Windows: winws.exe запускается после повторного запуска Prism')
      const again = spawnSync(process.execPath, [process.argv[1]], {
        env: { ...process.env, ZAPRET_TEST_REOPEN: '1' },
        encoding: 'utf8',
        timeout: 120_000
      })
      ok('повторный запуск прошёл', again.status === 0, `${again.stderr ?? ''}`.trim().split('\n')[0])
      const exe = join(zapretPaths.packs, s.pack!.version, 'bin', 'winws.exe')
      const r = spawnSync(exe, ['--help'], { timeout: 3000, windowsHide: true })
      const code = (r.error as NodeJS.ErrnoException | undefined)?.code
      ok('winws.exe запускается', code !== 'EPERM' && code !== 'EACCES', code ?? 'без ошибок запуска')
    }
  } catch (e) {
    console.log(`  ⚠ пропущено: ${(e as Error).message}`)
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} итог: ${pass} ок, ${fail} провалено`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
