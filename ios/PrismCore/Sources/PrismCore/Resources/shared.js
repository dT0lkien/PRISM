/* СГЕНЕРИРОВАНО scripts/build-shared-js.mjs — не править руками.
   Источник: src/shared/*.ts, общий с Windows-версией.
   Пересобрать: node scripts/build-shared-js.mjs */

/* Полифилы веб-API для JavaScriptCore.

   JSC — чистый движок ECMAScript: в нём есть Math, Date, JSON, RegExp, типизированные
   массивы и decodeURIComponent, но нет ничего из веб-платформы. Electron всё это даёт
   сам, поэтому Windows-версии файл не нужен — он попадает только в iOS-бандл.

   Реализовано ровно то, что использует src/shared, и не больше:
     atob            — внутри b64decode
     TextDecoder     — там же, только .decode(Uint8Array) в utf-8
     URLSearchParams — разбор ссылок, только конструктор от строки, get и set

   Каждый полифил ставится, лишь если хост своего не дал: тогда тот же бандл
   исполняется и в Node при сверке эталонов, используя родные реализации. */

;(function (root) {
  'use strict'

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

  if (typeof root.atob !== 'function') {
    root.atob = function atob(input) {
      var s = String(input).replace(/[\t\n\f\r ]/g, '')
      if (s.length % 4 === 0) s = s.replace(/==?$/, '')
      if (s.length % 4 === 1 || /[^+/0-9A-Za-z]/.test(s)) throw new Error('atob: строка не base64')
      var out = ''
      var buf = 0
      var bits = 0
      for (var i = 0; i < s.length; i++) {
        buf = (buf << 6) | B64.indexOf(s.charAt(i))
        bits += 6
        if (bits >= 8) {
          bits -= 8
          out += String.fromCharCode((buf >> bits) & 0xff)
        }
      }
      return out
    }
  }

  if (typeof root.TextDecoder !== 'function') {
    /* Декодер utf-8. Некорректные последовательности заменяются на U+FFFD —
       так же ведёт себя штатный TextDecoder без fatal:true. */
    var TextDecoderShim = function TextDecoder(label) {
      var enc = String(label == null ? 'utf-8' : label).toLowerCase()
      if (enc !== 'utf-8' && enc !== 'utf8' && enc !== 'unicode-1-1-utf-8') {
        throw new RangeError('TextDecoder: поддерживается только utf-8, запрошено ' + label)
      }
    }

    TextDecoderShim.prototype.decode = function decode(input) {
      if (input == null) return ''
      var b = input instanceof Uint8Array ? input : new Uint8Array(input.buffer || input)
      var out = ''
      var i = 0
      while (i < b.length) {
        var c = b[i++]
        var need// сколько байт продолжения ожидается
        var cp // накопленная кодовая точка
        if (c < 0x80) {
          out += String.fromCharCode(c)
          continue
        } else if (c >= 0xc2 && c <= 0xdf) {
          need = 1
          cp = c & 0x1f
        } else if (c >= 0xe0 && c <= 0xef) {
          need = 2
          cp = c & 0x0f
        } else if (c >= 0xf0 && c <= 0xf4) {
          need = 3
          cp = c & 0x07
        } else {
          out += '�'
          continue
        }

        if (i + need > b.length) {
          out += '�'
          break
        }

        var ok = true
        for (var k = 0; k < need; k++) {
          var cc = b[i + k]
          if ((cc & 0xc0) !== 0x80) {
            ok = false
            break
          }
          cp = (cp << 6) | (cc & 0x3f)
        }
        if (!ok) {
          out += '�'
          continue
        }
        i += need

        // Отсекаем избыточные кодировки, суррогаты и выход за предел Unicode
        if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || (need === 2 && cp < 0x800) || (need === 3 && cp < 0x10000)) {
          out += '�'
        } else if (cp > 0xffff) {
          cp -= 0x10000
          out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
        } else {
          out += String.fromCharCode(cp)
        }
      }
      return out
    }

    root.TextDecoder = TextDecoderShim
  }

  if (typeof root.URLSearchParams !== 'function') {
    /* В ссылках попадаются кривые проценты (%zz) — штатный URLSearchParams их
       не роняет, поэтому и здесь декодирование терпимое. */
    var dec = function (s) {
      try {
        return decodeURIComponent(String(s).replace(/\+/g, ' '))
      } catch (e) {
        return String(s)
      }
    }

    var URLSearchParamsShim = function URLSearchParams(init) {
      this._p = []
      if (typeof init === 'string' && init) {
        var parts = init.replace(/^\?/, '').split('&')
        for (var i = 0; i < parts.length; i++) {
          if (!parts[i]) continue
          var eq = parts[i].indexOf('=')
          var k = eq < 0 ? parts[i] : parts[i].slice(0, eq)
          var v = eq < 0 ? '' : parts[i].slice(eq + 1)
          this._p.push([dec(k), dec(v)])
        }
      }
    }

    URLSearchParamsShim.prototype.get = function get(name) {
      var n = String(name)
      for (var i = 0; i < this._p.length; i++) if (this._p[i][0] === n) return this._p[i][1]
      return null
    }

    URLSearchParamsShim.prototype.set = function set(name, value) {
      var n = String(name)
      var v = String(value)
      for (var i = 0; i < this._p.length; i++) {
        if (this._p[i][0] === n) {
          this._p[i][1] = v
          // остальные вхождения с тем же именем штатный set удаляет
          for (var j = this._p.length - 1; j > i; j--) if (this._p[j][0] === n) this._p.splice(j, 1)
          return
        }
      }
      this._p.push([n, v])
    }

    root.URLSearchParams = URLSearchParamsShim
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)

'use strict';
(function (root) {
/* ─────────── src/shared/types.ts ─────────── */
/* Общие типы, разделяемые между main и renderer */

                      
           
           
            
                 
               
              
          
            
               
         
          
           
               

/** Один сервер (превращается в sing-box outbound) */
                             
            
              
                
                
              
                                               
                                   
                                                   
               
                         
                                                                 
                  
                           
                   
 

                               
            
              
             
                     
                       
                    
                    
                                                  
              
                   
                     
                  
                   
   
 

/* ─────────────────────────── Маршрутизация ─────────────────────────── */

                                                     

                         
                           
                                 
                                 
                   
                    
                  
             
          
                
                                                  
                          
               // http/tls/quic/dns/stun/bittorrent

                          
                   
                  
 

                              
            
              
                  
                    
                     
                                                              
                      
                                                                   
                 
 

/** Приложение в списке per-app маршрутизации */
                          
            
                                                  
             
                         
              
                                    
               
                                       
               
                    
                  
 

                                                                     
                                         
                                                    
                                                                                   

                           
                          
                          

                                                            
                   
                   
                   

        
                   
               
                      
                        
                 
                                                                                 
                             
   

        
                  
                 
                         
                   
                     
                                                 
                     
   

                          
                     
                    
                        
                     

                             
                    
                                    
                     
                      
                        
                         
                      
                         

                  
                    
                       
                                                         

                                                                      
                     
                                                  
                       
 

                          
          
              
               
                 
           
           
                                                                      
                 

                              
                      
                                             
                  
                
                     
               
                  
                         
                      
                
                
                    
 

                                                 
                                                                                  

/* ─────────────────────────── Рантайм ─────────────────────────── */

                                                                                  

                            
                    
                
                
                   
                          
                       
                                             
                        
 

                                
            
              
           
 

                                
            
              
 

                           
            
               
                 
           
                        
 

                                 
            
              
            
              
                 
                 
                     
                  
                  
                
                  
               
              
 

                                
                     
                               
                       
 

                               
             
               
                 
                 
                
                 
 

/** Информация об установленном/запущенном приложении для пикера */

/* ─────────── src/shared/rulesets.ts ─────────── */
/* Реестр правил (rule-set), вшитых в приложение.
   Файлы лежат в resources/rules/<tag>.srs и подключаются как локальные —
   ничего не скачивается при старте, VPN поднимается даже если GitHub недоступен. */

                              
                                 
             
               
                                                      
 

const RULE_SETS                = [
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

const RULE_SET_TAGS = new Set(RULE_SETS.map((r) => r.tag))

/** Адрес правила в апстриме SagerNet — тот же источник, откуда их берёт
    scripts/fetch-resources.mjs для Windows-сборки.

    Нужен на iOS: складывать 30+ файлов .srs в бандл приложения и обновлять их
    выпуском новой версии бессмысленно, поэтому там правила подключаются как
    remote и обновляются сами. */
function ruleSetUrl(tag        )         {
  // Единственное расхождение имён: локально category-ai, в апстриме category-ai-!cn
  const file = tag === 'geosite-category-ai' ? 'geosite-category-ai-!cn' : tag
  const repo = tag.startsWith('geoip-') ? 'sing-geoip' : 'sing-geosite'
  return `https://raw.githubusercontent.com/SagerNet/${repo}/rule-set/${file}.srs`
}

function ruleSetLabel(tag        )         {
  return RULE_SETS.find((r) => r.tag === tag)?.label ?? tag
}

/* ─────────── src/shared/presets.ts ─────────── */
/* Пресеты маршрутизации. Каждый пресет разворачивается в набор правил sing-box. */

                                                  

                             
                    
                     
               
 

                                
            
              
                     
                      
              
                                             
                    
                     
 

/* ─────────── Discord: домены и процессы ─────────── */

const DISCORD_DOMAINS = [
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

const DISCORD_PROCESSES = [
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
const DISCORD_VOICE_PORTS = '50000:65535'

/* ─────────── Пресеты ─────────── */

const PRESETS                  = [
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

function presetById(id        )                            {
  return PRESETS.find((p) => p.id === id)
}

const DEFAULT_PRESETS = PRESETS.filter((p) => p.defaultOn).map((p) => p.id)

/** Приложения, которые чаще всего добавляют в список — для быстрого старта */
const SUGGESTED_APPS                                                      = [
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

/* ─────────── src/shared/defaults.ts ─────────── */
const DEFAULT_SETTINGS           = {
  captureMode: 'tun',
  routingMode: 'smart',

  localPort: 2080,
  allowLan: false,
  clashPort: 9291,

  tun: {
    stack: 'mixed',
    mtu: 9000,
    autoRoute: true,
    strictRoute: true,
    ipv6: false,
    excludePackages: []
  },

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
  killSwitch: false,

  autoStart: false,
  autoUpdate: true,
  autoConnect: false,
  startElevated: false,
  minimizeToTray: true,
  closeToTray: true,
  startMinimized: false,

  theme: 'dark',
  accent: 'aurora',
  language: 'ru',
  logLevel: 'info',

  extraConfig: '',
  manualConfig: false
}

const DEFAULT_ENABLED_PRESETS = DEFAULT_PRESETS

/** Популярные DNS для выпадающего списка */
const DNS_PRESETS_REMOTE = [
  { label: 'Cloudflare (DoH)', value: 'https://1.1.1.1/dns-query' },
  { label: 'Google (DoH)', value: 'https://8.8.8.8/dns-query' },
  { label: 'Quad9 (DoH)', value: 'https://9.9.9.9/dns-query' },
  { label: 'AdGuard без рекламы (DoH)', value: 'https://94.140.14.14/dns-query' },
  { label: 'Cloudflare (DoT)', value: 'tls://1.1.1.1' },
  { label: 'Cloudflare (обычный)', value: '1.1.1.1' }
]

const DNS_PRESETS_LOCAL = [
  { label: 'Яндекс DNS', value: '77.88.8.8' },
  { label: 'DNS провайдера (системный)', value: 'local' },
  { label: 'Google', value: '8.8.8.8' },
  { label: 'Cloudflare', value: '1.1.1.1' },
  { label: 'DHCP', value: 'dhcp://auto' }
]

/* ─────────── src/shared/parsers.ts ─────────── */
/* Парсинг ссылок подписок → sing-box outbound.
   Поддержка: vless, vmess (base64-json и uri), trojan, ss (SIP002/legacy),
   hysteria2/hy2, hysteria, tuic, anytls, socks, http, shadowtls.
   Плюс: Clash YAML, sing-box JSON, base64-списки. */

                                                   

/* ───────────────────────── утилиты ───────────────────────── */

function b64decode(input        )         {
  let s = input.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
  while (s.length % 4) s += '='
  try {
    const bin = atob(s)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

function looksBase64(s        )          {
  const t = s.trim().replace(/\s/g, '')
  return t.length > 16 && /^[A-Za-z0-9+/\-_=]+$/.test(t)
}

function uid()         {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

function num(v         , dflt = 0)         {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : dflt
}

function truthy(v         )          {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'True'
}

function clean                                   (o   )    {
  for (const k of Object.keys(o)) {
    const v = o[k]
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) delete o[k]
  }
  return o
}

/** Разбор host:port, включая IPv6 в скобках */
function splitHostPort(auth        )                                 {
  const m = auth.match(/^\[(.+)\]:(\d+)$/)
  if (m) return { host: m[1], port: parseInt(m[2], 10) }
  const i = auth.lastIndexOf(':')
  if (i < 0) return { host: auth, port: 443 }
  return { host: auth.slice(0, i), port: parseInt(auth.slice(i + 1), 10) || 443 }
}

/* ───────────────────────── TLS / transport ───────────────────────── */

                   
                   
              
               
               
             
              
              
              
                    
                
 

function buildTls(o         )                                      {
  const sec = (o.security || '').toLowerCase()
  if (sec === 'reality') {
    return clean({
      enabled: true,
      server_name: o.sni || o.host || o.server,
      insecure: false,
      utls: { enabled: true, fingerprint: o.fp || 'chrome' },
      reality: clean({ enabled: true, public_key: o.pbk, short_id: o.sid || '' })
    })
  }
  if (sec === 'tls' || sec === 'xtls') {
    return clean({
      enabled: true,
      server_name: o.sni || o.host || o.server,
      insecure: !!o.insecure,
      alpn: o.alpn ? o.alpn.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
      utls: o.fp ? { enabled: true, fingerprint: o.fp } : { enabled: true, fingerprint: 'chrome' }
    })
  }
  return undefined
}

function buildTransport(q                 , fallbackHost        )                                      {
  const type = (q.get('type') || q.get('net') || 'tcp').toLowerCase()
  const path = q.get('path') || '/'
  const host = q.get('host') || fallbackHost

  switch (type) {
    case 'ws': {
      const t                          = { type: 'ws' }
      // ?ed=2048 внутри path — ранние данные
      const [p, qs] = path.split('?')
      t.path = p || '/'
      if (host) t.headers = { Host: host }
      const ed = qs ? new URLSearchParams(qs).get('ed') : q.get('ed')
      if (ed) {
        t.max_early_data = parseInt(ed, 10) || 2048
        t.early_data_header_name = q.get('eh') || 'Sec-WebSocket-Protocol'
      }
      return t
    }
    case 'grpc':
      return clean({ type: 'grpc', service_name: q.get('serviceName') || q.get('path') || '' })
    case 'http':
    case 'h2':
      return clean({
        type: 'http',
        host: host ? host.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        path: path || '/'
      })
    case 'httpupgrade':
      return clean({ type: 'httpupgrade', host, path: path || '/' })
    case 'quic':
      return { type: 'quic' }
    case 'tcp': {
      // tcp + headerType=http — маскировка под HTTP
      if ((q.get('headerType') || '').toLowerCase() === 'http') {
        return clean({
          type: 'http',
          host: host ? host.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
          path: path || '/'
        })
      }
      return undefined
    }
    default:
      return undefined
  }
}

/* ───────────────────────── парсеры по протоколам ───────────────────────── */

                                                                                                               

function parseVless(url        )                {
  const m = url.match(/^vless:\/\/([^@]+)@(.+?)(?:\?(.*?))?(?:#(.*))?$/i)
  if (!m) return null
  const uuid = decodeURIComponent(m[1])
  const { host, port } = splitHostPort(m[2])
  const q = new URLSearchParams(m[3] || '')
  const name = m[4] ? decodeURIComponent(m[4]) : `${host}:${port}`

  const flow = q.get('flow') || ''
  const ob = clean({
    type: 'vless',
    server: host,
    server_port: port,
    uuid,
    flow: flow && flow !== 'none' ? flow : undefined,
    packet_encoding: q.get('packetEncoding') || 'xudp',
    tls: buildTls({
      security: q.get('security') || 'none',
      sni: q.get('sni') || undefined,
      host: q.get('host') || undefined,
      alpn: q.get('alpn') || undefined,
      fp: q.get('fp') || undefined,
      pbk: q.get('pbk') || undefined,
      sid: q.get('sid') || undefined,
      insecure: truthy(q.get('allowInsecure')) || truthy(q.get('insecure')),
      server: host
    }),
    transport: buildTransport(q, q.get('host') || '')
  })
  return { name, type: 'vless', server: host, port, outbound: ob }
}

function parseVmess(url        )                {
  const body = url.slice('vmess://'.length)
  // Формат 1: base64(JSON)
  const decoded = b64decode(body.split('#')[0])
  if (decoded.trim().startsWith('{')) {
    let j                         
    try {
      j = JSON.parse(decoded)
    } catch {
      return null
    }
    const host = String(j.add || '')
    const port = num(j.port, 443)
    const net = String(j.net || 'tcp').toLowerCase()
    const q = new URLSearchParams()
    q.set('type', net)
    if (j.host) q.set('host', String(j.host))
    if (j.path) q.set('path', String(j.path))
    if (net === 'grpc' && j.path) q.set('serviceName', String(j.path))
    if (j.type) q.set('headerType', String(j.type))

    const tlsOn = String(j.tls || '') === 'tls' || String(j.tls || '') === 'reality'
    const ob = clean({
      type: 'vmess',
      server: host,
      server_port: port,
      uuid: String(j.id || ''),
      security: String(j.scy || 'auto'),
      alter_id: num(j.aid, 0),
      packet_encoding: 'xudp',
      tls: tlsOn
        ? buildTls({
            security: String(j.tls),
            sni: (j.sni          ) || (j.host          ) || undefined,
            alpn: (j.alpn          ) || undefined,
            fp: (j.fp          ) || undefined,
            insecure: truthy(j.allowInsecure) || truthy(j.verify_cert === false),
            server: host
          })
        : undefined,
      transport: buildTransport(q, String(j.host || ''))
    })
    return { name: String(j.ps || `${host}:${port}`), type: 'vmess', server: host, port, outbound: ob }
  }

  // Формат 2: vmess://uuid@host:port?...#name (как vless)
  const m = url.match(/^vmess:\/\/([^@]+)@(.+?)(?:\?(.*?))?(?:#(.*))?$/i)
  if (!m) return null
  const { host, port } = splitHostPort(m[2])
  const q = new URLSearchParams(m[3] || '')
  const ob = clean({
    type: 'vmess',
    server: host,
    server_port: port,
    uuid: decodeURIComponent(m[1]),
    security: q.get('encryption') || 'auto',
    alter_id: num(q.get('alterId'), 0),
    packet_encoding: 'xudp',
    tls: buildTls({
      security: q.get('security') || 'none',
      sni: q.get('sni') || undefined,
      host: q.get('host') || undefined,
      alpn: q.get('alpn') || undefined,
      fp: q.get('fp') || undefined,
      insecure: truthy(q.get('allowInsecure')),
      server: host
    }),
    transport: buildTransport(q, q.get('host') || '')
  })
  return {
    name: m[4] ? decodeURIComponent(m[4]) : `${host}:${port}`,
    type: 'vmess',
    server: host,
    port,
    outbound: ob
  }
}

function parseTrojan(url        )                {
  const m = url.match(/^trojan:\/\/([^@]+)@(.+?)(?:\?(.*?))?(?:#(.*))?$/i)
  if (!m) return null
  const { host, port } = splitHostPort(m[2])
  const q = new URLSearchParams(m[3] || '')
  const ob = clean({
    type: 'trojan',
    server: host,
    server_port: port,
    password: decodeURIComponent(m[1]),
    tls: buildTls({
      security: q.get('security') || 'tls',
      sni: q.get('sni') || q.get('peer') || undefined,
      host: q.get('host') || undefined,
      alpn: q.get('alpn') || undefined,
      fp: q.get('fp') || undefined,
      pbk: q.get('pbk') || undefined,
      sid: q.get('sid') || undefined,
      insecure: truthy(q.get('allowInsecure')) || truthy(q.get('insecure')),
      server: host
    }),
    transport: buildTransport(q, q.get('host') || '')
  })
  return {
    name: m[4] ? decodeURIComponent(m[4]) : `${host}:${port}`,
    type: 'trojan',
    server: host,
    port,
    outbound: ob
  }
}

function parseShadowsocks(url        )                {
  let rest = url.slice('ss://'.length)
  let name = ''
  const hi = rest.indexOf('#')
  if (hi >= 0) {
    name = decodeURIComponent(rest.slice(hi + 1))
    rest = rest.slice(0, hi)
  }
  let query = ''
  const qi = rest.indexOf('?')
  if (qi >= 0) {
    query = rest.slice(qi + 1)
    rest = rest.slice(0, qi)
  }

  let method = ''
  let password = ''
  let host = ''
  let port = 0

  if (rest.includes('@')) {
    // SIP002: ss://base64(method:pass)@host:port  либо  ss://method:pass@host:port
    const at = rest.lastIndexOf('@')
    const userinfo = rest.slice(0, at)
    const hp = splitHostPort(rest.slice(at + 1))
    host = hp.host
    port = hp.port
    const dec = userinfo.includes(':') ? decodeURIComponent(userinfo) : b64decode(userinfo)
    const ci = dec.indexOf(':')
    method = dec.slice(0, ci)
    password = dec.slice(ci + 1)
  } else {
    // Legacy: ss://base64(method:pass@host:port)
    const dec = b64decode(rest)
    const at = dec.lastIndexOf('@')
    if (at < 0) return null
    const ci = dec.indexOf(':')
    method = dec.slice(0, ci)
    password = dec.slice(ci + 1, at)
    const hp = splitHostPort(dec.slice(at + 1))
    host = hp.host
    port = hp.port
  }
  if (!host || !method) return null

  const q = new URLSearchParams(query)
  const pluginRaw = q.get('plugin') || ''
  let plugin = ''
  let pluginOpts = ''
  if (pluginRaw) {
    const parts = pluginRaw.split(';')
    plugin = parts[0]
    pluginOpts = parts.slice(1).join(';')
    if (plugin === 'obfs-local' || plugin === 'simple-obfs') plugin = 'obfs-local'
  }

  const ob = clean({
    type: 'shadowsocks',
    server: host,
    server_port: port,
    method,
    password,
    plugin: plugin || undefined,
    plugin_opts: pluginOpts || undefined,
    udp_over_tcp: truthy(q.get('uot')) ? { enabled: true, version: 2 } : undefined
  })
  return { name: name || `${host}:${port}`, type: 'shadowsocks', server: host, port, outbound: ob }
}

function parseHysteria2(url        )                {
  const m = url.match(/^(?:hysteria2|hy2):\/\/([^@]*)@?([^?#]+)(?:\?(.*?))?(?:#(.*))?$/i)
  if (!m) return null
  const { host, port } = splitHostPort(m[2])
  const q = new URLSearchParams(m[3] || '')
  const obfs = q.get('obfs')
  const ob = clean({
    type: 'hysteria2',
    server: host,
    server_port: port,
    password: decodeURIComponent(m[1] || q.get('password') || ''),
    up_mbps: num(q.get('up'), 0) || undefined,
    down_mbps: num(q.get('down'), 0) || undefined,
    obfs: obfs ? clean({ type: obfs, password: q.get('obfs-password') || '' }) : undefined,
    tls: clean({
      enabled: true,
      server_name: q.get('sni') || q.get('peer') || host,
      insecure: truthy(q.get('insecure')) || truthy(q.get('allowInsecure')),
      alpn: (q.get('alpn') || 'h3').split(',').map((s) => s.trim()).filter(Boolean)
    })
  })
  return {
    name: m[4] ? decodeURIComponent(m[4]) : `${host}:${port}`,
    type: 'hysteria2',
    server: host,
    port,
    outbound: ob
  }
}

function parseTuic(url        )                {
  const m = url.match(/^tuic:\/\/([^@]+)@([^?#]+)(?:\?(.*?))?(?:#(.*))?$/i)
  if (!m) return null
  const cred = decodeURIComponent(m[1])
  const ci = cred.indexOf(':')
  const uuid = ci >= 0 ? cred.slice(0, ci) : cred
  const password = ci >= 0 ? cred.slice(ci + 1) : ''
  const { host, port } = splitHostPort(m[2])
  const q = new URLSearchParams(m[3] || '')
  const ob = clean({
    type: 'tuic',
    server: host,
    server_port: port,
    uuid,
    password,
    congestion_control: q.get('congestion_control') || 'bbr',
    udp_relay_mode: q.get('udp_relay_mode') || 'native',
    zero_rtt_handshake: truthy(q.get('reduce_rtt')),
    heartbeat: '10s',
    tls: clean({
      enabled: true,
      server_name: q.get('sni') || host,
      insecure: truthy(q.get('allow_insecure')) || truthy(q.get('insecure')),
      alpn: (q.get('alpn') || 'h3').split(',').map((s) => s.trim()).filter(Boolean)
    })
  })
  return { name: m[4] ? decodeURIComponent(m[4]) : `${host}:${port}`, type: 'tuic', server: host, port, outbound: ob }
}

function parseAnyTls(url        )                {
  const m = url.match(/^anytls:\/\/([^@]+)@([^?#]+)(?:\?(.*?))?(?:#(.*))?$/i)
  if (!m) return null
  const { host, port } = splitHostPort(m[2])
  const q = new URLSearchParams(m[3] || '')
  const ob = clean({
    type: 'anytls',
    server: host,
    server_port: port,
    password: decodeURIComponent(m[1]),
    idle_session_check_interval: '30s',
    idle_session_timeout: '30s',
    tls: clean({
      enabled: true,
      server_name: q.get('sni') || host,
      insecure: truthy(q.get('insecure')) || truthy(q.get('allowInsecure')),
      alpn: q.get('alpn') ? q.get('alpn') .split(',') : undefined,
      utls: { enabled: true, fingerprint: q.get('fp') || 'chrome' }
    })
  })
  return { name: m[4] ? decodeURIComponent(m[4]) : `${host}:${port}`, type: 'anytls', server: host, port, outbound: ob }
}

function parseSocksHttp(url        )                {
  const m = url.match(/^(socks5?|https?):\/\/(?:([^@]*)@)?([^?#]+)(?:\?(.*?))?(?:#(.*))?$/i)
  if (!m) return null
  const scheme = m[1].toLowerCase()
  const isHttp = scheme === 'http' || scheme === 'https'
  const { host, port } = splitHostPort(m[3])
  let username = ''
  let password = ''
  if (m[2]) {
    const dec = m[2].includes(':') ? decodeURIComponent(m[2]) : b64decode(m[2])
    const ci = dec.indexOf(':')
    username = ci >= 0 ? dec.slice(0, ci) : dec
    password = ci >= 0 ? dec.slice(ci + 1) : ''
  }
  const ob = clean({
    type: isHttp ? 'http' : 'socks',
    server: host,
    server_port: port,
    version: isHttp ? undefined : '5',
    username: username || undefined,
    password: password || undefined,
    tls: scheme === 'https' ? { enabled: true, server_name: host } : undefined
  })
  return {
    name: m[5] ? decodeURIComponent(m[5]) : `${host}:${port}`,
    type: isHttp ? 'http' : 'socks',
    server: host,
    port,
    outbound: ob
  }
}

/* ───────────────────────── публичный API ───────────────────────── */

function parseLink(link        )                {
  const url = link.trim()
  if (!url) return null
  try {
    if (/^vless:\/\//i.test(url)) return parseVless(url)
    if (/^vmess:\/\//i.test(url)) return parseVmess(url)
    if (/^trojan:\/\//i.test(url)) return parseTrojan(url)
    if (/^ss:\/\//i.test(url)) return parseShadowsocks(url)
    if (/^(hysteria2|hy2):\/\//i.test(url)) return parseHysteria2(url)
    if (/^tuic:\/\//i.test(url)) return parseTuic(url)
    if (/^anytls:\/\//i.test(url)) return parseAnyTls(url)
    if (/^(socks5?|https?):\/\//i.test(url) && !/^https?:\/\/[^/]+\/.*/.test(url)) return parseSocksHttp(url)
  } catch {
    return null
  }
  return null
}

/** Конвертация одного прокси из Clash YAML в sing-box outbound */
function clashProxyToNode(p                     )                {
  const host = String(p.server || '')
  const port = num(p.port, 0)
  const name = String(p.name || `${host}:${port}`)
  if (!host || !port) return null
  const t = String(p.type || '').toLowerCase()

  const tlsFrom = ()                                      => {
    if (!p.tls && t !== 'hysteria2' && t !== 'tuic' && t !== 'trojan') return undefined
    return clean({
      enabled: true,
      server_name: p.servername || p.sni || p['server-name'] || host,
      insecure: truthy(p['skip-cert-verify']),
      alpn: Array.isArray(p.alpn) ? p.alpn : undefined,
      utls: p['client-fingerprint'] ? { enabled: true, fingerprint: p['client-fingerprint'] } : { enabled: true, fingerprint: 'chrome' },
      reality: p['reality-opts']
        ? clean({
            enabled: true,
            public_key: p['reality-opts']['public-key'],
            short_id: p['reality-opts']['short-id'] || ''
          })
        : undefined
    })
  }

  const transportFrom = ()                                      => {
    const net = String(p.network || '').toLowerCase()
    if (net === 'ws') {
      const o = p['ws-opts'] || {}
      return clean({
        type: 'ws',
        path: o.path || '/',
        headers: o.headers || (p['ws-headers'] ? p['ws-headers'] : undefined),
        max_early_data: o['max-early-data'],
        early_data_header_name: o['early-data-header-name']
      })
    }
    if (net === 'grpc') return clean({ type: 'grpc', service_name: (p['grpc-opts'] || {})['grpc-service-name'] || '' })
    if (net === 'h2') {
      const o = p['h2-opts'] || {}
      return clean({ type: 'http', host: o.host, path: o.path || '/' })
    }
    if (net === 'http') {
      const o = p['http-opts'] || {}
      return clean({ type: 'http', host: o.headers?.Host, path: Array.isArray(o.path) ? o.path[0] : o.path })
    }
    if (net === 'httpupgrade') {
      const o = p['ws-opts'] || {}
      return clean({ type: 'httpupgrade', host: o.headers?.Host, path: o.path || '/' })
    }
    return undefined
  }

  switch (t) {
    case 'vless':
      return {
        name,
        type: 'vless',
        server: host,
        port,
        outbound: clean({
          type: 'vless',
          server: host,
          server_port: port,
          uuid: p.uuid,
          flow: p.flow || undefined,
          packet_encoding: 'xudp',
          tls: tlsFrom(),
          transport: transportFrom()
        })
      }
    case 'vmess':
      return {
        name,
        type: 'vmess',
        server: host,
        port,
        outbound: clean({
          type: 'vmess',
          server: host,
          server_port: port,
          uuid: p.uuid,
          security: p.cipher || 'auto',
          alter_id: num(p.alterId ?? p['alterId'], 0),
          packet_encoding: 'xudp',
          tls: tlsFrom(),
          transport: transportFrom()
        })
      }
    case 'trojan':
      return {
        name,
        type: 'trojan',
        server: host,
        port,
        outbound: clean({
          type: 'trojan',
          server: host,
          server_port: port,
          password: p.password,
          tls: tlsFrom(),
          transport: transportFrom()
        })
      }
    case 'ss':
    case 'shadowsocks':
      return {
        name,
        type: 'shadowsocks',
        server: host,
        port,
        outbound: clean({
          type: 'shadowsocks',
          server: host,
          server_port: port,
          method: p.cipher,
          password: p.password,
          plugin: p.plugin || undefined,
          plugin_opts:
            p['plugin-opts'] && typeof p['plugin-opts'] === 'object'
              ? Object.entries(p['plugin-opts'])
                  .map(([k, v]) => `${k}=${v}`)
                  .join(';')
              : undefined
        })
      }
    case 'hysteria2':
    case 'hy2':
      return {
        name,
        type: 'hysteria2',
        server: host,
        port,
        outbound: clean({
          type: 'hysteria2',
          server: host,
          server_port: port,
          password: p.password || p.auth,
          up_mbps: num(p.up, 0) || undefined,
          down_mbps: num(p.down, 0) || undefined,
          obfs: p.obfs ? clean({ type: p.obfs, password: p['obfs-password'] || '' }) : undefined,
          tls: clean({
            enabled: true,
            server_name: p.sni || host,
            insecure: truthy(p['skip-cert-verify']),
            alpn: Array.isArray(p.alpn) ? p.alpn : ['h3']
          })
        })
      }
    case 'tuic':
      return {
        name,
        type: 'tuic',
        server: host,
        port,
        outbound: clean({
          type: 'tuic',
          server: host,
          server_port: port,
          uuid: p.uuid,
          password: p.password,
          congestion_control: p['congestion-controller'] || 'bbr',
          udp_relay_mode: p['udp-relay-mode'] || 'native',
          tls: clean({
            enabled: true,
            server_name: p.sni || host,
            insecure: truthy(p['skip-cert-verify']),
            alpn: Array.isArray(p.alpn) ? p.alpn : ['h3']
          })
        })
      }
    case 'anytls':
      return {
        name,
        type: 'anytls',
        server: host,
        port,
        outbound: clean({
          type: 'anytls',
          server: host,
          server_port: port,
          password: p.password,
          tls: tlsFrom()
        })
      }
    case 'socks5':
      return {
        name,
        type: 'socks',
        server: host,
        port,
        outbound: clean({
          type: 'socks',
          server: host,
          server_port: port,
          version: '5',
          username: p.username || undefined,
          password: p.password || undefined
        })
      }
    case 'http':
      return {
        name,
        type: 'http',
        server: host,
        port,
        outbound: clean({
          type: 'http',
          server: host,
          server_port: port,
          username: p.username || undefined,
          password: p.password || undefined,
          tls: p.tls ? tlsFrom() : undefined
        })
      }
    default:
      return null
  }
}

function parsedToNode(p        , extra                      = {})             {
  return {
    id: uid(),
    name: p.name,
    type: p.type,
    server: p.server,
    port: p.port,
    outbound: p.outbound,
    createdAt: Date.now(),
    ...extra
  }
}

/** Уникальный ключ узла — чтобы не плодить дубли при обновлении подписки */
function nodeKey(n                                                                                   )         {
  const ob = n.outbound                       
  const secret = ob.uuid || ob.password || ''
  return `${n.type}|${n.server}|${n.port}|${secret}`
}

/* ─────────── src/shared/subscriptions.ts ─────────── */
/* Разбор тела подписки → узлы.

   Форматов четыре, и провайдеры отдают любой из них: конфиг sing-box, Clash YAML,
   список ссылок, он же в base64. Логика общая для Windows и iOS — расхождение
   означало бы, что подписка, работающая на десктопе, не открывается на телефоне.

   YAML-парсер передаётся снаружи: в Electron это пакет yaml, а в JavaScriptCore
   на iOS сторонних пакетов нет. Без него Clash YAML просто пропускается —
   остальные три формата разбираются одинаково везде. */

/** Разбор YAML. Возвращает объект или бросает — оба случая обрабатываются. */
                                              

/** Служебные outbound'ы sing-box: это не серверы, а управляющие узлы */
const NOT_A_SERVER = ['selector', 'urltest', 'direct', 'block', 'dns']

function parseSubscriptionBody(
  body        ,
  subscriptionId         ,
  parseYaml             
)               {
  const text = body.trim()
  if (!text) return []
  const nodes               = []

  const pushLinks = (raw        ) => {
    for (const line of raw.split(/\r?\n/)) {
      const l = line.trim()
      if (!l || l.startsWith('#') || l.startsWith('//')) continue
      const p = parseLink(l)
      if (p) nodes.push(parsedToNode(p, { link: l, subscriptionId }))
    }
  }

  // 1. sing-box JSON
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const j = JSON.parse(text)
      const list        = Array.isArray(j) ? j : (j.outbounds ?? [])
      for (const ob of list) {
        if (!ob?.type || NOT_A_SERVER.includes(ob.type)) continue
        const { tag, ...rest } = ob
        nodes.push({
          id: uid(),
          name: String(tag ?? `${ob.server}:${ob.server_port}`),
          type: ob.type            ,
          server: String(ob.server ?? ''),
          port: Number(ob.server_port ?? 0),
          outbound: rest,
          subscriptionId,
          createdAt: Date.now()
        })
      }
      if (nodes.length) return nodes
    } catch {
      /* не JSON — идём дальше */
    }
  }

  // 2. Clash YAML — только если парсер дали
  if (parseYaml && /^\s*(proxies|proxy-groups|port|mixed-port)\s*:/m.test(text)) {
    try {
      const y = parseYaml(text)
      for (const p of y?.proxies ?? []) {
        const parsed = clashProxyToNode(p)
        if (parsed) nodes.push(parsedToNode(parsed, { subscriptionId }))
      }
      if (nodes.length) return nodes
    } catch {
      /* не YAML — идём дальше */
    }
  }

  // 3. Список ссылок как есть
  if (/^[a-z0-9]+:\/\//im.test(text)) {
    pushLinks(text)
    if (nodes.length) return nodes
  }

  // 4. base64 от списка ссылок
  if (looksBase64(text)) {
    const decoded = b64decode(text)
    if (decoded) {
      pushLinks(decoded)
      if (nodes.length) return nodes
      // Вложенный YAML/JSON внутри base64
      if (decoded.trim().startsWith('{') || /^\s*proxies\s*:/m.test(decoded)) {
        return parseSubscriptionBody(decoded, subscriptionId, parseYaml)
      }
    }
  }

  return nodes
}

/* ─────────── src/shared/config-builder.ts ─────────── */
/* Сборка конфига sing-box 1.13 из настроек приложения.
   Чистая функция — используется и в main (для запуска), и в renderer (для предпросмотра). */


/** Платформа, под которую собирается конфиг.

    Отличий три, и все вынуждены устройством мобильных систем: туннель поднимает
    сама система (NetworkExtension на iOS, VpnService на Android), маршрутизации
    по процессам не существует, а файлов правил рядом с приложением нет.
    Всё остальное у платформ общее, поэтому ios и android ведут себя одинаково. */
                                                          

const TAG_PROXY = 'proxy'
const TAG_DIRECT = 'direct'
const TAG_AUTO = 'auto'

                               
                    
                     
                       
                     
                            
                          
                                                                              
                           
                                                                                 
                  
                                                
                   
                     
 

                               

const drop =                 (o   )    => {
  for (const k of Object.keys(o)) {
    const v = o[k]
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) delete o[k]
  }
  return o
}

/** Тег outbound по действию правила */
function tagFor(action            )                     {
  return action === 'proxy' ? TAG_PROXY : action === 'direct' ? TAG_DIRECT : undefined
}

/** Matcher[] → поля правила sing-box. null если правило пустое.

    skipProcess выбрасывает условия по процессам — на мобильных их не существует.
    Правило при этом может остаться без единого условия; тогда функция вернёт
    null и вызывающий его отбросит. Это принципиально: правило, потерявшее
    единственное условие, совпадало бы со всем трафиком подряд. */
function matchersToRule(matchers           , skipProcess = false)              {
  const r       = {}
  for (const m of matchers) {
    const vals = m.values.map((v) => v.trim()).filter(Boolean)
    if (!vals.length) continue
    if (skipProcess && (m.kind === 'process' || m.kind === 'process_path')) continue
    switch (m.kind) {
      case 'process':
        r.process_name = [...(r.process_name ?? []), ...vals]
        break
      case 'process_path':
        r.process_path = [...(r.process_path ?? []), ...vals]
        break
      case 'domain':
        r.domain = [...(r.domain ?? []), ...vals]
        break
      case 'domain_suffix':
        r.domain_suffix = [...(r.domain_suffix ?? []), ...vals]
        break
      case 'domain_keyword':
        r.domain_keyword = [...(r.domain_keyword ?? []), ...vals]
        break
      case 'domain_regex':
        r.domain_regex = [...(r.domain_regex ?? []), ...vals]
        break
      case 'ip_cidr':
        r.ip_cidr = [...(r.ip_cidr ?? []), ...vals]
        break
      case 'port':
        r.port = [...(r.port ?? []), ...vals.map((v) => parseInt(v, 10)).filter(Number.isFinite)]
        break
      case 'port_range':
        r.port_range = [...(r.port_range ?? []), ...vals]
        break
      case 'ruleset':
        r.rule_set = [...(r.rule_set ?? []), ...vals.filter((v) => RULE_SET_TAGS.has(v))]
        break
      case 'network':
        r.network = [...(r.network ?? []), ...vals]
        break
      case 'protocol':
        r.protocol = [...(r.protocol ?? []), ...vals]
        break
    }
  }
  return Object.keys(r).length ? r : null
}

/** Строка DNS → серверный объект sing-box 1.12+ */
function parseDnsServer(raw        , tag        , detour         )       {
  const s = (raw || '').trim()
  const base       = { tag }
  if (detour) base.detour = detour

  if (!s || s === 'local' || s === 'system') return { ...base, type: 'local' }

  const m = s.match(/^([a-z0-9+]+):\/\/(.+)$/i)
  if (!m) {
    // Голый IP или домен → обычный UDP
    const [host, port] = s.split(':')
    return drop({ ...base, type: 'udp', server: host, server_port: port ? parseInt(port, 10) : undefined })
  }

  const scheme = m[1].toLowerCase()
  let rest = m[2]
  let path                    
  const slash = rest.indexOf('/')
  if (slash >= 0) {
    path = rest.slice(slash)
    rest = rest.slice(0, slash)
  }
  const colon = rest.lastIndexOf(':')
  const hasPort = colon > rest.lastIndexOf(']')
  const host = hasPort ? rest.slice(0, colon) : rest
  const port = hasPort ? parseInt(rest.slice(colon + 1), 10) : undefined

  const typeMap                         = {
    udp: 'udp',
    dns: 'udp',
    tcp: 'tcp',
    tls: 'tls',
    'dot': 'tls',
    https: 'https',
    'doh': 'https',
    h3: 'h3',
    quic: 'quic',
    doq: 'quic',
    dhcp: 'dhcp',
    rcode: 'rcode'
  }
  const type = typeMap[scheme] ?? 'udp'
  if (type === 'dhcp') return { ...base, type: 'dhcp' }
  return drop({
    ...base,
    type,
    server: host.replace(/^\[|\]$/g, ''),
    server_port: port,
    path: type === 'https' || type === 'h3' ? path || '/dns-query' : undefined
  })
}

/* ─────────────────────────── основной сборщик ─────────────────────────── */

function buildConfig(ctx              )       {
  const { settings: st } = ctx
  const isMobile = ctx.platform === 'ios' || ctx.platform === 'android'
  const usedRuleSets = new Set        ()
  const routeRules         = []

  const noteRuleSets = (r             ) => {
    if (r?.rule_set) for (const t of r.rule_set            ) usedRuleSets.add(t)
    return r
  }

  /* ── 1. Служебные правила ── */
  routeRules.push({ action: 'sniff', timeout: '500ms' })
  routeRules.push({ protocol: 'dns', action: 'hijack-dns' })

  // Локальная сеть всегда мимо туннеля, иначе отвалятся принтеры/NAS/роутер
  if (st.bypassPrivate) {
    routeRules.push({ ip_is_private: true, outbound: TAG_DIRECT })
  }

  /* ── 2. Блокировка QUIC ──
     UDP/443 роняем, чтобы браузеры и Discord CDN откатились на TCP —
     он проксируется надёжно. Голосовые порты Discord (50000+) не трогаем. */
  if (st.blockQuic) {
    routeRules.push({ network: ['udp'], port: [443], action: 'reject', method: 'default' })
  }

  /* ── 3. Правила по приложениям (высший пользовательский приоритет) ──
     На мобильных пропускаются целиком: process_name там неприменим — система не
     даёт туннелю узнать, какому приложению принадлежит трафик. На iOS раздельная
     маршрутизация существует только как per-app VPN под управлением MDM,
     на Android — через отдельный механизм VpnService, а не через конфиг ядра. */
  if (!isMobile) {
    const byAction                               = { proxy: [], direct: [], block: [] }
    for (const a of ctx.appRules) {
      if (a.enabled && a.exe.trim()) byAction[a.action].push(a.exe.trim())
    }
    for (const action of ['block', 'direct', 'proxy']                ) {
      if (byAction[action].length) {
        const tag = tagFor(action)
        routeRules.push(drop({ process_name: byAction[action], outbound: tag, action: tag ? undefined : 'reject' }))
      }
    }
  }

  /* ── 4. Пользовательские правила (в порядке списка) ── */
  for (const rule of ctx.customRules) {
    if (!rule.enabled) continue
    const r = noteRuleSets(matchersToRule(rule.matchers, isMobile))
    if (!r) continue
    const tag = rule.outboundTag ?? tagFor(rule.action)
    routeRules.push(drop({ ...r, outbound: tag, action: tag ? undefined : 'reject' }))
  }

  /* ── 5. Пресеты ── */
  const activePresets = ctx.enabledPresets.map(presetById).filter(Boolean)
  // Сначала block, потом force-proxy, потом bypass — чтобы обходы не перебивали фиксы
  const order = { block: 0, fix: 1, force: 2, bypass: 3 }         
  activePresets.sort((a, b) => order[a .group] - order[b .group])
  for (const p of activePresets) {
    for (const pr of p .rules) {
      const r = noteRuleSets(matchersToRule(pr.matchers, isMobile))
      if (!r) continue
      const tag = tagFor(pr.action)
      routeRules.push(drop({ ...r, outbound: tag, action: tag ? undefined : 'reject' }))
    }
  }

  /* ── 6. Итоговое направление ── */
  let finalTag        
  switch (st.routingMode) {
    case 'global':
      finalTag = TAG_PROXY
      break
    case 'direct':
      finalTag = TAG_DIRECT
      break
    case 'whitelist':
      // Всё напрямую, в туннель уходит только явно перечисленное выше
      finalTag = TAG_DIRECT
      break
    default:
      finalTag = TAG_PROXY
  }

  // В global-режиме обходные правила смысла не имеют — вырезаем их
  const rules =
    st.routingMode === 'global'
      ? routeRules.filter((r) => r.outbound !== TAG_DIRECT || r.ip_is_private)
      : routeRules

  /* ── DNS ──
     detour указываем только на реальный прокси: ядро ругается
     «detour to an empty direct outbound makes no sense», если увести
     запросы в обычный direct. Прямой резолвер и так ходит напрямую. */
  const hasProxy = ctx.nodes.length > 0
  const dnsServers         = [
    parseDnsServer(st.dns.remote || 'https://1.1.1.1/dns-query', 'dns-remote', hasProxy ? TAG_PROXY : undefined),
    parseDnsServer(st.dns.local || '77.88.8.8', 'dns-direct')
  ]
  if (st.dns.fakeIp) {
    dnsServers.push({
      type: 'fakeip',
      tag: 'dns-fake',
      inet4_range: '198.18.0.0/15',
      inet6_range: 'fc00::/18'
    })
  }

  const dnsRules         = []
  if (st.dns.blockAds) {
    dnsRules.push({ rule_set: ['geosite-category-ads-all'], action: 'reject' })
    usedRuleSets.add('geosite-category-ads-all')
  }
  // Discord резолвим только через прокси — иначе провайдер подсунет мусорные адреса
  if (st.discordFix) {
    dnsRules.push({ domain_suffix: DISCORD_DOMAINS, server: 'dns-remote' })
    dnsRules.push({ rule_set: ['geosite-discord'], server: 'dns-remote' })
    usedRuleSets.add('geosite-discord')
  }
  if (st.dns.splitDns && st.routingMode !== 'global') {
    dnsRules.push({
      rule_set: ['geosite-category-ru', 'geosite-tld-ru', 'geosite-yandex', 'geosite-vk', 'geosite-mailru'],
      server: 'dns-direct'
    })
    ;['geosite-category-ru', 'geosite-tld-ru', 'geosite-yandex', 'geosite-vk', 'geosite-mailru'].forEach((t) =>
      usedRuleSets.add(t)
    )
  }
  if (st.dns.fakeIp) {
    dnsRules.push({ query_type: ['A', 'AAAA'], server: 'dns-fake' })
  }

  const dns       = drop({
    servers: dnsServers,
    rules: dnsRules,
    final: st.routingMode === 'direct' ? 'dns-direct' : 'dns-remote',
    strategy: st.dns.strategy,
    independent_cache: true,
    reverse_mapping: st.dns.fakeIp
  })

  /* ── Inbounds ── */
  const inbounds         = []
  // На iOS туннель существует всегда: режима «только системный прокси» там нет,
  // трафик приходит из NetworkExtension, и tun — точка его входа в ядро.
  if (st.captureMode === 'tun' || isMobile) {
    inbounds.push(
      drop({
        type: 'tun',
        tag: 'tun-in',
        address: st.tun.ipv6 ? ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'] : ['172.19.0.1/30'],
        mtu: st.tun.mtu,
        auto_route: st.tun.autoRoute,
        // strict_route действует только на Windows и Linux. Схему конфига поле
        // проходит везде и ядро молча его примет — тем важнее не оставлять его
        // на iOS: маршрутизацией там ведает NetworkExtension, и поле создавало бы
        // ложное впечатление, будто оно на что-то влияет
        strict_route: isMobile ? undefined : st.tun.strictRoute,
        stack: st.tun.stack,
        // Эти процессы ядро вообще не заворачивает в TUN
        exclude_package: undefined
      })
    )
  }
  // Локальный mixed-порт открыт всегда — в него можно ходить вручную из любой программы.
  // set_system_proxy намеренно не включаем: прокси прописывает само приложение,
  // чтобы гарантированно снять его даже если ядро упало.
  inbounds.push({
    type: 'mixed',
    tag: 'mixed-in',
    listen: st.allowLan ? '0.0.0.0' : '127.0.0.1',
    listen_port: st.localPort
  })

  /* ── Outbounds ── */
  const nodeOutbounds         = []
  const nodeTags           = []
  const seen = new Set        ()
  for (const n of ctx.nodes) {
    let tag = n.name?.trim() || `${n.server}:${n.port}`
    // Теги обязаны быть уникальными
    let i = 2
    const base = tag
    while (seen.has(tag)) tag = `${base} (${i++})`
    seen.add(tag)
    nodeTags.push(tag)
    nodeOutbounds.push({ ...n.outbound, tag })
  }

  const activeIdx = ctx.nodes.findIndex((n) => n.id === ctx.activeNodeId)
  const defaultTag = activeIdx >= 0 ? nodeTags[activeIdx] : nodeTags[0]

  const outbounds         = []
  if (nodeTags.length) {
    outbounds.push(
      drop({
        type: 'selector',
        tag: TAG_PROXY,
        outbounds: [...nodeTags, TAG_AUTO],
        default: defaultTag,
        interrupt_exist_connections: false
      })
    )
    outbounds.push({
      type: 'urltest',
      tag: TAG_AUTO,
      outbounds: nodeTags,
      url: 'https://www.gstatic.com/generate_204',
      interval: '10m',
      tolerance: 50,
      idle_timeout: '30m',
      interrupt_exist_connections: false
    })
    outbounds.push(...nodeOutbounds)
  } else {
    // Без серверов «прокси» = напрямую, чтобы конфиг оставался валидным
    outbounds.push({ type: 'direct', tag: TAG_PROXY })
  }
  outbounds.push({ type: 'direct', tag: TAG_DIRECT })

  /* ── rule_set (только реально задействованные) ── */
  // Правила берутся из файлов, если каталог с ними задан, и скачиваются иначе.
  // Это не про платформу: .srs весят вместе 350 КБ, и класть их в приложение
  // выгоднее везде, где это возможно. Ядро скачивает удалённые правила при
  // старте и все сразу — то есть без сети туннель не поднимется вовсе, а через
  // прокси возникает и вовсе замкнутый круг: чтобы включить прокси, нужен прокси.
  const localRules = ctx.rulesDir.trim().length > 0
  const ruleSetDefs = [...usedRuleSets].map((tag) =>
    localRules
      ? {
          type: 'local',
          tag,
          format: 'binary',
          path: joinPath(ctx.rulesDir, `${tag}.srs`)
        }
      : {
          type: 'remote',
          tag,
          format: 'binary',
          url: ruleSetUrl(tag),
          // Напрямую, а не через прокси: скачивание правил не должно зависеть
          // от туннеля, который без этих же правил не запустится
          download_detour: TAG_DIRECT,
          update_interval: '7d'
        }
  )

  const config       = {
    log: { level: st.logLevel, timestamp: true },
    dns,
    inbounds,
    outbounds,
    route: drop({
      rules,
      rule_set: ruleSetDefs,
      final: finalTag,
      auto_detect_interface: true,
      default_domain_resolver: { server: 'dns-direct' }
    }),
    experimental: {
      cache_file: { enabled: true, path: ctx.cachePath, store_fakeip: st.dns.fakeIp, store_rdrc: true },
      clash_api: {
        external_controller: `127.0.0.1:${st.clashPort}`,
        secret: ctx.clashSecret,
        default_mode: 'rule'
      }
    }
  }

  /* ── Пользовательский JSON поверх ── */
  if (st.extraConfig?.trim()) {
    try {
      return deepMerge(config, JSON.parse(st.extraConfig))
    } catch {
      /* невалидный JSON игнорируем — о нём сообщит проверка в UI */
    }
  }
  return config
}

/* ─────────────────────────── helpers ─────────────────────────── */

function joinPath(dir        , file        )         {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.endsWith(sep) ? dir + file : dir + sep + file
}

function deepMerge                (base   , patch      )    {
  const out       = Array.isArray(base) ? [...(base       )] : { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (Array.isArray(v)) {
      out[k] = v
    } else if (v && typeof v === 'object') {
      out[k] = out[k] && typeof out[k] === 'object' ? deepMerge(out[k], v) : v
    } else {
      out[k] = v
    }
  }
  return out     
}

/** Конфиг для быстрой проверки задержки одного узла */
function buildLatencyConfig(node            , port        , cachePath        )       {
  return {
    log: { level: 'error' },
    inbounds: [{ type: 'mixed', tag: 'in', listen: '127.0.0.1', listen_port: port }],
    outbounds: [{ ...node.outbound, tag: 'out' }, { type: 'direct', tag: 'direct' }],
    route: {
      rules: [{ action: 'sniff' }],
      final: 'out',
      default_domain_resolver: { server: 'dns-direct' }
    },
    dns: { servers: [{ type: 'udp', tag: 'dns-direct', server: '1.1.1.1', detour: 'direct' }] },
    experimental: { cache_file: { enabled: false, path: cachePath } }
  }
}

  root.PrismShared = {
    DEFAULT_ENABLED_PRESETS: typeof DEFAULT_ENABLED_PRESETS === 'undefined' ? undefined : DEFAULT_ENABLED_PRESETS,
    DEFAULT_PRESETS: typeof DEFAULT_PRESETS === 'undefined' ? undefined : DEFAULT_PRESETS,
    DEFAULT_SETTINGS: typeof DEFAULT_SETTINGS === 'undefined' ? undefined : DEFAULT_SETTINGS,
    DISCORD_DOMAINS: typeof DISCORD_DOMAINS === 'undefined' ? undefined : DISCORD_DOMAINS,
    DISCORD_PROCESSES: typeof DISCORD_PROCESSES === 'undefined' ? undefined : DISCORD_PROCESSES,
    DISCORD_VOICE_PORTS: typeof DISCORD_VOICE_PORTS === 'undefined' ? undefined : DISCORD_VOICE_PORTS,
    DNS_PRESETS_LOCAL: typeof DNS_PRESETS_LOCAL === 'undefined' ? undefined : DNS_PRESETS_LOCAL,
    DNS_PRESETS_REMOTE: typeof DNS_PRESETS_REMOTE === 'undefined' ? undefined : DNS_PRESETS_REMOTE,
    PRESETS: typeof PRESETS === 'undefined' ? undefined : PRESETS,
    RULE_SETS: typeof RULE_SETS === 'undefined' ? undefined : RULE_SETS,
    RULE_SET_TAGS: typeof RULE_SET_TAGS === 'undefined' ? undefined : RULE_SET_TAGS,
    SUGGESTED_APPS: typeof SUGGESTED_APPS === 'undefined' ? undefined : SUGGESTED_APPS,
    TAG_AUTO: typeof TAG_AUTO === 'undefined' ? undefined : TAG_AUTO,
    TAG_DIRECT: typeof TAG_DIRECT === 'undefined' ? undefined : TAG_DIRECT,
    TAG_PROXY: typeof TAG_PROXY === 'undefined' ? undefined : TAG_PROXY,
    b64decode: typeof b64decode === 'undefined' ? undefined : b64decode,
    buildConfig: typeof buildConfig === 'undefined' ? undefined : buildConfig,
    buildLatencyConfig: typeof buildLatencyConfig === 'undefined' ? undefined : buildLatencyConfig,
    clashProxyToNode: typeof clashProxyToNode === 'undefined' ? undefined : clashProxyToNode,
    deepMerge: typeof deepMerge === 'undefined' ? undefined : deepMerge,
    looksBase64: typeof looksBase64 === 'undefined' ? undefined : looksBase64,
    nodeKey: typeof nodeKey === 'undefined' ? undefined : nodeKey,
    parseDnsServer: typeof parseDnsServer === 'undefined' ? undefined : parseDnsServer,
    parseLink: typeof parseLink === 'undefined' ? undefined : parseLink,
    parseSubscriptionBody: typeof parseSubscriptionBody === 'undefined' ? undefined : parseSubscriptionBody,
    parsedToNode: typeof parsedToNode === 'undefined' ? undefined : parsedToNode,
    presetById: typeof presetById === 'undefined' ? undefined : presetById,
    ruleSetLabel: typeof ruleSetLabel === 'undefined' ? undefined : ruleSetLabel,
    ruleSetUrl: typeof ruleSetUrl === 'undefined' ? undefined : ruleSetUrl,
    uid: typeof uid === 'undefined' ? undefined : uid
  };
})(globalThis);
