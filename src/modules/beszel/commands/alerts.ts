import type { CommandSpec } from '../../../core/types'
import { createTransport, pbQuote, readBeszelConfig } from '../client'
import { normalizeAlert } from '../adapter'
import { fetchSystems, parseLimit, pickSystem } from './shared'

const ALERTS_DEFAULT = 100
const ALERTS_MAX = 200

export const alertsListCmd: CommandSpec = {
  path: ['alerts', 'list'],
  effect: 'read',
  description: 'List configured alerts (type, threshold, triggered state), newest change first',
  args: [
    { name: 'system', kind: 'string', description: 'Only alerts for this system (id or exact name)' },
    { name: 'active', kind: 'boolean', description: 'Only currently-triggered alerts' },
    { name: 'limit', kind: 'number', description: `Max alerts returned (default ${ALERTS_DEFAULT}, cap ${ALERTS_MAX})` },
  ],
  examples: ['home beszel alerts list --active --json', 'home beszel alerts list --system boris --json'],
  async run(ctx) {
    const limit = parseLimit(ctx, ALERTS_DEFAULT, ALERTS_MAX)
    if (limit.error) return { ok: false, kind: 'user', message: limit.error, code: 'bad_arg' }
    const t = createTransport(readBeszelConfig(ctx.config))

    const filters: string[] = []
    const systemRef = ctx.args.system === undefined ? '' : String(ctx.args.system).trim()
    if (systemRef) {
      const picked = pickSystem(await fetchSystems(t), systemRef)
      if (!picked.ok) return picked.error
      filters.push(`system=${pbQuote(picked.system.id)}`)
    }
    if (ctx.args.active) filters.push('triggered=true')

    const raw = await t.list('alerts', limit.value, {
      filter: filters.length ? filters.join(' && ') : undefined,
      sort: '-updated',
      expand: 'system',
    })
    return { ok: true, data: raw.map(normalizeAlert) }
  },
}
