/* Реестр правил (rule-set), вшитых в приложение.
   Файлы лежат в resources/rules/<tag>.srs и подключаются как локальные —
   ничего не скачивается при старте, VPN поднимается даже если GitHub недоступен. */

export interface RuleSetInfo {
  /** Тег = имя файла без .srs */
  tag: string
  label: string
  group: 'ru' | 'services' | 'games' | 'block' | 'geo'
}

export const RULE_SETS: RuleSetInfo[] = [
  // Российские
  { tag: 'geosite-category-ru', label: 'Российские сайты', group: 'ru' },
  { tag: 'geosite-tld-ru', label: 'Домены .ru / .рф / .su', group: 'ru' },
  { tag: 'geosite-category-gov-ru', label: 'Госуслуги и госсайты', group: 'ru' },
  { tag: 'geosite-category-bank-ru', label: 'Банки РФ', group: 'ru' },
  { tag: 'geosite-tbank-ru', label: 'Т-Банк', group: 'ru' },
  { tag: 'geosite-category-ecommerce-ru', label: 'Маркетплейсы РФ', group: 'ru' },
  { tag: 'geosite-category-media-ru', label: 'СМИ РФ', group: 'ru' },
  { tag: 'geosite-yandex', label: 'Яндекс', group: 'ru' },
  { tag: 'geosite-vk', label: 'VK', group: 'ru' },
  { tag: 'geosite-mailru', label: 'Mail.ru', group: 'ru' },
  { tag: 'geosite-rutracker', label: 'RuTracker', group: 'ru' },
  { tag: 'geoip-ru', label: 'IP-адреса России', group: 'geo' },
  { tag: 'geoip-cn', label: 'IP-адреса Китая', group: 'geo' },

  // Сервисы
  { tag: 'geosite-discord', label: 'Discord', group: 'services' },
  { tag: 'geosite-telegram', label: 'Telegram', group: 'services' },
  { tag: 'geosite-whatsapp', label: 'WhatsApp', group: 'services' },
  { tag: 'geosite-signal', label: 'Signal', group: 'services' },
  { tag: 'geosite-youtube', label: 'YouTube', group: 'services' },
  { tag: 'geosite-google', label: 'Google', group: 'services' },
  { tag: 'geosite-openai', label: 'OpenAI / ChatGPT', group: 'services' },
  { tag: 'geosite-category-ai', label: 'AI-сервисы', group: 'services' },
  { tag: 'geosite-netflix', label: 'Netflix', group: 'services' },
  { tag: 'geosite-spotify', label: 'Spotify', group: 'services' },
  { tag: 'geosite-twitch', label: 'Twitch', group: 'services' },
  { tag: 'geosite-meta', label: 'Meta (Instagram, Facebook)', group: 'services' },
  { tag: 'geosite-twitter', label: 'X / Twitter', group: 'services' },
  { tag: 'geosite-tiktok', label: 'TikTok', group: 'services' },
  { tag: 'geosite-github', label: 'GitHub', group: 'services' },
  { tag: 'geosite-microsoft', label: 'Microsoft', group: 'services' },
  { tag: 'geosite-apple', label: 'Apple', group: 'services' },
  { tag: 'geosite-cloudflare', label: 'Cloudflare', group: 'services' },
  { tag: 'geosite-category-speedtest', label: 'Speedtest', group: 'services' },

  // Игры
  { tag: 'geosite-steam', label: 'Steam', group: 'games' },
  { tag: 'geosite-epicgames', label: 'Epic Games', group: 'games' },
  { tag: 'geosite-ea', label: 'EA', group: 'games' },
  { tag: 'geosite-ubisoft', label: 'Ubisoft', group: 'games' },
  { tag: 'geosite-playstation', label: 'PlayStation', group: 'games' },
  { tag: 'geosite-xbox', label: 'Xbox', group: 'games' },
  { tag: 'geosite-nintendo', label: 'Nintendo', group: 'games' },
  { tag: 'geosite-roblox', label: 'Roblox', group: 'games' },
  { tag: 'geosite-category-games', label: 'Игровые сервисы', group: 'games' },

  // Блокировки
  { tag: 'geosite-category-ads-all', label: 'Реклама и трекеры', group: 'block' },
  { tag: 'geosite-category-porn', label: 'Взрослый контент', group: 'block' }
]

export const RULE_SET_TAGS = new Set(RULE_SETS.map((r) => r.tag))

/** Адрес правила в апстриме SagerNet — тот же источник, откуда их берёт
    scripts/fetch-resources.mjs для Windows-сборки.

    Нужен на iOS: складывать 30+ файлов .srs в бандл приложения и обновлять их
    выпуском новой версии бессмысленно, поэтому там правила подключаются как
    remote и обновляются сами. */
export function ruleSetUrl(tag: string): string {
  // Единственное расхождение имён: локально category-ai, в апстриме category-ai-!cn
  const file = tag === 'geosite-category-ai' ? 'geosite-category-ai-!cn' : tag
  const repo = tag.startsWith('geoip-') ? 'sing-geoip' : 'sing-geosite'
  return `https://raw.githubusercontent.com/SagerNet/${repo}/rule-set/${file}.srs`
}

export function ruleSetLabel(tag: string): string {
  return RULE_SETS.find((r) => r.tag === tag)?.label ?? tag
}
