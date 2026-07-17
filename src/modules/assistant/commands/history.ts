import type { CommandSpec } from '../../../core/types'
import { history, readAssistantConfig } from '../client'

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

export const historyGet: CommandSpec = {
  path: ['history', 'get'],
  effect: 'read',
  description: 'Recent state history for a single entity',
  args: [
    { name: 'entity', kind: 'positional', description: 'entity_id', required: true },
    { name: 'since', kind: 'string', description: 'Window start: 1h | 24h | 7d | ISO', default: '1h' },
  ],
  examples: [
    'home assistant history get binary_sensor.front_door --since 12h --json',
    'home assistant history get sensor.living_room_temperature --since 24h --json',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const entity = String(ctx.args.entity ?? '')
    if (!entity) return { ok: false, kind: 'user', message: 'entity is required', code: 'missing_arg' }
    const startIso = parseSinceIso(ctx.args.since as string | undefined)
    const data = await history(cfg, entity, startIso)
    return { ok: true, data }
  },
}
