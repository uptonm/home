import { UserError } from '../../../core/errors'
import type { ArgSpec, CommandSpec } from '../../../core/types'
import {
  PRIORITY_NAMES,
  PROJECT_STATES,
  RESOLVE_LIMIT,
  createComment,
  createIssue,
  getIssueTeam,
  getViewer,
  isUuid,
  listProjects,
  listTeams,
  listTeamStates,
  listUsers,
  parseIssueRef,
  parsePriority,
  resolveProject,
  resolveState,
  resolveTeam,
  resolveUser,
  updateIssue,
  updateProject,
  type IssueCreateInput,
  type IssueUpdateInput,
  type LinearConfig,
  type ProjectUpdateInputFields,
} from '../client'
import { getLinearConfig, optionalString, readStdinText, requireYes, withWarnings } from './shared'

/**
 * Guarded write layer. Every command here mutates Linear, requires `--yes`
 * (stable `confirmation_required` refusal otherwise, sent before any request),
 * resolves its target exactly (ambiguity refused, like the read spine), and
 * echoes the target plus what changed. There are no delete/archive commands.
 */

const YES_ARG: ArgSpec = { name: 'yes', kind: 'boolean', description: 'Confirm the write — required for every mutation' }

const ASSIGNEE_ARG: ArgSpec = {
  name: 'assignee',
  kind: 'string',
  description: 'Assignee — "me", user id, email, or exact name (ambiguity refused)',
}

const PRIORITY_ARG: ArgSpec = {
  name: 'priority',
  kind: 'string',
  description: `Priority name (${PRIORITY_NAMES.join(', ')})`,
  enum: PRIORITY_NAMES,
}

const badIssueRef = (raw: string) =>
  ({
    ok: false,
    kind: 'user',
    message: `"${raw}" is not an issue identifier (UPT-123) or UUID`,
    code: 'bad_arg',
  }) as const

async function resolveProjectId(cfg: LinearConfig, ref: string, warnings: string[]): Promise<string> {
  if (isUuid(ref)) return ref.toLowerCase()
  const page = await listProjects(cfg, RESOLVE_LIMIT)
  warnings.push(...page.warnings)
  return resolveProject(page.nodes, ref).id
}

async function resolveAssigneeId(cfg: LinearConfig, ref: string, warnings: string[]): Promise<string> {
  if (ref.toLowerCase() === 'me') {
    const viewer = await getViewer(cfg)
    warnings.push(...viewer.warnings)
    return viewer.data.id
  }
  const page = await listUsers(cfg)
  warnings.push(...page.warnings)
  return resolveUser(page.nodes, ref).id
}

async function resolveStateIdInTeam(
  cfg: LinearConfig,
  teamId: string,
  ref: string,
  warnings: string[],
): Promise<string> {
  if (isUuid(ref)) return ref.toLowerCase()
  const page = await listTeamStates(cfg, teamId)
  warnings.push(...page.warnings)
  return resolveState(page.nodes, ref).id
}

export const issuesCreate: CommandSpec = {
  path: ['issues', 'create'],
  effect: 'write',
  description:
    'Create an issue in an exactly-resolved team (write — requires --yes). Description text arrives via stdin.',
  args: [
    { name: 'title', kind: 'string', description: 'Issue title', required: true },
    {
      name: 'team',
      kind: 'string',
      description: 'Team key (UPT), name, or id — resolved exactly, ambiguity refused; no defaultTeam fallback',
      required: true,
    },
    { name: 'description-stdin', kind: 'boolean', description: 'Read the issue description (markdown) from stdin' },
    { name: 'project', kind: 'string', description: 'Project id or exact name (ambiguity refused)' },
    ASSIGNEE_ARG,
    PRIORITY_ARG,
    { name: 'state', kind: 'string', description: 'Workflow state name or id in the target team' },
    YES_ARG,
  ],
  examples: [
    'home linear issues create --title "Fix atlas sync" --team UPT --priority high --yes --json',
    'cat body.md | home linear issues create --title "Boris recovery" --team UPT --description-stdin --assignee me --yes --json',
  ],
  async run(ctx) {
    const title = optionalString(ctx, 'title')
    if (!title) return { ok: false, kind: 'user', message: 'title is required', code: 'missing_arg' }
    const teamRef = optionalString(ctx, 'team')
    if (!teamRef) {
      return {
        ok: false,
        kind: 'user',
        message: 'team is required — creates never fall back to the configured defaultTeam',
        code: 'missing_arg',
      }
    }
    const priorityName = optionalString(ctx, 'priority')
    const priority = priorityName === undefined ? undefined : parsePriority(priorityName)

    const denied = requireYes(ctx, `create issue "${title}" in team "${teamRef}"`)
    if (denied) return denied

    const cfg = getLinearConfig(ctx)
    const warnings: string[] = []
    const description = ctx.args['description-stdin'] ? await readStdinText('--description-stdin') : undefined

    const teams = await listTeams(cfg)
    warnings.push(...teams.warnings)
    const team = resolveTeam(teams.nodes, teamRef)

    const input: IssueCreateInput = { title, teamId: team.id }
    if (description !== undefined) input.description = description
    const projectRef = optionalString(ctx, 'project')
    if (projectRef) input.projectId = await resolveProjectId(cfg, projectRef, warnings)
    const assigneeRef = optionalString(ctx, 'assignee')
    if (assigneeRef) input.assigneeId = await resolveAssigneeId(cfg, assigneeRef, warnings)
    if (priority !== undefined) input.priority = priority
    const stateRef = optionalString(ctx, 'state')
    if (stateRef) input.stateId = await resolveStateIdInTeam(cfg, team.id, stateRef, warnings)

    const { data, warnings: mutationWarnings } = await createIssue(cfg, input)
    warnings.push(...mutationWarnings)
    return {
      ok: true,
      data: withWarnings(
        {
          issue: { id: data.id, identifier: data.identifier, title: data.title, url: data.url },
          team: { key: team.key, name: team.name },
        },
        warnings,
      ),
    }
  },
}

