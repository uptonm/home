import type { CommandSpec } from '../../../core/types'
import {
  RESOLVE_LIMIT,
  blockedBy,
  buildIssueFilter,
  getTeamActiveCycle,
  isProjectAtRisk,
  listMyOpenIssuesWithRelations,
  listProjects,
  orderMyWork,
  toIssueRow,
  type CycleNode,
} from '../client'
import { getLinearConfig, resolveTeamScope, withWarnings } from './shared'

const SUMMARY_ISSUE_LIMIT = 50

function shapeCycle(c: CycleNode) {
  return {
    number: c.number,
    name: c.name ?? null,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    progress: c.progress ?? null,
  }
}

export const summaryCmd: CommandSpec = {
  path: ['summary'],
  effect: 'read',
  description:
    'One planning snapshot: your active issues, which of them are blocked, the active cycle with progress, and projects at risk.',
  args: [
    { name: 'team', kind: 'string', description: 'Team key (UPT), name, or id — defaults to the configured defaultTeam' },
  ],
  examples: ['home linear summary --json', 'home linear summary --team UPT --json'],
  async run(ctx) {
    const cfg = getLinearConfig(ctx)
    const scope = await resolveTeamScope(ctx, cfg)
    const warnings = [...scope.warnings]

    const filter = buildIssueFilter({
      teamId: scope.team?.id,
      stateTypes: { in: ['triage', 'started', 'unstarted'] },
    })
    const mine = await listMyOpenIssuesWithRelations(cfg, filter, SUMMARY_ISSUE_LIMIT)
    warnings.push(...mine.warnings)

    const blockedIssues = mine.nodes
      .map((n) => ({ identifier: n.identifier, title: n.title, blockedBy: blockedBy(n) }))
      .filter((b) => b.blockedBy.length > 0)

    let activeCycle = null
    if (scope.team) {
      const team = await getTeamActiveCycle(cfg, scope.team.id)
      warnings.push(...team.warnings)
      activeCycle = team.data.activeCycle ? shapeCycle(team.data.activeCycle) : null
    }

    const projects = await listProjects(cfg, RESOLVE_LIMIT)
    warnings.push(...projects.warnings)
    const projectsAtRisk = projects.nodes.filter(isProjectAtRisk).map((p) => ({
      id: p.id,
      name: p.name,
      state: p.state,
      health: p.health ?? null,
      progress: p.progress ?? null,
      targetDate: p.targetDate ?? null,
    }))

    return {
      ok: true,
      data: withWarnings(
        {
          team: scope.team ? { key: scope.team.key, name: scope.team.name } : null,
          myActiveIssues: orderMyWork(mine.nodes.map(toIssueRow)),
          blockedIssues,
          activeCycle,
          projectsAtRisk,
        },
        warnings,
      ),
    }
  },
}
