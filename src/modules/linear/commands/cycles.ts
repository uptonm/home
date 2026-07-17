import type { CommandSpec } from '../../../core/types'
import { DEFAULT_LIMIT, getTeamActiveCycle, isActiveCycle, listCycles, MAX_LIMIT, type CycleNode } from '../client'
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
    { name: 'active', kind: 'boolean', description: 'Only the currently running cycle (authoritative with --team; best-effort without one)' },
    { name: 'limit', kind: 'number', description: `Max results (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT})` },
  ],
  examples: ['home linear cycles list --team UPT --json', 'home linear cycles list --active --json'],
  async run(ctx) {
    const limit = parseLimit(ctx)
    if (limit.error) return { ok: false, kind: 'user', message: limit.error, code: 'bad_arg' }
    if (limit.warning) ctx.log.warn(limit.warning)

    const cfg = getLinearConfig(ctx)
    const scope = await resolveTeamScope(ctx, cfg)

    // The running cycle can sit far past the first page of a team's history, so
    // when a team is in scope ask the server for it directly rather than
    // fetch-then-filter, which has no ordering guarantee and would miss it.
    if (ctx.args.active && scope.team) {
      const team = await getTeamActiveCycle(cfg, scope.team.id)
      const active = team.data.activeCycle
      const rows = active
        ? [shapeCycleRow({ ...active, team: { id: scope.team.id, key: scope.team.key, name: scope.team.name } })]
        : []
      return { ok: true, data: withWarnings({ cycles: rows }, [...scope.warnings, ...team.warnings]) }
    }

    // Without a team `--active` is best-effort: scan the widest page we're
    // allowed, then apply --limit after filtering so it caps the result rather
    // than the pre-filter fetch (which could drop the running cycle).
    const fetchLimit = ctx.args.active ? MAX_LIMIT : limit.value!
    const page = await listCycles(cfg, scope.team?.id, fetchLimit)
    const rows = page.nodes
      .map(shapeCycleRow)
      .filter((c) => !ctx.args.active || c.active)
      .slice(0, limit.value!)
    return { ok: true, data: withWarnings({ cycles: rows }, [...scope.warnings, ...page.warnings]) }
  },
}
