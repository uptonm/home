import { request } from '../../core/http'
import { HomeError, SystemError, UserError } from '../../core/errors'
import type { ModuleConfig, RunResult } from '../../core/types'

/**
 * Linear GraphQL client. One transport (`gql`) posts named query and mutation
 * documents with variables — user input never reaches a document string, only
 * the `variables` object. Resolvers, filter builders, and shapers are pure and
 * exported so they can be unit-tested against fixtures without a network.
 * Mutations are guarded at the command layer (`--yes`); there are no delete or
 * archive operations.
 */

export const LINEAR_API_URL = 'https://api.linear.app/graphql'

export const DEFAULT_LIMIT = 30
export const MAX_LIMIT = 100
/** Linear caps `first` at 250; 50 keeps responses small while limits stay low. */
const PAGE_SIZE = 50
/** Hard cap on cursor follows so a misbehaving API can't spin forever. */
const MAX_PAGES = 10
/** Bound for full-catalog fetches used by resolvers (teams, users, projects). */
export const RESOLVE_LIMIT = 250

export interface LinearConfig {
  apiKey: string
  defaultTeam?: string
}

export function readLinearConfig(cfg: ModuleConfig): LinearConfig {
  const apiKey = String(cfg.apiKey ?? '').trim()
  const defaultTeam = String(cfg.defaultTeam ?? '').trim()
  return defaultTeam ? { apiKey, defaultTeam } : { apiKey }
}

/** Strip the API key from text that may echo request context (bodies, errors). */
export function redactKey(text: string, apiKey: string): string {
  if (!apiKey) return text
  return text.split(apiKey).join('[redacted]')
}

// --- GraphQL documents (constants only — never interpolate user input) ----

const ISSUE_ROW_FIELDS = `
      id
      identifier
      title
      priority
      priorityLabel
      updatedAt
      state { id name type }
      assignee { id name displayName }
      project { id name }`

export const VIEWER_STATUS_QUERY = `query ViewerStatus {
  viewer { id name email }
  organization { id name urlKey }
}`

export const TEAMS_QUERY = `query Teams($first: Int!, $after: String) {
  teams(first: $first, after: $after) {
    nodes { id key name }
    pageInfo { hasNextPage endCursor }
  }
}`

export const USERS_QUERY = `query Users($first: Int!, $after: String) {
  users(first: $first, after: $after) {
    nodes { id name displayName email active }
    pageInfo { hasNextPage endCursor }
  }
}`

export const WORKFLOW_STATES_QUERY = `query WorkflowStates($filter: WorkflowStateFilter, $first: Int!, $after: String) {
  workflowStates(filter: $filter, first: $first, after: $after) {
    nodes { id name type team { id key } }
    pageInfo { hasNextPage endCursor }
  }
}`

export const ISSUES_QUERY = `query Issues($filter: IssueFilter, $first: Int!, $after: String) {
  issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
    nodes {${ISSUE_ROW_FIELDS}
    }
    pageInfo { hasNextPage endCursor }
  }
}`

export const ISSUE_QUERY = `query Issue($id: String!) {
  issue(id: $id) {${ISSUE_ROW_FIELDS}
    description
    url
    estimate
    createdAt
    team { id key name }
    cycle { id number name }
    parent { id identifier title }
    labels(first: 50) { nodes { id name } }
    relations(first: 50) { nodes { id type relatedIssue { id identifier title } } }
    inverseRelations(first: 50) { nodes { id type issue { id identifier title } } }
    comments(first: 50) { nodes { id } pageInfo { hasNextPage } }
  }
}`

export const SEARCH_ISSUES_QUERY = `query SearchIssues($term: String!, $filter: IssueFilter, $first: Int!, $after: String) {
  searchIssues(term: $term, filter: $filter, first: $first, after: $after) {
    nodes {${ISSUE_ROW_FIELDS}
    }
    pageInfo { hasNextPage endCursor }
  }
}`

