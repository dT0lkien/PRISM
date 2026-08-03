/* Пресеты маршрутизации. Каждый пресет разворачивается в набор правил sing-box. */

import type { Matcher, RuleAction } from './types'

export interface PresetRule {
  action: RuleAction
  matchers: Matcher[]
  note?: string
}

export interface RoutingPreset {
  id: string
  name: string
  description: string
  /** lucide-иконка */
  icon: string
  group: 'fix' | 'bypass' | 'force' | 'block'
  defaultOn: boolean
  rules: PresetRule[]
}

/* ─────────── Discord: домены и процессы ─────────── */

export const DISCORD_DOMAINS = [
  'discord.com',
  'discordapp.com',
  'discordapp.net',
  'discord.gg',
  'discord.media',
  'discordcdn.com',
  'discord.dev',
  'discord.co',
  'discordstatus.com',
  'dis.gd',
  'discord-attachments-uploads-prd.storage.googleapis.com'
]

export const DISCORD_PROCESSES = [
  'Discord.exe',
  'DiscordPTB.exe',
  'DiscordCanary.exe',
  'DiscordDevelopment.exe',
  'Update.exe'
]

/**
 * Диапазоны портов голосовых серверов Discord (UDP).
 * Голос идёт напрямую на медиа-серверы по высоким портам — их нельзя
 * ронять вместе с QUIC-блокировкой (та бьёт только UDP/443).
 */
export const DISCORD_VOICE_PORTS = '50000:65535'

/* ─────────── Пресеты ─────────── */

