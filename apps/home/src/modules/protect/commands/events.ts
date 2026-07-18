import type { CommandSpec } from '../../../core/types'
import { getEvent, getEvents, readProtectConfig } from '../client'

function parseSince(value: string | undefined): number {
  if (!value) return Date.now() - 60 * 60 * 1000
  const m = /^(\d+)(s|m|h|d)$/.exec(value)
  if (m) {
    const n = Number(m[1])
    const unit = m[2]!
    const ms = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
    return Date.now() - n * ms
  }
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return Date.now() - 60 * 60 * 1000
  return parsed
}

interface ProtectEvent {
  type?: string
  smartDetectTypes?: string[]
  camera?: string
  start?: number
  end?: number
  id?: string
}

async function fetchEvents(cfg: ReturnType<typeof readProtectConfig>, since: string | undefined): Promise<ProtectEvent[]> {
  const start = parseSince(since)
  const end = Date.now()
  return (await getEvents(cfg, start, end)) as ProtectEvent[]
}

export const eventsList: CommandSpec = {
  path: ['events', 'list'],
  effect: 'read',
  description: 'List recent Protect events',
  args: [
    { name: 'since', kind: 'string', description: 'Window start: e.g. 1h, 24h, 7d, or ISO timestamp', default: '1h' },
    { name: 'limit', kind: 'number', description: 'Max events to return', default: 50 },
  ],
  examples: ['home protect events list --since 1h --limit 20 --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const since = ctx.args.since as string | undefined
    const limit = Number(ctx.args.limit ?? 50)
    const events = await fetchEvents(cfg, since)
    const sliced = events.slice(-limit).reverse()
    return { ok: true, data: sliced }
  },
}

export const eventsGet: CommandSpec = {
  path: ['events', 'get'],
  effect: 'read',
  description: 'Fetch a single event by id',
  args: [{ name: 'id', kind: 'positional', description: 'Event id', required: true }],
  examples: ['home protect events get <id> --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const id = String(ctx.args.id ?? '')
    if (!id) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }
    const event = await getEvent(cfg, id)
    if (!event) return { ok: false, kind: 'user', message: `no event with id ${id}`, code: 'not_found' }
    return { ok: true, data: event }
  },
}

export const eventsRecent: CommandSpec = {
  path: ['events', 'recent'],
  effect: 'read',
  description: 'Pre-filtered recent events (motion or smart-detect), newest-first',
  args: [
    { name: 'type', kind: 'string', description: 'Event type: motion | smart', enum: ['motion', 'smart'], default: 'motion' },
    { name: 'camera', kind: 'string', description: 'Filter by camera id (optional)' },
    { name: 'limit', kind: 'number', description: 'Max events', default: 10 },
    { name: 'since', kind: 'string', description: 'Window start: e.g. 1h, 24h', default: '24h' },
  ],
  examples: [
    'home protect events recent --type motion --limit 5 --json',
    'home protect events recent --type smart --camera <id> --json',
  ],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const since = ctx.args.since as string | undefined
    const limit = Number(ctx.args.limit ?? 10)
    const type = String(ctx.args.type ?? 'motion')
    const cameraId = ctx.args.camera ? String(ctx.args.camera) : undefined
    const events = await fetchEvents(cfg, since)
    const filtered = events.filter((e) => {
      if (cameraId && e.camera !== cameraId) return false
      if (type === 'motion') return e.type === 'motion'
      if (type === 'smart') return e.type === 'smartDetectZone' || (e.smartDetectTypes?.length ?? 0) > 0
      return true
    })
    const sliced = filtered.slice(-limit).reverse()
    return { ok: true, data: sliced }
  },
}