export const issuesUpdate: CommandSpec = {
  path: ['issues', 'update'],
  effect: 'write',
  description:
    'Update an issue by identifier or UUID (write — requires --yes). Only the fields passed are sent; new description text arrives via stdin.',
  args: [
    { name: 'issue', kind: 'positional', description: 'Issue identifier (UPT-123) or UUID', required: true },
    { name: 'title', kind: 'string', description: 'New title' },
    { name: 'description-stdin', kind: 'boolean', description: 'Read the new description (markdown) from stdin' },
    ASSIGNEE_ARG,
    PRIORITY_ARG,
    { name: 'state', kind: 'string', description: "Workflow state name or id in the issue's team" },
    YES_ARG,
  ],
  examples: [
    'home linear issues update UPT-123 --state Done --yes --json',
    'home linear issues update UPT-123 --assignee me --priority urgent --yes --json',
  ],
  async run(ctx) {
    const raw = String(ctx.args.issue ?? '').trim()
    const ref = raw ? parseIssueRef(raw) : null
    if (!ref) return badIssueRef(raw)

    const title = optionalString(ctx, 'title')
    const assigneeRef = optionalString(ctx, 'assignee')
    const priorityName = optionalString(ctx, 'priority')
    const stateRef = optionalString(ctx, 'state')
    const wantsDescription = Boolean(ctx.args['description-stdin'])
    if (!title && !assigneeRef && !priorityName && !stateRef && !wantsDescription) {
      return {
        ok: false,
        kind: 'user',
        message: 'nothing to update — pass at least one of --title, --description-stdin, --assignee, --priority, --state',
        code: 'missing_arg',
      }
    }
    const priority = priorityName === undefined ? undefined : parsePriority(priorityName)

    const denied = requireYes(ctx, `update issue ${ref.id}`)
    if (denied) return denied

    const cfg = getLinearConfig(ctx)
    const warnings: string[] = []
    const input: IssueUpdateInput = {}
    if (title) input.title = title
    if (wantsDescription) input.description = await readStdinText('--description-stdin')
    if (assigneeRef) input.assigneeId = await resolveAssigneeId(cfg, assigneeRef, warnings)
    if (priority !== undefined) input.priority = priority
    if (stateRef) {
      if (isUuid(stateRef)) {
        input.stateId = stateRef.toLowerCase()
      } else {
        // State names only resolve within a team, so look the issue's team up first.
        const issue = await getIssueTeam(cfg, ref)
        warnings.push(...issue.warnings)
        if (!issue.data.team) {
          throw new UserError(`issue ${issue.data.identifier} has no team — pass a state id instead of a name`, 'linear_not_found')
        }
        input.stateId = await resolveStateIdInTeam(cfg, issue.data.team.id, stateRef, warnings)
      }
    }

    const { data, warnings: mutationWarnings } = await updateIssue(cfg, ref.id, input)
    warnings.push(...mutationWarnings)
    return {
      ok: true,
      data: withWarnings(
        {
          issue: { id: data.id, identifier: data.identifier, url: data.url },
          changed: input,
        },
        warnings,
      ),
    }
  },
}