export const PROJECTS_QUERY = `query Projects($first: Int!, $after: String) {
  projects(first: $first, after: $after) {
    nodes {
      id name state health progress startDate targetDate
      lead { id name displayName }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

export const PROJECT_QUERY = `query Project($id: String!) {
  project(id: $id) {
    id name description state health progress startDate targetDate url
    lead { id name displayName }
    teams(first: 10) { nodes { id key name } }
    projectMilestones(first: 50) { nodes { id name description targetDate } }
  }
}`

export const CYCLES_QUERY = `query Cycles($filter: CycleFilter, $first: Int!, $after: String) {
  cycles(filter: $filter, first: $first, after: $after) {
    nodes { id number name startsAt endsAt progress team { id key name } }
    pageInfo { hasNextPage endCursor }
  }
}`

export const MY_ISSUES_QUERY = `query MyIssues($filter: IssueFilter, $first: Int!, $after: String) {
  viewer {
    assignedIssues(filter: $filter, first: $first, after: $after) {
      nodes {${ISSUE_ROW_FIELDS}
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

export const MY_OPEN_ISSUES_QUERY = `query MyOpenIssues($filter: IssueFilter, $first: Int!, $after: String) {
  viewer {
    assignedIssues(filter: $filter, first: $first, after: $after) {
      nodes {${ISSUE_ROW_FIELDS}
        inverseRelations(first: 25) { nodes { type issue { identifier title state { name type } } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

export const TEAM_ACTIVE_CYCLE_QUERY = `query TeamActiveCycle($id: String!) {
  team(id: $id) {
    id key name
    activeCycle { id number name startsAt endsAt progress }
  }
}`

export const ISSUE_TEAM_QUERY = `query IssueTeam($id: String!) {
  issue(id: $id) {
    id identifier
    team { id key name }
  }
}`

// --- GraphQL mutation documents (constants only, variables carry all input) --

export const CREATE_ISSUE_MUTATION = `mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier title url }
  }
}`

export const UPDATE_ISSUE_MUTATION = `mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { id identifier title url }
  }
}`

export const CREATE_COMMENT_MUTATION = `mutation CreateComment($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
    comment { id url issue { id identifier } }
  }
}`

export const UPDATE_PROJECT_MUTATION = `mutation UpdateProject($id: String!, $input: ProjectUpdateInput!) {
  projectUpdate(id: $id, input: $input) {
    success
    project { id name url }
  }
}`

// --- Transport -------------------------------------------------------------

interface GqlError {
  message?: string
  extensions?: { code?: string; type?: string }
}

export interface GqlResponse<T> {
  data: T
  /** GraphQL errors that arrived alongside usable data (partial results). */
  warnings: string[]
}

function isAuthError(e: GqlError): boolean {
  return e.extensions?.code === 'AUTHENTICATION_ERROR' || e.extensions?.type === 'authentication error'
}

/**
 * POST one GraphQL document. Personal API keys go in `Authorization` verbatim
 * — Linear rejects a `Bearer` prefix on them (Bearer is for OAuth tokens).
 * Error mapping is the module's stable taxonomy: `linear_auth` for a rejected
 * key, `linear_rate_limited` for 429, `linear_api_failed` for everything else.
 * Every message that could echo request context passes through `redactKey`.
 */
export async function gql<T>(
  cfg: LinearConfig,
  document: string,
  variables: Record<string, unknown> = {},
): Promise<GqlResponse<T>> {
  let res: Response
  try {
    res = await request(LINEAR_API_URL, {
      method: 'POST',
      headers: { Authorization: cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: document, variables }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new SystemError(redactKey(`Linear API unreachable: ${message}`, cfg.apiKey), 'linear_api_failed')
  }

  if (res.status === 401 || res.status === 403) {
    throw new UserError('Linear rejected the API key — run `home linear configure --rotate`', 'linear_auth')
  }
  if (res.status === 429) {
    throw new SystemError('Linear rate limit hit (HTTP 429) — wait before retrying', 'linear_rate_limited')
  }

  let body: { data?: T | null; errors?: GqlError[] }
  try {
    body = (await res.json()) as { data?: T | null; errors?: GqlError[] }
  } catch {
    throw new SystemError(`Linear API returned an unparseable response (HTTP ${res.status})`, 'linear_api_failed')
  }

  const errors = body.errors ?? []
  if (body.data !== null && body.data !== undefined) {
    return {
      data: body.data,
      warnings: errors.map((e) => redactKey(e.message ?? 'unknown GraphQL error', cfg.apiKey)),
    }
  }
  if (errors.length > 0) {
    const message = redactKey(errors.map((e) => e.message ?? 'unknown GraphQL error').join('; '), cfg.apiKey)
    if (errors.some(isAuthError)) throw new UserError(message, 'linear_auth')
    throw new SystemError(message, 'linear_api_failed')
  }
  throw new SystemError(`Linear API returned no data (HTTP ${res.status})`, 'linear_api_failed')
}

// --- Pagination ------------------------------------------------------------

export interface PageInfo {
  hasNextPage: boolean
  endCursor?: string | null
}

export interface Connection<T> {
  nodes: T[]
  pageInfo: PageInfo
}

export interface Paged<T> {
  nodes: T[]
  warnings: string[]
}

/**
 * Follow `pageInfo.endCursor` until `limit` nodes are collected, the server
 * runs out, or the MAX_PAGES guard trips. Partial-result warnings from every
 * page are accumulated.
 */
export async function paginate<T>(
  fetchPage: (first: number, after: string | undefined) => Promise<GqlResponse<Connection<T>>>,
  limit: number,
): Promise<Paged<T>> {
  const nodes: T[] = []
  const warnings: string[] = []
  let after: string | undefined
  for (let page = 0; page < MAX_PAGES && nodes.length < limit; page++) {
    const first = Math.min(PAGE_SIZE, limit - nodes.length)
    const res = await fetchPage(first, after)
    warnings.push(...res.warnings)
    nodes.push(...res.data.nodes)
    const info = res.data.pageInfo
    if (!info.hasNextPage || !info.endCursor) break
    after = info.endCursor
  }
  return { nodes: nodes.slice(0, limit), warnings }
}

// --- Identifier parsing ----------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IDENTIFIER_RE = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/

export type IssueRef = { kind: 'uuid'; id: string } | { kind: 'identifier'; id: string }

/** Accepts a UUID or a `UPT-123`-style identifier (team key normalized to upper case). */
export function parseIssueRef(raw: string): IssueRef | null {
  const s = raw.trim()
  if (UUID_RE.test(s)) return { kind: 'uuid', id: s.toLowerCase() }
  const m = IDENTIFIER_RE.exec(s)
  if (m) return { kind: 'identifier', id: `${m[1]!.toUpperCase()}-${m[2]!}` }
  return null
}

export function isUuid(raw: string): boolean {
  return UUID_RE.test(raw.trim())
}

// --- Filter builders (variables only) ---------------------------------------

export interface IssueFilterInput {
  teamId?: string
  stateId?: string
  stateName?: string
  /** Restrict to workflow-state types, e.g. exclude completed/canceled. */
  stateTypes?: { in?: string[]; nin?: string[] }
  assigneeId?: string
  assigneeIsMe?: boolean
  /** UUID → filter by project id; anything else → case-insensitive name. */
  project?: string
}

export function buildIssueFilter(input: IssueFilterInput): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {}
  if (input.teamId) filter.team = { id: { eq: input.teamId } }
  const state: Record<string, unknown> = {}
  if (input.stateId) state.id = { eq: input.stateId }
  else if (input.stateName) state.name = { eqIgnoreCase: input.stateName }
  if (input.stateTypes) state.type = input.stateTypes
  if (Object.keys(state).length > 0) filter.state = state
  if (input.assigneeIsMe) filter.assignee = { isMe: { eq: true } }
  else if (input.assigneeId) filter.assignee = { id: { eq: input.assigneeId } }
  if (input.project) {
    filter.project = isUuid(input.project)
      ? { id: { eq: input.project.toLowerCase() } }
      : { name: { eqIgnoreCase: input.project } }
  }
  return Object.keys(filter).length > 0 ? filter : undefined
}

// --- Resolvers (exact key/id first, then case-insensitive name) -------------

export interface TeamRow {
  id: string
  key: string
  name: string
}

export function resolveTeam(teams: TeamRow[], ref: string): TeamRow {
  const wanted = ref.trim()
  const byId = teams.find((t) => t.id === wanted)
  if (byId) return byId
  const byKey = teams.find((t) => t.key.toUpperCase() === wanted.toUpperCase())
  if (byKey) return byKey
  const byName = teams.filter((t) => t.name.toLowerCase() === wanted.toLowerCase())
  if (byName.length === 1) return byName[0]!
  if (byName.length > 1) {
    const candidates = byName.map((t) => `${t.key} (${t.name})`).join(', ')
    throw new UserError(`team "${ref}" is ambiguous — candidates: ${candidates}`, 'linear_ambiguous')
  }
  const available = teams.map((t) => t.key).join(', ')
  throw new UserError(`team "${ref}" not found — teams: ${available || 'none'}`, 'linear_not_found')
}

export interface UserRow {
  id: string
  name: string
  displayName?: string | null
  email?: string | null
  active?: boolean
}

export function resolveUser(users: UserRow[], ref: string): UserRow {
  const wanted = ref.trim()
  const byId = users.find((u) => u.id === wanted)
  if (byId) return byId
  const lower = wanted.toLowerCase()
  const byEmail = users.find((u) => (u.email ?? '').toLowerCase() === lower)
  if (byEmail) return byEmail
  const byName = users.filter(
    (u) => u.name.toLowerCase() === lower || (u.displayName ?? '').toLowerCase() === lower,
  )
  if (byName.length === 1) return byName[0]!
  if (byName.length > 1) {
    const candidates = byName.map((u) => `${u.name}${u.email ? ` <${u.email}>` : ''}`).join(', ')
    throw new UserError(`user "${ref}" is ambiguous — candidates: ${candidates}`, 'linear_ambiguous')
  }
  throw new UserError(`user "${ref}" not found`, 'linear_not_found')
}

export interface WorkflowStateRow {
  id: string
  name: string
  type: string
  team?: { id: string; key: string } | null
}

export function resolveState(states: WorkflowStateRow[], ref: string): WorkflowStateRow {
  const wanted = ref.trim()
  const byId = states.find((s) => s.id === wanted)
  if (byId) return byId
  const byName = states.filter((s) => s.name.toLowerCase() === wanted.toLowerCase())
  if (byName.length === 1) return byName[0]!
  if (byName.length > 1) {
    const candidates = byName.map((s) => `${s.name} (${s.team?.key ?? '?'}, ${s.type})`).join(', ')
    throw new UserError(`state "${ref}" is ambiguous — candidates: ${candidates}`, 'linear_ambiguous')
  }
  const available = states.map((s) => s.name).join(', ')
  throw new UserError(`state "${ref}" not found — states: ${available || 'none'}`, 'linear_not_found')
}

export function resolveProject(projects: ProjectNode[], ref: string): ProjectNode {
  const wanted = ref.trim()
  const byId = projects.find((p) => p.id === wanted.toLowerCase())
  if (byId) return byId
  const byName = projects.filter((p) => p.name.toLowerCase() === wanted.toLowerCase())
  if (byName.length === 1) return byName[0]!
  if (byName.length > 1) {
    const candidates = byName.map((p) => `${p.name} (${p.id})`).join(', ')
    throw new UserError(`project "${ref}" is ambiguous — candidates: ${candidates}`, 'linear_ambiguous')
  }
  throw new UserError(`project "${ref}" not found`, 'linear_not_found')
}

/** Index position is the Linear priority int: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export const PRIORITY_NAMES = ['none', 'urgent', 'high', 'medium', 'low'] as const

export function parsePriority(raw: string): number {
  const idx = (PRIORITY_NAMES as readonly string[]).indexOf(raw.trim().toLowerCase())
  if (idx === -1) {
    throw new UserError(`unknown priority "${raw}" — one of: ${PRIORITY_NAMES.join(', ')}`, 'bad_arg')
  }
  return idx
}

// --- Row shapes ------------------------------------------------------------

export interface IssueNode {
  id: string
  identifier: string
  title: string
  priority: number
  priorityLabel?: string | null
  updatedAt: string
  state?: { id: string; name: string; type: string } | null
  assignee?: { id: string; name: string; displayName?: string | null } | null
  project?: { id: string; name: string } | null
}

export interface IssueRow {
  id: string
  identifier: string
  title: string
  state: { name: string; type: string } | null
  assignee: string | null
  priority: number
  priorityLabel: string | null
  project: string | null
  updatedAt: string
}

export function toIssueRow(node: IssueNode): IssueRow {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    state: node.state ? { name: node.state.name, type: node.state.type } : null,
    assignee: node.assignee ? (node.assignee.displayName ?? node.assignee.name) : null,
    priority: node.priority,
    priorityLabel: node.priorityLabel ?? null,
    project: node.project?.name ?? null,
    updatedAt: node.updatedAt,
  }
}

/**
 * Actionable ordering for `my-work`: in-flight work first, then untriaged
 * items needing a decision, then the queued backlog; done/killed last.
 */
const STATE_TYPE_RANK: Record<string, number> = {
  started: 0,
  triage: 1,
  unstarted: 2,
  backlog: 3,
  completed: 4,
  canceled: 5,
}

/** Linear priority: 0 = none, 1 = urgent … 4 = low — "none" sorts after "low". */
export function priorityRank(priority: number): number {
  return priority === 0 ? 5 : priority
}

export function orderMyWork(rows: IssueRow[]): IssueRow[] {
  return [...rows].sort((a, b) => {
    const stateDiff =
      (STATE_TYPE_RANK[a.state?.type ?? ''] ?? 9) - (STATE_TYPE_RANK[b.state?.type ?? ''] ?? 9)
    if (stateDiff !== 0) return stateDiff
    const prioDiff = priorityRank(a.priority) - priorityRank(b.priority)
    if (prioDiff !== 0) return prioDiff
    return a.identifier.localeCompare(b.identifier)
  })
}

// --- Summary shapes ---------------------------------------------------------

export interface RelationNode {
  type: string
  issue: { identifier: string; title: string; state?: { name: string; type: string } | null }
}

export interface MyOpenIssueNode extends IssueNode {
  inverseRelations?: { nodes: RelationNode[] } | null
}

export interface BlockedIssue {
  identifier: string
  title: string
  blockedBy: { identifier: string; title: string }[]
}

const CLOSED_STATE_TYPES = new Set(['completed', 'canceled'])

/**
 * An issue is blocked when another still-open issue has a `blocks` relation
 * pointing at it — that arrives on this side as an inverse relation.
 */
export function blockedBy(node: MyOpenIssueNode): { identifier: string; title: string }[] {
  return (node.inverseRelations?.nodes ?? [])
    .filter((r) => r.type === 'blocks' && !CLOSED_STATE_TYPES.has(r.issue.state?.type ?? ''))
    .map((r) => ({ identifier: r.issue.identifier, title: r.issue.title }))
}

export interface ProjectNode {
  id: string
  name: string
  state: string
  health?: string | null
  progress?: number | null
  startDate?: string | null
  targetDate?: string | null
  lead?: { id: string; name: string; displayName?: string | null } | null
}

/** Project.state values in Linear's API. */
export const PROJECT_STATES = ['backlog', 'planned', 'started', 'paused', 'completed', 'canceled'] as const

const AT_RISK_HEALTH = new Set(['atRisk', 'offTrack'])

export function isProjectAtRisk(p: ProjectNode): boolean {
  return !CLOSED_STATE_TYPES.has(p.state) && p.state !== 'canceled' && AT_RISK_HEALTH.has(p.health ?? '')
}

export interface CycleNode {
  id: string
  number: number
  name?: string | null
  startsAt: string
  endsAt: string
  progress?: number | null
  team?: { id: string; key: string; name: string } | null
}

export function isActiveCycle(c: CycleNode, now: Date): boolean {
  return Date.parse(c.startsAt) <= now.getTime() && now.getTime() < Date.parse(c.endsAt)
}

// --- API functions -----------------------------------------------------------

export function listTeams(cfg: LinearConfig): Promise<Paged<TeamRow>> {
  return paginate<TeamRow>(async (first, after) => {
    const res = await gql<{ teams: Connection<TeamRow> }>(cfg, TEAMS_QUERY, { first, after })
    return { data: res.data.teams, warnings: res.warnings }
  }, RESOLVE_LIMIT)
}

export function listUsers(cfg: LinearConfig): Promise<Paged<UserRow>> {
  return paginate<UserRow>(async (first, after) => {
    const res = await gql<{ users: Connection<UserRow> }>(cfg, USERS_QUERY, { first, after })
    return { data: res.data.users, warnings: res.warnings }
  }, RESOLVE_LIMIT)
}

export function listTeamStates(cfg: LinearConfig, teamId: string): Promise<Paged<WorkflowStateRow>> {
  const filter = { team: { id: { eq: teamId } } }
  return paginate<WorkflowStateRow>(async (first, after) => {
    const res = await gql<{ workflowStates: Connection<WorkflowStateRow> }>(cfg, WORKFLOW_STATES_QUERY, {
      filter,
      first,
      after,
    })
    return { data: res.data.workflowStates, warnings: res.warnings }
  }, RESOLVE_LIMIT)
}

export function listIssues(
  cfg: LinearConfig,
  filter: Record<string, unknown> | undefined,
  limit: number,
): Promise<Paged<IssueNode>> {
  return paginate<IssueNode>(async (first, after) => {
    const res = await gql<{ issues: Connection<IssueNode> }>(cfg, ISSUES_QUERY, { filter, first, after })
    return { data: res.data.issues, warnings: res.warnings }
  }, limit)
}

export interface IssueDetail extends IssueNode {
  description?: string | null
  url?: string
  estimate?: number | null
  createdAt?: string
  team?: { id: string; key: string; name: string } | null
  cycle?: { id: string; number: number; name?: string | null } | null
  parent?: { id: string; identifier: string; title: string } | null
  labels?: { nodes: { id: string; name: string }[] } | null
  relations?: { nodes: { id: string; type: string; relatedIssue: { id: string; identifier: string; title: string } }[] } | null
  inverseRelations?: { nodes: { id: string; type: string; issue: { id: string; identifier: string; title: string } }[] } | null
  comments?: { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean } } | null
}

export async function getIssue(cfg: LinearConfig, ref: IssueRef): Promise<GqlResponse<IssueDetail>> {
  const res = await gql<{ issue: IssueDetail | null }>(cfg, ISSUE_QUERY, { id: ref.id })
  if (!res.data.issue) throw new UserError(`issue "${ref.id}" not found`, 'linear_not_found')
  return { data: res.data.issue, warnings: res.warnings }
}

export function searchIssues(
  cfg: LinearConfig,
  term: string,
  filter: Record<string, unknown> | undefined,
  limit: number,
): Promise<Paged<IssueNode>> {
  return paginate<IssueNode>(async (first, after) => {
    const res = await gql<{ searchIssues: Connection<IssueNode> }>(cfg, SEARCH_ISSUES_QUERY, {
      term,
      filter,
      first,
      after,
    })
    return { data: res.data.searchIssues, warnings: res.warnings }
  }, limit)
}

export function listProjects(cfg: LinearConfig, limit: number): Promise<Paged<ProjectNode>> {
  return paginate<ProjectNode>(async (first, after) => {
    const res = await gql<{ projects: Connection<ProjectNode> }>(cfg, PROJECTS_QUERY, { first, after })
    return { data: res.data.projects, warnings: res.warnings }
  }, limit)
}

export interface ProjectDetail extends ProjectNode {
  description?: string | null
  url?: string
  teams?: { nodes: { id: string; key: string; name: string }[] } | null
  projectMilestones?: { nodes: { id: string; name: string; description?: string | null; targetDate?: string | null }[] } | null
}

export async function getProject(cfg: LinearConfig, id: string): Promise<GqlResponse<ProjectDetail>> {
  const res = await gql<{ project: ProjectDetail | null }>(cfg, PROJECT_QUERY, { id })
  if (!res.data.project) throw new UserError(`project "${id}" not found`, 'linear_not_found')
  return { data: res.data.project, warnings: res.warnings }
}

export function listCycles(
  cfg: LinearConfig,
  teamId: string | undefined,
  limit: number,
): Promise<Paged<CycleNode>> {
  const filter = teamId ? { team: { id: { eq: teamId } } } : undefined
  return paginate<CycleNode>(async (first, after) => {
    const res = await gql<{ cycles: Connection<CycleNode> }>(cfg, CYCLES_QUERY, { filter, first, after })
    return { data: res.data.cycles, warnings: res.warnings }
  }, limit)
}

export function listMyIssues(
  cfg: LinearConfig,
  filter: Record<string, unknown> | undefined,
  limit: number,
): Promise<Paged<IssueNode>> {
  return paginate<IssueNode>(async (first, after) => {
    const res = await gql<{ viewer: { assignedIssues: Connection<IssueNode> } }>(cfg, MY_ISSUES_QUERY, {
      filter,
      first,
      after,
    })
    return { data: res.data.viewer.assignedIssues, warnings: res.warnings }
  }, limit)
}

export function listMyOpenIssuesWithRelations(
  cfg: LinearConfig,
  filter: Record<string, unknown> | undefined,
  limit: number,
): Promise<Paged<MyOpenIssueNode>> {
  return paginate<MyOpenIssueNode>(async (first, after) => {
    const res = await gql<{ viewer: { assignedIssues: Connection<MyOpenIssueNode> } }>(cfg, MY_OPEN_ISSUES_QUERY, {
      filter,
      first,
      after,
    })
    return { data: res.data.viewer.assignedIssues, warnings: res.warnings }
  }, limit)
}

export interface TeamWithActiveCycle {
  id: string
  key: string
  name: string
  activeCycle?: CycleNode | null
}

export async function getTeamActiveCycle(cfg: LinearConfig, teamId: string): Promise<GqlResponse<TeamWithActiveCycle>> {
  const res = await gql<{ team: TeamWithActiveCycle | null }>(cfg, TEAM_ACTIVE_CYCLE_QUERY, { id: teamId })
  if (!res.data.team) throw new UserError(`team "${teamId}" not found`, 'linear_not_found')
  return { data: res.data.team, warnings: res.warnings }
}

export async function getIssueTeam(
  cfg: LinearConfig,
  ref: IssueRef,
): Promise<GqlResponse<{ id: string; identifier: string; team?: TeamRow | null }>> {
  const res = await gql<{ issue: { id: string; identifier: string; team?: TeamRow | null } | null }>(
    cfg,
    ISSUE_TEAM_QUERY,
    { id: ref.id },
  )
  if (!res.data.issue) throw new UserError(`issue "${ref.id}" not found`, 'linear_not_found')
  return { data: res.data.issue, warnings: res.warnings }
}

export async function getViewer(cfg: LinearConfig): Promise<GqlResponse<{ id: string; name: string; email: string }>> {
  const res = await gql<ViewerStatusData>(cfg, VIEWER_STATUS_QUERY)
  return { data: res.data.viewer, warnings: res.warnings }
}

// --- Mutations ----------------------------------------------------------------

export interface IssueCreateInput {
  title: string
  teamId: string
  description?: string
  projectId?: string
  assigneeId?: string
  priority?: number
  stateId?: string
}

export interface IssueUpdateInput {
  title?: string
  description?: string
  assigneeId?: string
  priority?: number
  stateId?: string
}

export interface ProjectUpdateInputFields {
  name?: string
  description?: string
  state?: string
  targetDate?: string
}

export interface MutatedIssue {
  id: string
  identifier: string
  title: string
  url?: string
}

export interface CreatedComment {
  id: string
  url?: string
  issue: { id: string; identifier: string }
}

export interface MutatedProject {
  id: string
  name: string
  url?: string
}

function mutationFailed(what: string): SystemError {
  return new SystemError(`Linear reported the ${what} did not succeed`, 'linear_api_failed')
}

export async function createIssue(cfg: LinearConfig, input: IssueCreateInput): Promise<GqlResponse<MutatedIssue>> {
  const res = await gql<{ issueCreate: { success: boolean; issue: MutatedIssue | null } }>(
    cfg,
    CREATE_ISSUE_MUTATION,
    { input },
  )
  const payload = res.data.issueCreate
  if (!payload.success || !payload.issue) throw mutationFailed('issue create')
  return { data: payload.issue, warnings: res.warnings }
}

export async function updateIssue(
  cfg: LinearConfig,
  id: string,
  input: IssueUpdateInput,
): Promise<GqlResponse<MutatedIssue>> {
  const res = await gql<{ issueUpdate: { success: boolean; issue: MutatedIssue | null } }>(
    cfg,
    UPDATE_ISSUE_MUTATION,
    { id, input },
  )
  const payload = res.data.issueUpdate
  if (!payload.success || !payload.issue) throw mutationFailed('issue update')
  return { data: payload.issue, warnings: res.warnings }
}

export async function createComment(
  cfg: LinearConfig,
  input: { issueId: string; body: string },
): Promise<GqlResponse<CreatedComment>> {
  const res = await gql<{ commentCreate: { success: boolean; comment: CreatedComment | null } }>(
    cfg,
    CREATE_COMMENT_MUTATION,
    { input },
  )
  const payload = res.data.commentCreate
  if (!payload.success || !payload.comment) throw mutationFailed('comment create')
  return { data: payload.comment, warnings: res.warnings }
}

export async function updateProject(
  cfg: LinearConfig,
  id: string,
  input: ProjectUpdateInputFields,
): Promise<GqlResponse<MutatedProject>> {
  const res = await gql<{ projectUpdate: { success: boolean; project: MutatedProject | null } }>(
    cfg,
    UPDATE_PROJECT_MUTATION,
    { id, input },
  )
  const payload = res.data.projectUpdate
  if (!payload.success || !payload.project) throw mutationFailed('project update')
  return { data: payload.project, warnings: res.warnings }
}

// --- Status probe ------------------------------------------------------------

interface ViewerStatusData {
  viewer: { id: string; name: string; email: string }
  organization: { id: string; name: string; urlKey: string }
}

/**
 * Readiness check for `manifest.status()`: one minimal viewer + organization
 * query. Never throws; failures map to the module's stable codes:
 *   - `not_configured`      — apiKey absent
 *   - `linear_auth`         — Linear rejected the key (401 / auth error)
 *   - `linear_rate_limited` — HTTP 429
 *   - `linear_api_failed`   — 5xx, network, or malformed response
 */
export async function checkLinearStatus(cfg: ModuleConfig): Promise<RunResult> {
  const lc = readLinearConfig(cfg)
  if (!lc.apiKey) {
    return {
      ok: false,
      kind: 'config',
      message: 'linear apiKey not set — run `home linear configure`',
      code: 'not_configured',
    }
  }
  try {
    const { data } = await gql<ViewerStatusData>(lc, VIEWER_STATUS_QUERY)
    return {
      ok: true,
      data: {
        user: data.viewer.name,
        email: data.viewer.email,
        organization: data.organization.name,
        defaultTeam: lc.defaultTeam ?? null,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof HomeError && err.code === 'linear_auth') {
      return { ok: false, kind: 'config', message, code: 'linear_auth' }
    }
    if (err instanceof HomeError && err.code === 'linear_rate_limited') {
      return { ok: false, kind: 'system', message, code: 'linear_rate_limited' }
    }
    return { ok: false, kind: 'system', message, code: 'linear_api_failed' }
  }
}
