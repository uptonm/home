import type { CommandSpec } from '../../../core/types'
import {
  getClientDpi,
  listAllClients,
  listAlarms,
  listEvents,
  listGuests,
  listRogueAps,
  listSiteDpi,
  readUnifiConfig,
} from '../client'

interface RawEvent { _id: string; key?: string; msg?: string; [key: string]: unknown }
interface RawAlarm { _id: string; msg?: string; [key: string]: unknown }

export const clientsAll: CommandSpec = {
  path: ['clients', 'all'],
  effect: 'read',
  description: 'List all known clients (including offline/disconnected)',
  args: [],
  examples: ['home unifi clients all', 'home unifi clients all --json | jq \'.[] | select(.use_fixedip)\''],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const data = await listAllClients(cfg)
    return { ok: true, data }
  },
}

export const eventsList: CommandSpec = {
  path: ['events', 'list'],
  effect: 'read',
  description: 'List recent network events',
  args: [
    { name: 'limit', kind: 'number', description: 'Max events to return (default: all)', required: false },
  ],
  examples: ['home unifi events list', 'home unifi events list --limit 20 --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const limit = ctx.args.limit ? Number(ctx.args.limit) : undefined
    const items = (await listEvents(cfg, limit)) as RawEvent[]
    const data = items
      .map((e) => ({ time: (e as any).datetime ?? '', key: e.key ?? '', msg: e.msg ?? '' }))
      .slice(0, 50)
    return { ok: true, data }
  },
}

export const alarmsList: CommandSpec = {
  path: ['alarms', 'list'],
  effect: 'read',
  description: 'List active and archived network alarms',
  args: [],
  examples: ['home unifi alarms list', 'home unifi alarms list --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const items = (await listAlarms(cfg)) as RawAlarm[]
    const data = items.map((a) => ({ time: (a as any).datetime ?? '', msg: a.msg ?? '' }))
    return { ok: true, data }
  },
}

export const rogueApsList: CommandSpec = {
  path: ['rogue-aps', 'list'],
  effect: 'read',
  description: 'List neighboring/rogue access points detected by your APs',
  args: [],
  examples: ['home unifi rogue-aps list', 'home unifi rogue-aps list --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const data = await listRogueAps(cfg)
    return { ok: true, data }
  },
}

export const guestsList: CommandSpec = {
  path: ['guests', 'list'],
  effect: 'read',
  description: 'List guest authorizations',
  args: [],
  examples: ['home unifi guests list', 'home unifi guests list --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const data = await listGuests(cfg)
    return { ok: true, data }
  },
}

export const dpiStatsSite: CommandSpec = {
  path: ['dpi-stats', 'site'],
  effect: 'read',
  description: 'List per-application DPI traffic stats for the entire site',
  args: [],
  examples: ['home unifi dpi-stats site', 'home unifi dpi-stats site --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const data = await listSiteDpi(cfg)
    return { ok: true, data }
  },
}

export const dpiStatsClient: CommandSpec = {
  path: ['dpi-stats', 'client'],
  effect: 'read',
  description: 'Get per-application DPI traffic stats for a single client by MAC',
  args: [{ name: 'mac', kind: 'positional', description: 'Client MAC (with or without colons)', required: true }],
  examples: ['home unifi dpi-stats client 78:8a:20:11:22:33', 'home unifi dpi-stats client 788a20112233 --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const raw = String(ctx.args.mac ?? '')
    if (!raw) return { ok: false, kind: 'user', message: 'mac is required', code: 'missing_arg' }
    const hex = raw.toLowerCase().replace(/[^0-9a-f]/g, '')
    if (hex.length !== 12) return { ok: false, kind: 'user', message: `invalid MAC: ${raw}`, code: 'invalid_arg' }
    const mac = hex.match(/.{1,2}/g)!.join(':')
    const data = await getClientDpi(cfg, mac)
    return { ok: true, data }
  },
}