export const issuesComment: CommandSpec = {
  path: ['issues', 'comment'],
  effect: 'write',
  description: 'Comment on an issue (write — requires --yes). The body arrives via stdin, never argv.',
  args: [
    { name: 'issue', kind: 'positional', description: 'Issue identifier (UPT-123) or UUID', required: true },
    { name: 'body-stdin', kind: 'boolean', description: 'Read the comment body (markdown) from stdin — required' },
    YES_ARG,
  ],
  examples: ['echo "Deployed the fix." | home linear issues comment UPT-123 --body-stdin --yes --json'],
  async run(ctx) {
    const raw = String(ctx.args.issue ?? '').trim()
    const ref = raw ? parseIssueRef(raw) : null
    if (!ref) return badIssueRef(raw)
    if (!ctx.args['body-stdin']) {
      return {
        ok: false,
        kind: 'user',
        message: 'the comment body arrives via stdin — pipe it in and pass --body-stdin',
        code: 'missing_arg',
      }
    }

    const denied = requireYes(ctx, `comment on issue ${ref.id}`)
    if (denied) return denied

    const cfg = getLinearConfig(ctx)
    const body = await readStdinText('--body-stdin')
    const { data, warnings } = await createComment(cfg, { issueId: ref.id, body })
    return {
      ok: true,
      data: withWarnings(
        {
          comment: { id: data.id, url: data.url },
          issue: { identifier: data.issue.identifier },
        },
        warnings,
      ),
    }
  },
}

const TARGET_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const projectsUpdate: CommandSpec = {
  path: ['projects', 'update'],
  effect: 'write',
  description:
    'Update a project resolved exactly by id or name (write — requires --yes). Only the fields passed are sent; new description text arrives via stdin.',
  args: [
    { name: 'project', kind: 'positional', description: 'Project UUID or exact name (ambiguity refused)', required: true },
    { name: 'name', kind: 'string', description: 'New project name' },
    { name: 'description-stdin', kind: 'boolean', description: 'Read the new description (markdown) from stdin' },
    { name: 'state', kind: 'string', description: `New state (${PROJECT_STATES.join(', ')})`, enum: PROJECT_STATES },
    { name: 'target-date', kind: 'string', description: 'New target date (YYYY-MM-DD)' },
    YES_ARG,
  ],
  examples: [
    'home linear projects update "Hermes swarm" --state paused --yes --json',
    'home linear projects update "Boris recovery" --target-date 2026-09-01 --yes --json',
  ],
  async run(ctx) {
    const raw = String(ctx.args.project ?? '').trim()
    if (!raw) return { ok: false, kind: 'user', message: 'project is required', code: 'missing_arg' }

    const name = optionalString(ctx, 'name')
    const state = optionalString(ctx, 'state')?.toLowerCase()
    const targetDate = optionalString(ctx, 'target-date')
    const wantsDescription = Boolean(ctx.args['description-stdin'])
    if (!name && !state && !targetDate && !wantsDescription) {
      return {
        ok: false,
        kind: 'user',
        message: 'nothing to update — pass at least one of --name, --description-stdin, --state, --target-date',
        code: 'missing_arg',
      }
    }
    if (state && !(PROJECT_STATES as readonly string[]).includes(state)) {
      return {
        ok: false,
        kind: 'user',
        message: `unknown project state "${state}" — one of: ${PROJECT_STATES.join(', ')}`,
        code: 'bad_arg',
      }
    }
    if (targetDate && !TARGET_DATE_RE.test(targetDate)) {
      return { ok: false, kind: 'user', message: `target-date "${targetDate}" must be YYYY-MM-DD`, code: 'bad_arg' }
    }

    const denied = requireYes(ctx, `update project "${raw}"`)
    if (denied) return denied

    const cfg = getLinearConfig(ctx)
    const warnings: string[] = []
    const id = await resolveProjectId(cfg, raw, warnings)

    const input: ProjectUpdateInputFields = {}
    if (name) input.name = name
    if (wantsDescription) input.description = await readStdinText('--description-stdin')
    if (state) input.state = state
    if (targetDate) input.targetDate = targetDate

    const { data, warnings: mutationWarnings } = await updateProject(cfg, id, input)
    warnings.push(...mutationWarnings)
    return {
      ok: true,
      data: withWarnings(
        {
          project: { id: data.id, name: data.name, url: data.url },
          changed: input,
        },
        warnings,
      ),
    }
  },
}
