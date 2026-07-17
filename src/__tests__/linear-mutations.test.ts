import { afterEach, describe, expect, test } from 'bun:test'
import { createConsola } from 'consola'
import { SystemError, UserError } from '../core/errors'
import type { RunContext } from '../core/types'
import {
  CREATE_COMMENT_MUTATION,
  CREATE_ISSUE_MUTATION,
  ISSUE_TEAM_QUERY,
  PROJECT_STATUSES_QUERY,
  PROJECTS_QUERY,
  TEAMS_QUERY,
  UPDATE_ISSUE_MUTATION,
  UPDATE_PROJECT_MUTATION,
  USERS_QUERY,
  VIEWER_STATUS_QUERY,
  WORKFLOW_STATES_QUERY,
  createIssue,
  parsePriority,
} from '../modules/linear/client'
import { issuesComment, issuesCreate, issuesUpdate, projectsUpdate } from '../modules/linear/commands/mutations'
import { setStdinSource } from '../modules/linear/commands/shared'

const API_KEY = 'lin_api_supersecret123'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  setStdinSource(async () => {
    throw new Error('stdin not stubbed')
  })
})

function ctx(args: RunContext['args'], config: RunContext['config'] = { apiKey: API_KEY }): RunContext {
  return { args, json: true, quiet: true, verbose: false, log: createConsola({ level: 0 }), config }
}

function stubStdin(text: string): void {
  setStdinSource(async () => text)
}

const conn = <T>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } })

interface SeenCall {
  query: string
  variables: Record<string, unknown>
}

/** Route mocked GraphQL calls by document constant; record every call. */
function installGqlFetch(routes: Record<string, (variables: Record<string, unknown>) => unknown>): SeenCall[] {
  const calls: SeenCall[] = []
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> }
    calls.push({ query: body.query, variables: body.variables })
    const route = routes[body.query]
    if (!route) throw new Error(`unrouted GraphQL document: ${body.query.slice(0, 60)}`)
    return new Response(JSON.stringify({ data: route(body.variables) }), { status: 200 })
  }) as typeof fetch
  return calls
}

const TEAMS = conn([
  { id: 't1', key: 'UPT', name: 'Upton' },
  { id: 't2', key: 'OPS', name: 'Operations' },
  { id: 't3', key: 'OPX', name: 'operations' },
])

const USERS = conn([
  { id: 'u1', name: 'Mike Upton', displayName: 'mike', email: 'uptonm.dev@gmail.com', active: true },
  { id: 'u2', name: 'Sam Doe', displayName: 'sam', email: 'sam@example.com', active: true },
  { id: 'u3', name: 'Sam Doe', displayName: 'sam2', email: 'sam2@example.com', active: true },
])

const UPT_STATES = conn([
  { id: 's-todo', name: 'Todo', type: 'unstarted', team: { id: 't1', key: 'UPT' } },
  { id: 's-done', name: 'Done', type: 'completed', team: { id: 't1', key: 'UPT' } },
])

const createdIssue = { id: 'i-new', identifier: 'UPT-77', title: 'New thing', url: 'https://linear.app/u/issue/UPT-77' }

async function thrown(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (e) {
    return e
  }
  return undefined
}

