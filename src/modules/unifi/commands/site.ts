import type { CommandSpec } from '../../../core/types'
import { readUnifiConfig, siteHealth, siteInfo } from '../client'

export const siteInfoCmd: CommandSpec = {
  path: ['site', 'info'],
  effect: 'read',
  description: 'Site identity and raw stats',
  args: [],
  examples: ['home unifi site info --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const data = await siteInfo(cfg)
    return { ok: true, data }
  },
}

export const siteHealthCmd: CommandSpec = {
  path: ['site', 'health'],
  effect: 'read',
  description: 'Per-subsystem site health (WAN, LAN, WLAN, WWW)',
  args: [],
  examples: [
    'home unifi site health --json',
    'home unifi site health --json | jq \'.[] | select(.status!="ok")\'',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const data = await siteHealth(cfg)
    return { ok: true, data }
  },
}
