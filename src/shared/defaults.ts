import type { Settings } from './types'
import { DEFAULT_PRESETS } from './presets'

export const DEFAULT_SETTINGS: Settings = {
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
  graphStyle: 'mirror',
  language: 'ru',
  logLevel: 'info',

  extraConfig: '',
  manualConfig: false
}

export const DEFAULT_ENABLED_PRESETS = DEFAULT_PRESETS

/** Популярные DNS для выпадающего списка */
export const DNS_PRESETS_REMOTE = [
  { label: 'Cloudflare (DoH)', value: 'https://1.1.1.1/dns-query' },
  { label: 'Google (DoH)', value: 'https://8.8.8.8/dns-query' },
  { label: 'Quad9 (DoH)', value: 'https://9.9.9.9/dns-query' },
  { label: 'AdGuard без рекламы (DoH)', value: 'https://94.140.14.14/dns-query' },
  { label: 'Cloudflare (DoT)', value: 'tls://1.1.1.1' },
  { label: 'Cloudflare (обычный)', value: '1.1.1.1' }
]

export const DNS_PRESETS_LOCAL = [
  { label: 'Яндекс DNS', value: '77.88.8.8' },
  { label: 'DNS провайдера (системный)', value: 'local' },
  { label: 'Google', value: '8.8.8.8' },
  { label: 'Cloudflare', value: '1.1.1.1' },
  { label: 'DHCP', value: 'dhcp://auto' }
]