describe('confirmation guard', () => {
  test('every mutation refuses without --yes — stable code, zero requests', async () => {
    const calls = installGqlFetch({})
    stubStdin('some body')
    const cases = [
      () => issuesCreate.run(ctx({ title: 'T', team: 'UPT' })),
      () => issuesUpdate.run(ctx({ issue: 'UPT-1', title: 'T' })),
      () => issuesComment.run(ctx({ issue: 'UPT-1', 'body-stdin': true })),
      () => projectsUpdate.run(ctx({ project: 'Hermes swarm', state: 'paused' })),
    ]
    for (const run of cases) {
      const res = (await run()) as { ok: boolean; code?: string; message?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('confirmation_required')
      expect(res.message).toContain('--yes')
      expect(calls.length).toBe(0)
    }
  })
})

describe('issues create', () => {
  test('resolves team/project/assignee/state and sends the exact input variables', async () => {
    stubStdin('Long description body.\n')
    const calls = installGqlFetch({
      [TEAMS_QUERY]: () => ({ teams: TEAMS }),
      [PROJECTS_QUERY]: () => ({ projects: conn([{ id: 'p1', name: 'Hermes swarm', state: 'started' }]) }),
      [USERS_QUERY]: () => ({ users: USERS }),
      [WORKFLOW_STATES_QUERY]: (v) => {
        expect(v.filter).toEqual({ team: { id: { eq: 't1' } } })
        return { workflowStates: UPT_STATES }
      },
      [CREATE_ISSUE_MUTATION]: () => ({ issueCreate: { success: true, issue: createdIssue } }),
    })

    const res = await issuesCreate.run(
      ctx({
        title: 'New thing',
        team: 'UPT',
        'description-stdin': true,
        project: 'Hermes swarm',
        assignee: 'mike',
        priority: 'high',
        state: 'Todo',
        yes: true,
      }),
    )
    expect(res.ok).toBe(true)

    const mutation = calls.find((c) => c.query === CREATE_ISSUE_MUTATION)!
    expect(mutation.variables).toEqual({
      input: {
        title: 'New thing',
        teamId: 't1',
        description: 'Long description body.',
        projectId: 'p1',
        assigneeId: 'u1',
        priority: 2,
        stateId: 's-todo',
      },
    })
    // The document itself never carries user input.
    expect(mutation.query).toBe(CREATE_ISSUE_MUTATION)
    expect(mutation.query).not.toContain('New thing')

    const data = (res as { data: Record<string, unknown> }).data
    expect(data.issue).toEqual({
      id: 'i-new',
      identifier: 'UPT-77',
      title: 'New thing',
      url: 'https://linear.app/u/issue/UPT-77',
    })
    expect(data.team).toEqual({ key: 'UPT', name: 'Upton' })
  })

  test('minimal create sends only title and teamId', async () => {
    const calls = installGqlFetch({
      [TEAMS_QUERY]: () => ({ teams: TEAMS }),
      [CREATE_ISSUE_MUTATION]: () => ({ issueCreate: { success: true, issue: createdIssue } }),
    })
    const res = await issuesCreate.run(ctx({ title: 'Just this', team: 'upt', yes: true }))
    expect(res.ok).toBe(true)
    expect(calls.find((c) => c.query === CREATE_ISSUE_MUTATION)!.variables).toEqual({
      input: { title: 'Just this', teamId: 't1' },
    })
  })

  test('--assignee me resolves through the viewer, not the user catalog', async () => {
    const calls = installGqlFetch({
      [TEAMS_QUERY]: () => ({ teams: TEAMS }),
      [VIEWER_STATUS_QUERY]: () => ({
        viewer: { id: 'u-viewer', name: 'Mike', email: 'uptonm.dev@gmail.com' },
        organization: { id: 'o1', name: 'Upton', urlKey: 'upton' },
      }),
      [CREATE_ISSUE_MUTATION]: () => ({ issueCreate: { success: true, issue: createdIssue } }),
    })
    await issuesCreate.run(ctx({ title: 'T', team: 'UPT', assignee: 'me', yes: true }))
    const input = calls.find((c) => c.query === CREATE_ISSUE_MUTATION)!.variables.input as Record<string, unknown>
    expect(input.assigneeId).toBe('u-viewer')
    expect(calls.some((c) => c.query === USERS_QUERY)).toBe(false)
  })

  test('ambiguous team is refused and the mutation is never sent', async () => {
    const calls = installGqlFetch({ [TEAMS_QUERY]: () => ({ teams: TEAMS }) })
    const err = await thrown(() => issuesCreate.run(ctx({ title: 'T', team: 'OPERATIONS', yes: true })))
    expect(err).toBeInstanceOf(UserError)
    expect((err as UserError).code).toBe('linear_ambiguous')
    expect(calls.some((c) => c.query === CREATE_ISSUE_MUTATION)).toBe(false)
  })

  test('missing team fails before any request — no defaultTeam fallback', async () => {
    const calls = installGqlFetch({})
    const res = await issuesCreate.run(ctx({ title: 'T', yes: true }, { apiKey: API_KEY, defaultTeam: 'UPT' }))
    expect(res).toEqual({
      ok: false,
      kind: 'user',
      message: 'team is required — creates never fall back to the configured defaultTeam',
      code: 'missing_arg',
    })
    expect(calls.length).toBe(0)
  })
})

describe('priority mapping', () => {
  test('names map to the Linear int scale', () => {
    expect(parsePriority('none')).toBe(0)
    expect(parsePriority('URGENT')).toBe(1)
    expect(parsePriority('high')).toBe(2)
    expect(parsePriority('Medium')).toBe(3)
    expect(parsePriority(' low ')).toBe(4)
  })

  test('unknown names are rejected', () => {
    let err: unknown
    try {
      parsePriority('critical')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(UserError)
    expect((err as UserError).code).toBe('bad_arg')
    expect((err as UserError).message).toContain('urgent')
  })

  test('an unknown priority on create is rejected before any request', async () => {
    const calls = installGqlFetch({})
    const err = await thrown(() => issuesCreate.run(ctx({ title: 'T', team: 'UPT', priority: 'p1', yes: true })))
    expect((err as UserError).code).toBe('bad_arg')
    expect(calls.length).toBe(0)
  })
})

describe('issues update', () => {
  test('sends only the fields passed — state resolved in the issue team', async () => {
    const calls = installGqlFetch({
      [ISSUE_TEAM_QUERY]: (v) => {
        expect(v).toEqual({ id: 'UPT-42' })
        return { issue: { id: 'i42', identifier: 'UPT-42', team: { id: 't1', key: 'UPT', name: 'Upton' } } }
      },
      [WORKFLOW_STATES_QUERY]: () => ({ workflowStates: UPT_STATES }),
      [UPDATE_ISSUE_MUTATION]: () => ({
        issueUpdate: { success: true, issue: { id: 'i42', identifier: 'UPT-42', title: 't', url: 'https://linear.app/u/issue/UPT-42' } },
      }),
    })
    const res = await issuesUpdate.run(ctx({ issue: 'upt-42', state: 'done', priority: 'none', yes: true }))
    expect(res.ok).toBe(true)
    expect(calls.find((c) => c.query === UPDATE_ISSUE_MUTATION)!.variables).toEqual({
      id: 'UPT-42',
      input: { priority: 0, stateId: 's-done' },
    })
    const data = (res as { data: Record<string, unknown> }).data
    expect(data.issue).toEqual({ id: 'i42', identifier: 'UPT-42', url: 'https://linear.app/u/issue/UPT-42' })
    expect(data.changed).toEqual({ priority: 0, stateId: 's-done' })
  })

  test('title-only update needs no lookups at all', async () => {
    const calls = installGqlFetch({
      [UPDATE_ISSUE_MUTATION]: () => ({
        issueUpdate: { success: true, issue: { id: 'i42', identifier: 'UPT-42', title: 'Renamed' } },
      }),
    })
    await issuesUpdate.run(ctx({ issue: 'UPT-42', title: 'Renamed', yes: true }))
    expect(calls.map((c) => c.query)).toEqual([UPDATE_ISSUE_MUTATION])
    expect(calls[0]!.variables).toEqual({ id: 'UPT-42', input: { title: 'Renamed' } })
  })

  test('description arrives via stdin', async () => {
    stubStdin('New body from stdin\n')
    const calls = installGqlFetch({
      [UPDATE_ISSUE_MUTATION]: () => ({
        issueUpdate: { success: true, issue: { id: 'i42', identifier: 'UPT-42', title: 't' } },
      }),
    })
    await issuesUpdate.run(ctx({ issue: 'UPT-42', 'description-stdin': true, yes: true }))
    expect(calls[0]!.variables).toEqual({ id: 'UPT-42', input: { description: 'New body from stdin' } })
  })

  test('with nothing to update it refuses before any request', async () => {
    const calls = installGqlFetch({})
    const res = await issuesUpdate.run(ctx({ issue: 'UPT-42', yes: true }))
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('missing_arg')
    expect(calls.length).toBe(0)
  })

  test('ambiguous state in the issue team is refused, mutation never sent', async () => {
    const calls = installGqlFetch({
      [ISSUE_TEAM_QUERY]: () => ({ issue: { id: 'i42', identifier: 'UPT-42', team: { id: 't1', key: 'UPT', name: 'Upton' } } }),
      [WORKFLOW_STATES_QUERY]: () => ({
        workflowStates: conn([
          { id: 's-done-a', name: 'Done', type: 'completed', team: { id: 't1', key: 'UPT' } },
          { id: 's-done-b', name: 'done', type: 'canceled', team: { id: 't1', key: 'UPT' } },
        ]),
      }),
    })
    const err = await thrown(() => issuesUpdate.run(ctx({ issue: 'UPT-42', state: 'Done', yes: true })))
    expect((err as UserError).code).toBe('linear_ambiguous')
    expect(calls.some((c) => c.query === UPDATE_ISSUE_MUTATION)).toBe(false)
  })

  test('ambiguous assignee is refused, mutation never sent', async () => {
    const calls = installGqlFetch({ [USERS_QUERY]: () => ({ users: USERS }) })
    const err = await thrown(() => issuesUpdate.run(ctx({ issue: 'UPT-42', assignee: 'Sam Doe', yes: true })))
    expect((err as UserError).code).toBe('linear_ambiguous')
    expect((err as UserError).message).toContain('sam@example.com')
    expect(calls.some((c) => c.query === UPDATE_ISSUE_MUTATION)).toBe(false)
  })

  test('a bad issue ref is rejected before any request', async () => {
    const calls = installGqlFetch({})
    const res = await issuesUpdate.run(ctx({ issue: 'not-a-ref!', title: 'T', yes: true }))
    expect((res as { code?: string }).code).toBe('bad_arg')
    expect(calls.length).toBe(0)
  })

  test('partial GraphQL errors on the mutation surface as warnings', async () => {
    globalThis.fetch = (async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          data: { issueUpdate: { success: true, issue: { id: 'i42', identifier: 'UPT-42', title: 't' } } },
          errors: [{ message: 'subscription entity limit hit' }],
        }),
        { status: 200 },
      )) as typeof fetch
    const res = await issuesUpdate.run(ctx({ issue: 'UPT-42', title: 'T', yes: true }))
    expect(res.ok).toBe(true)
    expect((res as { data: { warnings?: string[] } }).data.warnings).toEqual(['subscription entity limit hit'])
  })

  test('success:false from Linear is a hard failure', async () => {
    installGqlFetch({
      [UPDATE_ISSUE_MUTATION]: () => ({ issueUpdate: { success: false, issue: null } }),
    })
    const err = await thrown(() => issuesUpdate.run(ctx({ issue: 'UPT-42', title: 'T', yes: true })))
    expect(err).toBeInstanceOf(SystemError)
    expect((err as SystemError).code).toBe('linear_api_failed')
  })
})

