import { UserError } from '../../../core/errors'
import type { RunContext, RunResult } from '../../../core/types'
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  isUuid,
  listTeams,
  listTeamStates,
  listUsers,
  readLinearConfig,
  resolveState,
  resolveTeam,
  resolveUser,
  type IssueFilterInput,
  type LinearConfig,
  type TeamRow,
} from '../client'

export interface ParseResult<T> {
  value?: T
  error?: string
  warning?: string
}

/** Parse `--limit <n>` into a bounded result count, defaulting when absent. */
export function parseLimit(ctx: RunContext): ParseResult<number> {
  if (ctx.args.limit === undefined) return { value: DEFAULT_LIMIT }
  const n = Number(ctx.args.limit)
  if (!Number.isFinite(n) || n < 1) return { error: 'limit must be a positive number' }
  const clamped = Math.min(Math.floor(n), MAX_LIMIT)
  if (clamped < n) return { value: clamped, warning: `limit capped at ${MAX_LIMIT}` }
  return { value: clamped }
}

/** Optional string arg, trimmed; undefined when absent or empty. */
export function optionalString(ctx: RunContext, name: string): string | undefined {
  if (ctx.args[name] === undefined) return undefined
  const s = String(ctx.args[name]).trim()
  return s.length > 0 ? s : undefined
}

export function getLinearConfig(ctx: RunContext): LinearConfig {
  return readLinearConfig(ctx.config)
}

export interface TeamScope {
  team?: TeamRow
  warnings: string[]
}

/**
 * Resolve `--team`, falling back to the configured defaultTeam. `--team` with
 * no value can't unset the default (citty has no tri-state), which is fine for
 * a read spine — pass an explicit team to override.
 */
export async function resolveTeamScope(ctx: RunContext, cfg: LinearConfig): Promise<TeamScope> {
  const ref = optionalString(ctx, 'team') ?? cfg.defaultTeam
  if (!ref) return { warnings: [] }
  const teams = await listTeams(cfg)
  return { team: resolveTeam(teams.nodes, ref), warnings: teams.warnings }
}

/**
 * Turn `--state`/`--assignee` args plus a team scope into IssueFilter inputs.
 * With a team in scope, states resolve against that team's workflow states
 * (exact id, then case-insensitive name, ambiguity refused); without one, a
 * UUID filters by state id and anything else by case-insensitive name.
 * `--assignee me` filters on the viewer without a user lookup.
 */
export async function buildFilterInput(
  ctx: RunContext,
  cfg: LinearConfig,
  scope: TeamScope,
): Promise<{ input: IssueFilterInput; warnings: string[] }> {
  const warnings: string[] = []
  const input: IssueFilterInput = {}
  if (scope.team) input.teamId = scope.team.id

  const stateRef = optionalString(ctx, 'state')
  if (stateRef) {
    if (scope.team) {
      const states = await listTeamStates(cfg, scope.team.id)
      warnings.push(...states.warnings)
      input.stateId = resolveState(states.nodes, stateRef).id
    } else if (isUuid(stateRef)) {
      input.stateId = stateRef.toLowerCase()
    } else {
      input.stateName = stateRef
    }
  }

  const assigneeRef = optionalString(ctx, 'assignee')
  if (assigneeRef) {
    if (assigneeRef.toLowerCase() === 'me') {
      input.assigneeIsMe = true
    } else {
      const users = await listUsers(cfg)
      warnings.push(...users.warnings)
      input.assigneeId = resolveUser(users.nodes, assigneeRef).id
    }
  }

  const project = optionalString(ctx, 'project')
  if (project) input.project = project

  return { input, warnings }
}

/**
 * House confirmation guard for mutations: without `--yes` the command returns
 * the stable `confirmation_required` code before anything is sent — never an
 * interactive prompt.
 */
export function requireYes(ctx: RunContext, action: string): RunResult | null {
  if (ctx.args.yes) return null
  return {
    ok: false,
    kind: 'user',
    message: `refusing to ${action} without confirmation — re-run with --yes`,
    code: 'confirmation_required',
  }
}

/**
 * Body/description text enters via stdin, never argv — no shell-history leaks,
 * no quoting fights. `Bun.stdin` can't be fed from a unit test, so the source
 * is swappable.
 */
let stdinSource: () => Promise<string> = async () => {
  if (process.stdin.isTTY) {
    throw new UserError('stdin is a TTY — pipe the text in (e.g. `echo "body" | home linear …`)', 'missing_arg')
  }
  return Bun.stdin.text()
}

export function setStdinSource(read: () => Promise<string>): void {
  stdinSource = read
}

export async function readStdinText(flag: string): Promise<string> {
  const text = (await stdinSource()).trim()
  if (!text) throw new UserError(`${flag} was set but stdin was empty`, 'missing_arg')
  return text
}

/** Attach accumulated partial-result warnings to a data payload (omitted when none). */
export function withWarnings<T extends Record<string, unknown>>(data: T, warnings: string[]): T {
  if (warnings.length === 0) return data
  return { ...data, warnings }
}
