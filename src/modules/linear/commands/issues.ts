import type { CommandSpec } from '../../../core/types'
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  buildIssueFilter,
  getIssue,
  listIssues,
  parseIssueRef,
  searchIssues,
  toIssueRow,
  type IssueDetail,
} from '../client'
import { buildFilterInput, getLinearConfig, parseLimit, resolveTeamScope, withWarnings } from './shared'

const FILTER_ARGS = [
  { name: 'team', kind: 'string', description: 'Team key (UPT), name, or id — defaults to the configured defaultTeam' },
  { name: 'state', kind: 'string', description: 'Workflow state name (case-insensitive) or state id' },
  { name: 'assignee', kind: 'string', description: 'Assignee — "me", user id, email, or exact name' },
  { name: 'project', kind: 'string', description: 'Project id or exact name (case-insensitive)' },
  { name: 'limit', kind: 'number', description: `Max results (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT})` },
] as const

function shapeIssueDetail(issue: IssueDetail) {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    url: issue.url,
    state: issue.state ? { name: issue.state.name, type: issue.state.type } : null,
    assignee: issue.assignee ? (issue.assignee.displayName ?? issue.assignee.name) : null,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel ?? null,
    estimate: issue.estimate ?? null,
    team: issue.team ? { key: issue.team.key, name: issue.team.name } : null,
    project: issue.project?.name ?? null,
    cycle: issue.cycle ? { number: issue.cycle.number, name: issue.cycle.name ?? null } : null,
    parent: issue.parent ? { identifier: issue.parent.identifier, title: issue.parent.title } : null,
    labels: (issue.labels?.nodes ?? []).map((l) => l.name),
    relations: (issue.relations?.nodes ?? []).map((r) => ({
      type: r.type,
      issue: { identifier: r.relatedIssue.identifier, title: r.relatedIssue.title },
    })),
    inverseRelations: (issue.inverseRelations?.nodes ?? []).map((r) => ({
      type: r.type,
      issue: { identifier: r.issue.identifier, title: r.issue.title },
    })),
    commentCount: issue.comments?.nodes.length ?? 0,
    hasMoreComments: issue.comments?.pageInfo.hasNextPage ?? false,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  }
}

export const issuesList: CommandSpec = {
  path: ['issues', 'list'],
  effect: 'read',
  description:
    'List issues ordered by last update, filtered by team, workflow state, assignee, and/or project.',
  args: [...FILTER_ARGS],
  examples: [
    'home linear issues list --json',
    'home linear issues list --team UPT --state "In Progress" --json',
    'home linear issues list --assignee me --project "Hermes swarm" --limit 10 --json',
  ],
  async run(ctx) {
    const limit = parseLimit(ctx)
    if (limit.error) return { ok: false, kind: 'user', message: limit.error, code: 'bad_arg' }
    if (limit.warning) ctx.log.warn(limit.warning)

    const cfg = getLinearConfig(ctx)
    const scope = await resolveTeamScope(ctx, cfg)
    const { input, warnings } = await buildFilterInput(ctx, cfg, scope)
    const page = await listIssues(cfg, buildIssueFilter(input), limit.value!)
    return {
      ok: true,
      data: withWarnings(
        { issues: page.nodes.map(toIssueRow) },
        [...scope.warnings, ...warnings, ...page.warnings],
      ),
    }
  },
}

export const issuesGet: CommandSpec = {
  path: ['issues', 'get'],
  effect: 'read',
  description:
    'Get one issue in full — description, relations, labels, project, cycle, comment count — by identifier (UPT-123) or UUID.',
  args: [{ name: 'issue', kind: 'positional', description: 'Issue identifier (UPT-123) or UUID', required: true }],
  examples: ['home linear issues get UPT-123 --json'],
  async run(ctx) {
    const raw = String(ctx.args.issue ?? '').trim()
    const ref = raw ? parseIssueRef(raw) : null
    if (!ref) {
      return {
        ok: false,
        kind: 'user',
        message: `"${raw}" is not an issue identifier (UPT-123) or UUID`,
        code: 'bad_arg',
      }
    }
    const cfg = getLinearConfig(ctx)
    const { data, warnings } = await getIssue(cfg, ref)
    return { ok: true, data: withWarnings({ issue: shapeIssueDetail(data) }, warnings) }
  },
}

export const issuesSearch: CommandSpec = {
  path: ['issues', 'search'],
  effect: 'read',
  description: 'Full-text search over issues, optionally scoped to a team.',
  args: [
    { name: 'query', kind: 'positional', description: 'Search text', required: true },
    { name: 'team', kind: 'string', description: 'Team key (UPT), name, or id — defaults to the configured defaultTeam' },
    { name: 'limit', kind: 'number', description: `Max results (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT})` },
  ],
  examples: ['home linear issues search "keyring secrets" --team UPT --json'],
  async run(ctx) {
    const term = String(ctx.args.query ?? '').trim()
    if (!term) return { ok: false, kind: 'user', message: 'query is required', code: 'missing_arg' }

    const limit = parseLimit(ctx)
    if (limit.error) return { ok: false, kind: 'user', message: limit.error, code: 'bad_arg' }
    if (limit.warning) ctx.log.warn(limit.warning)

    const cfg = getLinearConfig(ctx)
    const scope = await resolveTeamScope(ctx, cfg)
    const filter = buildIssueFilter(scope.team ? { teamId: scope.team.id } : {})
    const page = await searchIssues(cfg, term, filter, limit.value!)
    return {
      ok: true,
      data: withWarnings(
        { issues: page.nodes.map(toIssueRow) },
        [...scope.warnings, ...page.warnings],
      ),
    }
  },
}