describe('issues comment', () => {
  test('pipes the stdin body into variables and echoes comment id + issue identifier', async () => {
    stubStdin('  Deployed the fix.\n')
    const calls = installGqlFetch({
      [CREATE_COMMENT_MUTATION]: () => ({
        commentCreate: {
          success: true,
          comment: { id: 'c9', url: 'https://linear.app/u/comment/c9', issue: { id: 'i42', identifier: 'UPT-42' } },
        },
      }),
    })
    const res = await issuesComment.run(ctx({ issue: 'upt-42', 'body-stdin': true, yes: true }))
    expect(res.ok).toBe(true)
    expect(calls[0]!.variables).toEqual({ input: { issueId: 'UPT-42', body: 'Deployed the fix.' } })
    expect((res as { data: unknown }).data).toEqual({
      comment: { id: 'c9', url: 'https://linear.app/u/comment/c9' },
      issue: { identifier: 'UPT-42' },
    })
  })

  test('refuses without --body-stdin — the body never comes from argv', async () => {
    const calls = installGqlFetch({})
    const res = await issuesComment.run(ctx({ issue: 'UPT-42', yes: true }))
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('missing_arg')
    expect(calls.length).toBe(0)
  })

  test('empty stdin is refused, nothing sent', async () => {
    stubStdin('   \n')
    const calls = installGqlFetch({})
    const err = await thrown(() => issuesComment.run(ctx({ issue: 'UPT-42', 'body-stdin': true, yes: true })))
    expect(err).toBeInstanceOf(UserError)
    expect((err as UserError).code).toBe('missing_arg')
    expect(calls.length).toBe(0)
  })
})

