import type { CommandSpec } from '../../../core/types'
import { logbook, readAssistantConfig } from '../client'

function parseSinceIso(value: string | undefined): string {
  const now = Date.now()
  if (!value) return new Date(now - 60 * 60 * 1000).toISOString()
  const m = /^(\d+)(s|m|h|d)$/.exec(value)
  if (m) {
    const n = Number(m[1])
    const unit = m[2]!
    const ms = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
    return new Date(now - n * ms).toISOString()
  }
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return new Date(now - 60 * 60 * 1000).toISOString()
  return new Date(parsed).toISOString()
}

export const logbookList: CommandSpec = {
  path: ['logbook', 'list'],
  effect: 'read',
  description: 'Recent human-readable Home Assistant events (with optional entity filter)',
  args: [
    { name: 'since', kind: 'string', description: 'Window start: 1h | 24h | ISO', default: '1h' },
    { name: 'entity', kind: 'string', description: 'Filter by entity_id (optional)' },
  ],
  examples: [
    'home assistant logbook list --since 1h --json',
    'home assistant logbook list --entity light.kitchen --since 24h --json',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const startIso = parseSinceIso(ctx.args.since as string | undefined)
    const entity = ctx.args.entity ? String(ctx.args.entity) : undefined
    const data = await logbook(cfg, startIso, entity)
    return { ok: true, data }
  },
}