export const PRESETS: RoutingPreset[] = [
  {
    id: 'discord-fix',
    name: 'Discord Fix',
    description:
      'Заворачивает все процессы Discord и его домены в туннель целиком — вместе с UDP для голоса. ' +
      'Плюс отдельное DNS-разрешение через прокси, чтобы провайдер не подменял адреса.',
    icon: 'MessageCircle',
    group: 'fix',
    defaultOn: true,
    rules: [
      {
        action: 'proxy',
        note: 'Процессы Discord целиком (TCP + UDP)',
        matchers: [{ kind: 'process', values: DISCORD_PROCESSES }]
      },
      {
        action: 'proxy',
        note: 'Домены Discord',
        matchers: [{ kind: 'domain_suffix', values: DISCORD_DOMAINS }]
      },
      {
        action: 'proxy',
        note: 'Список доменов Discord из geosite',
        matchers: [{ kind: 'ruleset', values: ['geosite-discord'] }]
      }
    ]
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Telegram и его медиа-серверы через туннель.',
    icon: 'Send',
    group: 'force',
    defaultOn: true,
    rules: [
      { action: 'proxy', matchers: [{ kind: 'ruleset', values: ['geosite-telegram'] }] },
      { action: 'proxy', matchers: [{ kind: 'process', values: ['Telegram.exe', 'Unigram.exe'] }] }
    ]
  },
  {
    id: 'media',
    name: 'Видео и музыка',
    description: 'YouTube, Netflix, Spotify, Twitch — через туннель.',
    icon: 'Play',
    group: 'force',
    defaultOn: true,
    rules: [
      {
        action: 'proxy',
        matchers: [
          {
            kind: 'ruleset',
            values: ['geosite-youtube', 'geosite-netflix', 'geosite-spotify', 'geosite-twitch']
          }
        ]
      }
    ]
  },
  {
    id: 'ai',
    name: 'AI-сервисы',
    description: 'ChatGPT, Claude, Gemini и прочие — через туннель (у них строгая гео-фильтрация).',
    icon: 'Sparkles',
    group: 'force',
    defaultOn: true,
    rules: [
      {
        action: 'proxy',
        matchers: [{ kind: 'ruleset', values: ['geosite-openai', 'geosite-category-ai'] }]
      }
    ]
  },
  {
    id: 'social',
    name: 'Соцсети',
    description: 'Instagram, Facebook, X/Twitter, TikTok — через туннель.',
    icon: 'Users',
    group: 'force',
    defaultOn: true,
    rules: [
      {
        action: 'proxy',
        matchers: [{ kind: 'ruleset', values: ['geosite-meta', 'geosite-twitter', 'geosite-tiktok'] }]
      }
    ]
  },
  {
    id: 'ru-bypass',
    name: 'Российские сайты напрямую',
    description:
      'Домены .ru/.рф, банки, госуслуги, маркетплейсы, Яндекс, VK и российские IP идут мимо туннеля. ' +
      'Быстрее и не ломает сайты, которые блокируют зарубежные адреса.',
    icon: 'Home',
    group: 'bypass',
    defaultOn: true,
    rules: [
      {
        action: 'direct',
        matchers: [
          {
            kind: 'ruleset',
            values: [
              'geosite-category-ru',
              'geosite-tld-ru',
              'geosite-category-gov-ru',
              'geosite-category-bank-ru',
              'geosite-tbank-ru',
              'geosite-category-ecommerce-ru',
              'geosite-category-media-ru',
              'geosite-yandex',
              'geosite-vk',
              'geosite-mailru'
            ]
          }
        ]
      },
      { action: 'direct', matchers: [{ kind: 'ruleset', values: ['geoip-ru'] }] }
    ]
  },
  {
    id: 'games-direct',
    name: 'Игры напрямую',
    description: 'Steam, Epic, PlayStation, Xbox и игровые сервисы мимо туннеля — меньше пинг.',
    icon: 'Gamepad2',
    group: 'bypass',
    defaultOn: true,
    rules: [
      {
        action: 'direct',
        matchers: [
          {
            kind: 'ruleset',
            values: [
              'geosite-steam',
              'geosite-epicgames',
              'geosite-ea',
              'geosite-ubisoft',
              'geosite-playstation',
              'geosite-xbox',
              'geosite-nintendo',
              'geosite-roblox',
              'geosite-category-games'
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'speedtest-direct',
    name: 'Speedtest напрямую',
    description: 'Замеры скорости идут мимо туннеля — показывают реальную скорость канала.',
    icon: 'Gauge',
    group: 'bypass',
    defaultOn: false,
    rules: [{ action: 'direct', matchers: [{ kind: 'ruleset', values: ['geosite-category-speedtest'] }] }]
  },
  {
    id: 'torrent-direct',
    name: 'Торренты напрямую',
    description: 'BitTorrent не идёт в туннель — многие провайдеры VPN это запрещают.',
    icon: 'Download',
    group: 'bypass',
    defaultOn: true,
    rules: [
      { action: 'direct', matchers: [{ kind: 'protocol', values: ['bittorrent'] }] },
      {
        action: 'direct',
        matchers: [
          { kind: 'process', values: ['qbittorrent.exe', 'utorrent.exe', 'transmission-qt.exe', 'deluge.exe', 'BitComet.exe'] }
        ]
      }
    ]
  },
  {
    id: 'ads-block',
    name: 'Блокировка рекламы',
    description: 'Рекламные и трекинговые домены отбрасываются на уровне маршрутизации.',
    icon: 'ShieldBan',
    group: 'block',
    defaultOn: false,
    rules: [{ action: 'block', matchers: [{ kind: 'ruleset', values: ['geosite-category-ads-all'] }] }]
  },
  {
    id: 'porn-block',
    name: 'Блокировка 18+',
    description: 'Домены со взрослым контентом блокируются.',
    icon: 'EyeOff',
    group: 'block',
    defaultOn: false,
    rules: [{ action: 'block', matchers: [{ kind: 'ruleset', values: ['geosite-category-porn'] }] }]
  }
]

export function presetById(id: string): RoutingPreset | undefined {
  return PRESETS.find((p) => p.id === id)
}

export const DEFAULT_PRESETS = PRESETS.filter((p) => p.defaultOn).map((p) => p.id)

/** Приложения, которые чаще всего добавляют в список — для быстрого старта */
export const SUGGESTED_APPS: { exe: string; name: string; action: RuleAction }[] = [
  { exe: 'Discord.exe', name: 'Discord', action: 'proxy' },
  { exe: 'Telegram.exe', name: 'Telegram', action: 'proxy' },
  { exe: 'chrome.exe', name: 'Google Chrome', action: 'proxy' },
  { exe: 'msedge.exe', name: 'Microsoft Edge', action: 'proxy' },
  { exe: 'firefox.exe', name: 'Firefox', action: 'proxy' },
  { exe: 'brave.exe', name: 'Brave', action: 'proxy' },
  { exe: 'Spotify.exe', name: 'Spotify', action: 'proxy' },
  { exe: 'steam.exe', name: 'Steam', action: 'direct' },
  { exe: 'EpicGamesLauncher.exe', name: 'Epic Games', action: 'direct' },
  { exe: 'qbittorrent.exe', name: 'qBittorrent', action: 'direct' },
  { exe: 'Code.exe', name: 'VS Code', action: 'proxy' },
  { exe: 'obs64.exe', name: 'OBS Studio', action: 'direct' }
]
