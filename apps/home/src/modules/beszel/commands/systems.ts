import type { CommandSpec } from '../../../core/types'
import { createTransport, pbQuote, readBeszelConfig } from '../client'
import { SYSTEM_STATUSES, normalizeSystemStats } from '../adapter'
import { fetchSystems, pickSystem, requiredPositional } from './shared'

export const systemsListCmd: CommandSpec = {
  path: ['systems', 'list'],
  effect: 'read',
  description: 'List monitored systems: status (up/down/paused/pending) and headline cpu/memory/disk %',
  args: [
    {
      name: 'status',
      kind: 'string',
      description: 'Only systems in this status',
      enum: SYSTEM_STATUSES,
    },
  ],
  examples: ['home beszel systems list --json', 'home beszel systems list --status down --json'],
  async run(ctx) {
    const status = ctx.args.status === undefined ? undefined : String(ctx.args.status).trim()
    if (status && !(SYSTEM_STATUSES as readonly string[]).includes(status)) {
      return {
        ok: false,
        kind: 'user',
        message: `--status must be one of ${SYSTEM_STATUSES.join(', ')}, got "${status}"`,
        code: 'bad_arg',
      }
    }
    const t = createTransport(readBeszelConfig(ctx.config))
    const data = await fetchSystems(t, status ? `status=${pbQuote(status)}` : undefined)
    return { ok: true, data }
  },
}

export const systemsGetCmd: CommandSpec = {
  path: ['systems', 'get'],
  effect: 'read',
  description: 'One system by id or exact name, with its latest 1-minute stats sample',
  args: [{ name: 'system', kind: 'positional', description: 'System id or exact name', required: true }],
  examples: ['home beszel systems get boris --json'],
  async run(ctx) {
    const ref = requiredPositional(ctx, 'system')
    if (!ref) return { ok: false, kind: 'user', message: 'system id or name is required', code: 'missing_arg' }
    const t = createTransport(readBeszelConfig(ctx.config))
    const picked = pickSystem(await fetchSystems(t), ref)
    if (!picked.ok) return picked.error
    const [latest] = await t.list('system_stats', 1, {
      filter: `system=${pbQuote(picked.system.id)} && type="1m"`,
      sort: '-created',
    })
    return { ok: true, data: { ...picked.system, stats: latest ? normalizeSystemStats(latest) : null } }
  },
}