describe('projects update', () => {
  const PROJECTS = conn([
    { id: 'p1', name: 'Hermes swarm', state: 'started' },
    { id: 'p2', name: 'Dup name', state: 'started' },
    { id: 'p3', name: 'dup name', state: 'paused' },
  ])

  // A realistic workspace flow: two started-type statuses make `started` ambiguous.
  const PROJECT_STATUSES = conn([
    { id: 'ps-backlog', name: 'Backlog', type: 'backlog' },
    { id: 'ps-planned', name: 'Planned', type: 'planned' },
    { id: 'ps-progress', name: 'In Progress', type: 'started' },
    { id: 'ps-review', name: 'In Review', type: 'started' },
    { id: 'ps-paused', name: 'Paused', type: 'paused' },
    { id: 'ps-done', name: 'Done', type: 'completed' },
  ])

  test('resolves --state to a ProjectStatus id (statusId), not the nonexistent state field', async () => {
    const calls = installGqlFetch({
      [PROJECTS_QUERY]: () => ({ projects: PROJECTS }),
      [PROJECT_STATUSES_QUERY]: () => ({ projectStatuses: PROJECT_STATUSES }),
      [UPDATE_PROJECT_MUTATION]: () => ({
        projectUpdate: { success: true, project: { id: 'p1', name: 'Hermes swarm', url: 'https://linear.app/u/project/p1' } },
      }),
    })
    const res = await projectsUpdate.run(
      ctx({ project: 'hermes swarm', state: 'paused', 'target-date': '2026-09-01', yes: true }),
    )
    expect(res.ok).toBe(true)
    // The mutation input carries statusId — ProjectUpdateInput has no `state`.
    expect(calls.find((c) => c.query === UPDATE_PROJECT_MUTATION)!.variables).toEqual({
      id: 'p1',
      input: { statusId: 'ps-paused', targetDate: '2026-09-01' },
    })
    const data = (res as { data: Record<string, unknown> }).data
    expect(data.project).toEqual({ id: 'p1', name: 'Hermes swarm', url: 'https://linear.app/u/project/p1' })
    // The echo keeps the human-facing requested state alongside the sent statusId.
    expect(data.changed).toEqual({ statusId: 'ps-paused', targetDate: '2026-09-01', state: 'paused' })
  })

  test('an exact status name resolves even when its category is ambiguous', async () => {
    const calls = installGqlFetch({
      [PROJECTS_QUERY]: () => ({ projects: PROJECTS }),
      [PROJECT_STATUSES_QUERY]: () => ({ projectStatuses: PROJECT_STATUSES }),
      [UPDATE_PROJECT_MUTATION]: () => ({ projectUpdate: { success: true, project: { id: 'p1', name: 'Hermes swarm' } } }),
    })
    await projectsUpdate.run(ctx({ project: 'hermes swarm', state: 'In Review', yes: true }))
    expect(calls.find((c) => c.query === UPDATE_PROJECT_MUTATION)!.variables).toEqual({
      id: 'p1',
      input: { statusId: 'ps-review' },
    })
  })

  test('a category matching more than one status is refused, mutation never sent', async () => {
    const calls = installGqlFetch({
      [PROJECTS_QUERY]: () => ({ projects: PROJECTS }),
      [PROJECT_STATUSES_QUERY]: () => ({ projectStatuses: PROJECT_STATUSES }),
    })
    const err = await thrown(() => projectsUpdate.run(ctx({ project: 'hermes swarm', state: 'started', yes: true })))
    expect((err as UserError).code).toBe('linear_ambiguous')
    expect((err as UserError).message).toContain('In Progress')
    expect((err as UserError).message).toContain('In Review')
    expect(calls.some((c) => c.query === UPDATE_PROJECT_MUTATION)).toBe(false)
  })

  test('a UUID target skips the catalog lookup', async () => {
    stubStdin('Refined scope.\n')
    const calls = installGqlFetch({
      [UPDATE_PROJECT_MUTATION]: () => ({
        projectUpdate: { success: true, project: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', name: 'X' } },
      }),
    })
    await projectsUpdate.run(
      ctx({ project: 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11', 'description-stdin': true, yes: true }),
    )
    expect(calls.map((c) => c.query)).toEqual([UPDATE_PROJECT_MUTATION])
    expect(calls[0]!.variables).toEqual({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      input: { description: 'Refined scope.' },
    })
  })

  test('ambiguous project name is refused, mutation never sent', async () => {
    const calls = installGqlFetch({ [PROJECTS_QUERY]: () => ({ projects: PROJECTS }) })
    const err = await thrown(() => projectsUpdate.run(ctx({ project: 'DUP NAME', name: 'New', yes: true })))
    expect((err as UserError).code).toBe('linear_ambiguous')
    expect((err as UserError).message).toContain('p2')
    expect((err as UserError).message).toContain('p3')
    expect(calls.some((c) => c.query === UPDATE_PROJECT_MUTATION)).toBe(false)
  })

  test('a malformed target date is rejected before any request', async () => {
    const calls = installGqlFetch({})
    const badDate = await projectsUpdate.run(ctx({ project: 'Hermes swarm', 'target-date': 'Sept 1', yes: true }))
    expect((badDate as { code?: string }).code).toBe('bad_arg')
    expect(calls.length).toBe(0)
  })

  test('an unknown state is refused by the live-status resolver, mutation never sent', async () => {
    const calls = installGqlFetch({
      [PROJECTS_QUERY]: () => ({ projects: PROJECTS }),
      [PROJECT_STATUSES_QUERY]: () => ({ projectStatuses: PROJECT_STATUSES }),
    })
    const err = await thrown(() => projectsUpdate.run(ctx({ project: 'Hermes swarm', state: 'archived', yes: true })))
    expect((err as UserError).code).toBe('linear_not_found')
    expect(calls.some((c) => c.query === UPDATE_PROJECT_MUTATION)).toBe(false)
  })

  test('with nothing to update it refuses before any request', async () => {
    const calls = installGqlFetch({})
    const res = await projectsUpdate.run(ctx({ project: 'Hermes swarm', yes: true }))
    expect((res as { code?: string }).code).toBe('missing_arg')
    expect(calls.length).toBe(0)
  })
})

describe('mutation transport never retries', () => {
  test('a 5xx on a mutation is not retried — exactly one POST, so no duplicate write', async () => {
    let posts = 0
    globalThis.fetch = (async (_url: string, _init?: RequestInit) => {
      posts++
      return new Response(JSON.stringify({ data: null, errors: [{ message: 'server exploded' }] }), { status: 500 })
    }) as typeof fetch
    // The write fails, but it must fail after a SINGLE attempt — a retry could
    // create a second issue if the first actually committed before the 5xx.
    const err = await thrown(() => createIssue({ apiKey: API_KEY }, { title: 'T', teamId: 't1' }))
    expect(err).toBeInstanceOf(SystemError)
    expect(posts).toBe(1)
  })
})
