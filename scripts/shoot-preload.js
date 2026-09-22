/* Подставной мост для снятия скриншотов интерфейса без реального ядра. */

const cbs = {}
const on = (name) => (cb) => {
  ;(cbs[name] ??= []).push(cb)
  return () => {}
}
const fire = (name, v) => (cbs[name] ?? []).forEach((cb) => cb(v))
// для тестов: возможность подать событие состояния снаружи
window.__fireState = (v) => fire('state', v)

const updateState = {
  status: 'available',
  version: '1.2.0',
  checkedAt: Date.now() - 90_000,
  notes: 'Ускорено переключение серверов на лету.\nИсправлен разрыв UDP при смене сети.\nДобавлен экспорт правил маршрутизации.'
}

const node = (id, name, type, server, port, latency, sub) => ({
  id,
  name,
  type,
  server,
  port,
  latency,
  outbound: {},
  subscriptionId: sub,
  createdAt: Date.now()
})

const nodes = [
  node('n1', 'Нидерланды · Амстердам', 'vless', 'ams-01.example.net', 443, 42, 's1'),
  node('n2', 'Германия · Франкфурт', 'vless', 'fra-02.example.net', 443, 58, 's1'),
  node('n3', 'Финляндия · Хельсинки', 'trojan', 'hel-01.example.net', 8443, 31, 's1'),
  node('n4', 'Швеция · Стокholm', 'hysteria2', 'sto-01.example.net', 443, 71, 's1'),
  node('n5', 'США · Нью-Йорк', 'vmess', 'nyc-04.example.net', 443, 154, 's1'),
  node('n6', 'Япония · Токио', 'tuic', 'tyo-01.example.net', 443, 236, undefined),
  node('n7', 'Личный сервер', 'vless', '203.0.113.42', 2053, -1, undefined)
]

const settings = {
  captureMode: 'tun',
  routingMode: 'smart',
  localPort: 2080,
  allowLan: false,
  clashPort: 9291,
  tun: { stack: 'mixed', mtu: 9000, autoRoute: true, strictRoute: true, ipv6: false },
  dns: {
    remote: 'https://1.1.1.1/dns-query',
    local: '77.88.8.8',
    strategy: 'prefer_ipv4',
    fakeIp: false,
    blockAds: false,
    splitDns: true
  },
  discordFix: true,
  blockQuic: true,
  bypassPrivate: true,
  autoStart: true,
  autoConnect: false,
  startElevated: true,
  minimizeToTray: true,
  closeToTray: true,
  startMinimized: false,
  theme: process.env.PRISM_THEME || 'dark',
  accent: 'aurora',
  graphStyle: process.env.PRISM_GRAPH || 'mirror',
  language: 'ru',
  logLevel: 'info',
  extraConfig: ''
}

const zapretConfig = {
  strategy: 'general (ALT5)',
  gameFilter: 'off',
  ipsetMode: 'loaded',
  fakeDiscord: '',
  fakeGame: '',
  extraDomains: true,
  autoStart: true,
  checkUpdates: true,
  lists: { general: ['example-blocked.com', 'static.example-blocked.net'], exclude: [], ipset: [], ipsetExclude: [] }
}

const snapshot = {
  zapret: zapretConfig,
  settings,
  nodes,
  subscriptions: [
    {
      id: 's1',
      name: 'my-provider.net',
      url: 'https://my-provider.net/sub/abc',
      autoUpdate: true,
      intervalHours: 12,
      updatedAt: Date.now() - 3_600_000,
      userInfo: {
        upload: 4.2e9,
        download: 61.7e9,
        total: 200e9,
        expire: Math.floor(Date.now() / 1000) + 86400 * 47
      }
    }
  ],
  appRules: [
    { id: 'a1', exe: 'Discord.exe', name: 'Discord', action: 'proxy', enabled: true, path: 'C:\\Users\\me\\AppData\\Local\\Discord\\app-1.0.9\\Discord.exe' },
    { id: 'a2', exe: 'chrome.exe', name: 'Google Chrome', action: 'proxy', enabled: true },
    { id: 'a3', exe: 'steam.exe', name: 'Steam', action: 'direct', enabled: true },
    { id: 'a4', exe: 'qbittorrent.exe', name: 'qBittorrent', action: 'direct', enabled: true },
    { id: 'a5', exe: 'Telemetry.exe', name: 'Телеметрия', action: 'block', enabled: true }
  ],
  customRules: [
    {
      id: 'r1',
      name: 'Рабочие сервисы мимо VPN',
      enabled: true,
      action: 'direct',
      matchers: [{ kind: 'domain_suffix', values: ['corp.example.com', 'vpn.work.local'] }]
    },
    {
      id: 'r2',
      name: 'Голосовые порты Discord',
      enabled: true,
      action: 'proxy',
      matchers: [
        { kind: 'port_range', values: ['50000:65535'] },
        { kind: 'network', values: ['udp'] }
      ]
    }
  ],
  enabledPresets: ['discord-fix', 'telegram', 'media', 'ai', 'social', 'ru-bypass', 'games-direct', 'torrent-direct'],
  activeNodeId: 'n3',
  totals: { up: 3.4e9, down: 58.1e9 }
}

