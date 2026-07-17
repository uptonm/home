import { UserError } from '../../../core/errors'
import type { CommandSpec } from '../../../core/types'
import { RESOLVE_LIMIT, getProject, isUuid, listProjects, type ProjectDetail, type ProjectNode } from '../client'
import { getLinearConfig, optionalString, withWarnings } from './shared'

/** Project.state values in Linear's API. */
const PROJECT_STATES = ['backlog', 'planned', 'started', 'paused', 'completed', 'canceled'] as const

function shapeProjectRow(p: ProjectNode) {
  return {
    id: p.id,
    name: p.name,
    state: p.state,
    health: p.health ?? null,
    progress: p.progress ?? null,
    startDate: p.startDate ?? null,
    targetDate: p.targetDate ?? null,
    lead: p.lead ? (p.lead.displayName ?? p.lead.name) : null,
  }
}

function shapeProjectDetail(p: ProjectDetail) {
  return {
    ...shapeProjectRow(p),
    description: p.description ?? null,
    url: p.url,
    teams: (p.teams?.nodes ?? []).map((t) => ({ key: t.key, name: t.name })),
    milestones: (p.projectMilestones?.nodes ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description ?? null,
      targetDate: m.targetDate ?? null,
    })),
  }
}

export const projectsList: CommandSpec = {
  path: ['projects', 'list'],
  effect: 'read',
  description: 'List projects with state, health, progress, target date, and lead.',
  args: [
    {
      name: 'state',
      kind: 'string',
      description: `Filter by project state (${PROJECT_STATES.join(', ')})`,
      enum: PROJECT_STATES,
    },
  ],
  examples: ['home linear projects list --json', 'home linear projects list --state started --json'],
  async run(ctx) {
    const state = optionalString(ctx, 'state')?.toLowerCase()
    if (state && !(PROJECT_STATES as readonly string[]).includes(state)) {
      return {
        ok: false,
        kind: 'user',
        message: `unknown project state "${state}" — one of: ${PROJECT_STATES.join(', ')}`,
        code: 'bad_arg',
      }
    }
    const cfg = getLinearConfig(ctx)
    // ProjectFilter's state support is not relied on — the catalog is small,
    // so fetch bounded and filter here.
    const page = await listProjects(cfg, RESOLVE_LIMIT)
    const projects = page.nodes.filter((p) => !state || p.state === state).map(shapeProjectRow)
    return { ok: true, data: withWarnings({ projects }, page.warnings) }
  },
}

export const projectsGet: CommandSpec = {
  path: ['projects', 'get'],
  effect: 'read',
  description: 'Get one project in full, including milestones, by id or exact name.',
  args: [{ name: 'project', kind: 'positional', description: 'Project UUID or exact name (case-insensitive)', required: true }],
  examples: ['home linear projects get "Hermes swarm" --json'],
  async run(ctx) {
    const raw = String(ctx.args.project ?? '').trim()
    if (!raw) return { ok: false, kind: 'user', message: 'project is required', code: 'missing_arg' }

    const cfg = getLinearConfig(ctx)
    const warnings: string[] = []
    let id = raw
    if (!isUuid(raw)) {
      const page = await listProjects(cfg, RESOLVE_LIMIT)
      warnings.push(...page.warnings)
      const matches = page.nodes.filter((p) => p.name.toLowerCase() === raw.toLowerCase())
      if (matches.length === 0) throw new UserError(`project "${raw}" not found`, 'linear_not_found')
      if (matches.length > 1) {
        const candidates = matches.map((p) => `${p.name} (${p.id})`).join(', ')
        throw new UserError(`project "${raw}" is ambiguous — candidates: ${candidates}`, 'linear_ambiguous')
      }
      id = matches[0]!.id
    }
    const { data, warnings: getWarnings } = await getProject(cfg, id)
    return { ok: true, data: withWarnings({ project: shapeProjectDetail(data) }, [...warnings, ...getWarnings]) }
  },
}
