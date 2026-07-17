import type { CommandSpec } from '../../../core/types'
import { DEFAULT_LIMIT, MAX_LIMIT, isActiveCycle, listCycles, type CycleNode } from '../client'
import { getLinearConfig, parseLimit, resolveTeamScope, withWarnings } from './shared'

function shapeCycleRow(c: CycleNode) {
  return {
    id: c.id,
    number: c.number,
    name: c.name ?? null,
    team: c.team?.key ?? null,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    progress: c.progress ?? null,
    active: isActiveCycle(c, new Date()),
  }
}

export const cyclesList: CommandSpec = {
  path: ['cycles', 'list'],
  effect: 'read',
  description: 'List cycles with number, name, start/end, and progress.',
  args: [
    { name: 'team', kind: 'string', description: 'Team key (UPT), name, or id — defaults to the configured defaultTeam' },
    { name: 'active', kind: 'boolean', description: 'Only the currently running cycle(s)' },
    { name: 'limit', kind: 'number', description: `Max results (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT})` },
  ],
  examples: ['home linear cycles list --team UPT --json', 'home linear cycles list --active --json'],
  async run(ctx) {
    const limit = parseLimit(ctx)
    if (limit.error) return { ok: false, kind: 'user', message: limit.error, code: 'bad_arg' }
    if (limit.warning) ctx.log.warn(limit.warning)

    const cfg = getLinearConfig(ctx)
    const scope = await resolveTeamScope(ctx, cfg)
    const page = await listCycles(cfg, scope.team?.id, limit.value!)
    const rows = page.nodes.map(shapeCycleRow).filter((c) => !ctx.args.active || c.active)
    return { ok: true, data: withWarnings({ cycles: rows }, [...scope.warnings, ...page.warnings]) }
  },
}