const conn = (id, process, host, ip, port, network, outbound, up, down, rule, ago) => ({
  id,
  host,
  ip,
  port,
  network,
  process,
  processPath: `C:\\Program Files\\${process}`,
  outbound,
  chains: [outbound],
  upload: up,
  download: down,
  start: Date.now() - ago,
  rule
})

const connections = [
  conn('c1', 'Discord.exe', 'gateway.discord.gg', '162.159.135.232', 443, 'tcp', 'Финляндия · Хельсинки', 412000, 2830000, 'process_name: Discord.exe', 754000),
  conn('c2', 'Discord.exe', 'russia1234.discord.media', '66.22.241.10', 50012, 'udp', 'Финляндия · Хельсинки', 8420000, 9110000, 'process_name: Discord.exe', 342000),
  conn('c3', 'chrome.exe', 'www.youtube.com', '142.250.185.78', 443, 'tcp', 'Финляндия · Хельсинки', 184000, 41200000, 'rule_set: geosite-youtube', 128000),
  conn('c4', 'chrome.exe', 'mail.yandex.ru', '77.88.21.119', 443, 'tcp', 'direct', 92000, 1240000, 'rule_set: geosite-yandex', 65000),
  conn('c5', 'steam.exe', 'steamcdn-a.akamaihd.net', '23.62.99.11', 443, 'tcp', 'direct', 41000, 128400000, 'rule_set: geosite-steam', 210000),
  conn('c6', 'Telegram.exe', 'venus.web.telegram.org', '149.154.167.99', 443, 'tcp', 'Финляндия · Хельсинки', 320000, 1810000, 'rule_set: geosite-telegram', 480000),
  conn('c7', 'Code.exe', 'update.code.visualstudio.com', '13.107.42.16', 443, 'tcp', 'Финляндия · Хельсинки', 18000, 402000, 'final', 27000),
  conn('c8', 'qbittorrent.exe', '89.22.14.201', '89.22.14.201', 51413, 'tcp', 'direct', 2140000, 640000, 'protocol: bittorrent', 900000),
  conn('c9', 'chrome.exe', 'chatgpt.com', '104.18.32.47', 443, 'tcp', 'Финляндия · Хельсинки', 74000, 980000, 'rule_set: geosite-openai', 45000),
  conn('c10', 'explorer.exe', 'v10.events.data.microsoft.com', '20.42.65.92', 443, 'tcp', 'direct', 12000, 34000, 'final', 300000)
]

const LOGS = [
  ['info', 'Запуск ядра…'],
  ['info', 'router: loaded local rule-set geosite-discord'],
  ['info', 'router: loaded local rule-set geosite-category-ru'],
  ['info', 'router: loaded local rule-set geoip-ru'],
  ['info', 'inbound/tun[tun-in]: started at prism-tun0'],
  ['info', 'inbound/mixed[mixed-in]: started at 127.0.0.1:2080'],
  ['info', 'dns: fallback to remote resolver for discord.com'],
  ['info', 'Подключено, режим TUN'],
  ['info', 'outbound/vless[Финляндия · Хельсинки]: connected to gateway.discord.gg:443'],
  ['info', 'outbound/vless[Финляндия · Хельсинки]: udp connection to russia1234.discord.media:50012'],
  ['warn', 'dns: udp query to 77.88.8.8 timed out, retrying over tcp'],
  ['info', 'router: match[12] process_name=Discord.exe => proxy'],
  ['info', 'router: match[27] rule_set=geosite-category-ru => direct'],
  ['debug', 'urltest: Финляндия · Хельсинки 31ms, Нидерланды · Амстердам 42ms'],
  ['error', 'outbound/vmess[США · Нью-Йорк]: dial tcp: i/o timeout'],
  ['info', 'router: match[8] rule_set=geosite-youtube => proxy']
]

const STRATEGIES = [
  ['general', 'multisplit'],
  ['general (ALT)', 'fake + fakedsplit · ts'],
  ['general (ALT2)', 'multisplit'],
  ['general (ALT3)', 'fake + hostfakesplit · ts'],
  ['general (ALT4)', 'fake + multisplit · badseq'],
  ['general (ALT5)', 'syndata + multidisorder'],
  ['general (ALT6)', 'multisplit'],
  ['general (ALT7)', 'multisplit + syndata'],
  ['general (ALT8)', 'fake · badseq'],
  ['general (ALT9)', 'hostfakesplit · ts, md5sig'],
  ['general (ALT10)', 'fake · ts'],
  ['general (ALT11)', 'fake + multisplit · ts'],
  ['general (ALT12)', 'fake + multisplit + hostfakesplit · ts'],
  ['general (ALT13)', 'fake + multisplit + hostfakesplit · ts'],
  ['general (EXP)', 'fake + multisplit + hostfakesplit · ts'],
  ['general (FAKE TLS AUTO)', 'fake + multidisorder · badseq'],
  ['general (FAKE TLS AUTO ALT)', 'fake + fakedsplit · badseq'],
  ['general (FAKE TLS AUTO ALT2)', 'fake + multisplit · badseq'],
  ['general (FAKE TLS AUTO ALT3)', 'fake + multisplit · ts'],
  ['general (SIMPLE FAKE)', 'fake + hostfakesplit · ts'],
  ['general (SIMPLE FAKE ALT)', 'fake · badseq'],
  ['general (SIMPLE FAKE ALT2)', 'fake · ts']
].map(([id, summary]) => ({ id, label: id.match(/\((.+)\)/)?.[1] ?? id, summary }))

const scores = Object.fromEntries(STRATEGIES.map((s, i) => [s.id, { ok: [30, 21, 29, 12, 24, 36, 27, 33, 9, 18][i % 10], total: 36 }]))

const zapretState = {
  supported: process.env.PRISM_ZAPRET !== 'mac',
  elevated: true,
  root: 'C:\\ProgramData\\Prism\\zapret',
  pack: process.env.PRISM_ZAPRET === 'empty' ? undefined : {
    version: '1.10.2',
    strategies: STRATEGIES,
    fakes: ['quic_initial_www_google_com', 'stun', 'stun2', 'tls_clienthello_www_google_com'],
    defaultFakeDiscord: 'stun',
    defaultFakeGame: 'quic_initial_4pda_to',
    lists: { general: 59, google: 20, exclude: 128, ipsetExclude: 11, ipset: 32126 },
    ipsetUpdatedAt: Date.now() - 86400_000 * 3
  },
  status: 'running',
  running: 'general (ALT5)',
  since: Date.now() - 2_710_000,
  output: [],
  service: { installed: false },
  windivert: 'Running',
  foreignWinws: 0,
  update: { latest: '1.10.2', checkedAt: Date.now() - 1_200_000 },
  lastTest: { kind: 'standard', at: Date.now() - 3600_000, best: 'general (ALT5)', scores }
}

const zapretTest = {
  running: false,
  kind: 'standard',
  total: 6,
  done: 6,
  best: 'general (ALT5)',
  results: STRATEGIES.slice(0, 6).map((s, i) => ({
    strategy: s.id,
    started: i !== 3,
    ok: i === 3 ? 0 : scores[s.id].ok,
    error: i === 3 ? 0 : 36 - scores[s.id].ok,
    unsup: 0,
    blocked: 0,
    pingOk: i === 3 ? 0 : 4,
    pingFail: 0,
    targets: []
  })),
  file: 'C:\\test_results.txt',
  finishedAt: Date.now()
}

const r = (v = {}) => async () => ({ ok: true, ...v })

window.prism = {
  bootstrap: async () => ({
    snapshot,
    state: {
      status: 'running',
      since: Date.now() - 4_517_000,
      elevated: true,
      captureMode: 'tun',
      activeNodeId: 'n3',
      systemProxyOn: false
    },
    platform: 'win32',
    elevated: true,
    isWindows: true,
    // Подставив PRISM_APP_VERSION с номером из CHANGELOG, снимем окно «что нового»
    appVersion: process.env.PRISM_APP_VERSION || '1.0.0',
    coreVersion: '1.13.15',
    autoStartTask: true
  }),
  core: {
    start: async () => ({ ok: true }),
    stop: async () => {},
    restart: async () => ({ ok: true }),
    elevate: async () => true,
    closeConnection: async () => {},
    closeAllConnections: async () => {}
  },
  settings: { update: async () => snapshot, reset: async () => snapshot },
  nodes: {
    select: async () => true,
    measure: async () => 40,
    measureAll: async () => {},
    import: async () => ({ result: { ok: true, added: 3, updated: 0, skipped: 0, names: [] }, snapshot }),
    remove: async () => snapshot,
    rename: async () => snapshot,
    exportLinks: async () => ''
  },
  subs: {
    add: async () => ({ result: { ok: true, added: 6, updated: 0, skipped: 0, names: [] }, snapshot }),
    update: async () => ({ result: { ok: true, added: 0, updated: 6, skipped: 0, names: [] }, snapshot }),
    updateAll: async () => snapshot,
    remove: async () => snapshot,
    patch: async () => snapshot
  },
  rules: { setApps: async () => snapshot, setCustom: async () => snapshot, setPresets: async () => snapshot },
  apps: {
    list: async () => [
      { exe: 'Discord.exe', name: 'Discord', path: 'C:\\Discord.exe', running: true },
      { exe: 'chrome.exe', name: 'Google Chrome', path: 'C:\\chrome.exe', running: true },
      { exe: 'Telegram.exe', name: 'Telegram Desktop', path: 'C:\\Telegram.exe', running: true }
    ],
    pick: async () => null,
    icon: async () => undefined
  },
  config: {
    preview: async () => JSON.stringify({ log: { level: 'info' }, route: { final: 'proxy' } }, null, 2),
    validate: async () => ({ ok: true }),
    export: async () => null
  },
  system: {
    openDataDir: async () => {},
    resetSystemProxy: async () => {},
    setAutoStart: async () => ({ ok: true }),
    openExternal: async () => {},
    clipboardRead: async () => '',
    clipboardWrite: async () => {}
  },
  update: {
    state: async () => updateState,
    check: async () => updateState,
    download: async () => updateState,
    install: async () => true,
    markSeen: async () => {}
  },

  zapret: {
    state: async () => zapretState,
    refresh: async () => zapretState,
    start: r(),
    stop: async () => {},
    config: async () => snapshot,
    installService: r(),
    removeService: r(),
    killForeign: r(),
    checkUpdate: async () => zapretState,
    installLatest: r(),
    installFromFile: r({ version: '1.10.2' }),
    updateIpset: r({ count: 32126 }),
    readList: async () => ({ lines: ['discord.com', 'discord.gg', 'discordapp.net'], total: 3 }),
    diagnostics: r({
      checks: [
        { id: 'tcp', level: 'error', title: 'Отметки времени TCP выключены', detail: 'Стратегии с подделкой по отметкам времени (ts) без них не работают.', fix: 'tcp-timestamps' },
        { id: 'vpn', level: 'warn', title: 'Найдены службы VPN: RadminVPN', detail: 'Некоторые VPN конфликтуют с zapret — на время проверки выключите их.' },
        { id: 'dns', level: 'warn', title: 'Безопасный DNS не настроен в Windows', detail: 'Включите DNS-over-HTTPS в браузере или в параметрах Windows 11.', link: 'https://github.com' },
        { id: 'bfe', level: 'ok', title: 'Служба Base Filtering Engine работает' }
      ]
    }),
    fix: r({ message: 'Готово' }),
    clearDiscord: r({ found: ['Discord'], failed: [] }),
    resetNetwork: r(),
    hosts: r({ info: { upToDate: false, total: 79, missing: 12, stale: 3, managed: true, entries: ['149.154.167.220 web.telegram.org', '162.159.138.232 discord.com'] } }),
    hostsApply: r({ info: { upToDate: true, total: 79, missing: 0, stale: 0, managed: true, entries: [] } }),
    hostsRemove: r({ info: { upToDate: false, total: 79, missing: 79, stale: 0, managed: false, entries: [] } }),
    testStart: r(),
    testCancel: async () => {},
    testState: async () => zapretTest,
    report: async () => '',
    openReports: async () => {},
    openRoot: async () => {}
  },

  window: {
    minimize: async () => {},
    maximize: async () => {},
    close: async () => {},
    isMaximized: async () => false
  },
  events: {
    onState: on('state'),
    onLog: on('log'),
    onTraffic: on('traffic'),
    onConnections: on('connections'),
    onSnapshot: on('snapshot'),
    onLatency: on('latency'),
    onToast: on('toast'),
    onMaximize: on('maximize'),
    onUpdate: on('update'),
    onZapret: on('zapret'),
    onZapretTest: on('zapretTest')
  }
}

// Наполняем интерфейс данными сразу после загрузки
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    let up = 3.4e9
    let down = 58.1e9
    for (let i = 0; i < 60; i++) {
      const u = 120_000 + Math.sin(i / 3.1) * 90_000 + Math.random() * 70_000
      const d = 1_900_000 + Math.sin(i / 4.7) * 1_300_000 + Math.random() * 900_000
      up += u
      down += d
      fire('traffic', { up: Math.round(u), down: Math.round(d), t: Date.now() - (60 - i) * 1000, totalUp: up, totalDown: down })
    }
    fire('connections', connections)
    fire('update', updateState)
    LOGS.forEach(([level, message], i) =>
      fire('log', { id: i + 1, level, message, t: Date.now() - (LOGS.length - i) * 4200, source: 'core' })
    )
  }, 120)
})
