import { afterEach, describe, expect, test } from 'bun:test'
import { createConsola } from 'consola'
import { UserError } from '../core/errors'
import type { RunContext } from '../core/types'
import {
  ISSUES_QUERY,
  ISSUE_QUERY,
  MY_ISSUES_QUERY,
  MY_OPEN_ISSUES_QUERY,
  PROJECTS_QUERY,
  TEAMS_QUERY,
  TEAM_ACTIVE_CYCLE_QUERY,
  WORKFLOW_STATES_QUERY,
} from '../modules/linear/client'
import { issuesGet, issuesList } from '../modules/linear/commands/issues'
import { myWorkList } from '../modules/linear/commands/my-work'
import { summaryCmd } from '../modules/linear/commands/summary'

const API_KEY = 'lin_api_supersecret123'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function ctx(args: RunContext['args'], config: RunContext['config'] = { apiKey: API_KEY }): RunContext {
  return { args, json: true, quiet: true, verbose: false, log: createConsola({ level: 0 }), config }
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

const issueNode = (identifier: string, stateType: string, priority: number, extra: Record<string, unknown> = {}) => ({
  id: `id-${identifier}`,
  identifier,
  title: `title ${identifier}`,
  priority,
  priorityLabel: null,
  updatedAt: '2026-07-17T00:00:00.000Z',
  state: { id: `st-${stateType}`, name: stateType, type: stateType },
  assignee: null,
  project: null,
  ...extra,
})

describe('issues list', () => {
  test('builds the filter through variables only — team/state resolved to ids, assignee me → isMe', async () => {
    const calls = installGqlFetch({
      [TEAMS_QUERY]: () => ({ teams: TEAMS }),
      [WORKFLOW_STATES_QUERY]: (v) => {
        expect(v.filter).toEqual({ team: { id: { eq: 't1' } } })
        return {
          workflowStates: conn([
            { id: 's-prog', name: 'In Progress', type: 'started', team: { id: 't1', key: 'UPT' } },
          ]),
        }
      },
      [ISSUES_QUERY]: () => ({ issues: conn([issueNode('UPT-1', 'started', 1)]) }),
    })

    const res = await issuesList.run(
      ctx({ team: 'UPT', state: 'in progress', assignee: 'me', project: 'Boris recovery', limit: 5 }),
    )
    expect(res.ok).toBe(true)

    const issuesCall = calls.find((c) => c.query === ISSUES_QUERY)!
    expect(issuesCall.variables).toEqual({
      filter: {
        team: { id: { eq: 't1' } },
        state: { id: { eq: 's-prog' } },
        assignee: { isMe: { eq: true } },
        project: { name: { eqIgnoreCase: 'Boris recovery' } },
      },
      first: 5,
      after: undefined,
    })
    // The document itself never carries user input.
    expect(issuesCall.query).toBe(ISSUES_QUERY)
    expect(issuesCall.query).not.toContain('in progress')
    expect(issuesCall.query).not.toContain('Boris recovery')
  })

  test('falls back to the configured defaultTeam', async () => {
    const calls = installGqlFetch({
      [TEAMS_QUERY]: () => ({ teams: TEAMS }),
      [ISSUES_QUERY]: () => ({ issues: conn([]) }),
    })
    const res = await issuesList.run(ctx({}, { apiKey: API_KEY, defaultTeam: 'UPT' }))
    expect(res.ok).toBe(true)
    expect(calls.find((c) => c.query === ISSUES_QUERY)!.variables.filter).toEqual({ team: { id: { eq: 't1' } } })
  })

  test('ambiguous team name is refused with candidates, never the first match', async () => {
    installGqlFetch({ [TEAMS_QUERY]: () => ({ teams: TEAMS }) })
    let err: unknown
    try {
      await issuesList.run(ctx({ team: 'OPERATIONS' }))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(UserError)
    expect((err as UserError).code).toBe('linear_ambiguous')
    expect((err as UserError).message).toContain('OPS')
    expect((err as UserError).message).toContain('OPX')
  })

  test('rejects a non-positive limit', async () => {
    const res = await issuesList.run(ctx({ limit: 0 }))
    expect(res).toEqual({ ok: false, kind: 'user', message: 'limit must be a positive number', code: 'bad_arg' })
  })
})

describe('issues get', () => {
  const detail = issueNode('UPT-42', 'started', 1, {
    description: 'body',
    url: 'https://linear.app/upton/issue/UPT-42',
    labels: { nodes: [{ id: 'l1', name: 'infra' }] },
    relations: { nodes: [] },
    inverseRelations: { nodes: [] },
    comments: { nodes: [{ id: 'c1' }, { id: 'c2' }], pageInfo: { hasNextPage: false } },
  })

  test('normalizes a lower-case identifier into the $id variable', async () => {
    const calls = installGqlFetch({ [ISSUE_QUERY]: () => ({ issue: detail }) })
    const res = await issuesGet.run(ctx({ issue: 'upt-42' }))
    expect(res.ok).toBe(true)
    expect(calls[0]!.variables).toEqual({ id: 'UPT-42' })
    const data = (res as { data: { issue: { commentCount: number; labels: string[] } } }).data
    expect(data.issue.commentCount).toBe(2)
    expect(data.issue.labels).toEqual(['infra'])
  })

  test('passes a UUID through as-is', async () => {
    const calls = installGqlFetch({ [ISSUE_QUERY]: () => ({ issue: detail }) })
    await issuesGet.run(ctx({ issue: 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11' }))
    expect(calls[0]!.variables).toEqual({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  })

  test('rejects anything that is neither identifier nor UUID before any request', async () => {
    const calls = installGqlFetch({})
    const res = await issuesGet.run(ctx({ issue: 'not-an-issue-ref!' }))
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('bad_arg')
    expect(calls.length).toBe(0)
  })
})

describe('my-work list', () => {
  test('defaults to open work and returns actionable ordering', async () => {
    const calls = installGqlFetch({
      [MY_ISSUES_QUERY]: () => ({
        viewer: {
          assignedIssues: conn([
            issueNode('UPT-1', 'backlog', 1),
            issueNode('UPT-2', 'started', 0),
            issueNode('UPT-3', 'unstarted', 1),
            issueNode('UPT-4', 'started', 1),
          ]),
        },
      }),
    })
    const res = await myWorkList.run(ctx({}))
    expect(res.ok).toBe(true)
    expect(calls[0]!.variables.filter).toEqual({ state: { type: { nin: ['completed', 'canceled'] } } })
    const data = (res as { data: { issues: { identifier: string }[] } }).data
    expect(data.issues.map((i) => i.identifier)).toEqual(['UPT-4', 'UPT-2', 'UPT-3', 'UPT-1'])
  })

  test('--state replaces the default open-work filter', async () => {
    const calls = installGqlFetch({
      [MY_ISSUES_QUERY]: () => ({ viewer: { assignedIssues: conn([]) } }),
    })
    await myWorkList.run(ctx({ state: 'In Review' }))
    expect(calls[0]!.variables.filter).toEqual({ state: { name: { eqIgnoreCase: 'In Review' } } })
  })
})

describe('summary', () => {
  test('composes issues, blocked, active cycle, and at-risk projects from fixtures', async () => {
    installGqlFetch({
      [TEAMS_QUERY]: () => ({ teams: TEAMS }),
      [MY_OPEN_ISSUES_QUERY]: (v) => {
        expect(v.filter).toEqual({
          team: { id: { eq: 't1' } },
          state: { type: { in: ['triage', 'started', 'unstarted'] } },
        })
        return {
          viewer: {
            assignedIssues: conn([
              issueNode('UPT-2', 'started', 2, {
                inverseRelations: {
                  nodes: [
                    { type: 'blocks', issue: { identifier: 'UPT-9', title: 'blocker', state: { name: 'Todo', type: 'unstarted' } } },
                  ],
                },
              }),
              issueNode('UPT-3', 'unstarted', 1, {
                inverseRelations: {
                  nodes: [
                    { type: 'blocks', issue: { identifier: 'UPT-8', title: 'done', state: { name: 'Done', type: 'completed' } } },
                  ],
                },
              }),
            ]),
          },
        }
      },
      [TEAM_ACTIVE_CYCLE_QUERY]: (v) => {
        expect(v).toEqual({ id: 't1' })
        return {
          team: {
            id: 't1',
            key: 'UPT',
            name: 'Upton',
            activeCycle: {
              id: 'cy1',
              number: 12,
              name: null,
              startsAt: '2026-07-14T00:00:00.000Z',
              endsAt: '2026-07-28T00:00:00.000Z',
              progress: 0.4,
            },
          },
        }
      },
      [PROJECTS_QUERY]: () => ({
        projects: conn([
          { id: 'p1', name: 'On track', state: 'started', health: 'onTrack', progress: 0.7, targetDate: '2026-08-01' },
          { id: 'p2', name: 'Slipping', state: 'started', health: 'offTrack', progress: 0.2, targetDate: '2026-07-20' },
          { id: 'p3', name: 'Shipped', state: 'completed', health: 'offTrack', progress: 1, targetDate: null },
        ]),
      }),
    })

    const res = await summaryCmd.run(ctx({}, { apiKey: API_KEY, defaultTeam: 'UPT' }))
    expect(res.ok).toBe(true)
    const data = (res as { data: Record<string, unknown> }).data
    expect(data.team).toEqual({ key: 'UPT', name: 'Upton' })
    expect((data.myActiveIssues as { identifier: string }[]).map((i) => i.identifier)).toEqual(['UPT-2', 'UPT-3'])
    expect(data.blockedIssues).toEqual([
      { identifier: 'UPT-2', title: 'title UPT-2', blockedBy: [{ identifier: 'UPT-9', title: 'blocker' }] },
    ])
    expect(data.activeCycle).toEqual({
      number: 12,
      name: null,
      startsAt: '2026-07-14T00:00:00.000Z',
      endsAt: '2026-07-28T00:00:00.000Z',
      progress: 0.4,
    })
    expect(data.projectsAtRisk).toEqual([
      { id: 'p2', name: 'Slipping', state: 'started', health: 'offTrack', progress: 0.2, targetDate: '2026-07-20' },
    ])
    expect(data.warnings).toBeUndefined()
  })

  test('without a team it still reports personal work and skips the cycle', async () => {
    installGqlFetch({
      [MY_OPEN_ISSUES_QUERY]: (v) => {
        expect(v.filter).toEqual({ state: { type: { in: ['triage', 'started', 'unstarted'] } } })
        return { viewer: { assignedIssues: conn([issueNode('UPT-5', 'started', 3)]) } }
      },
      [PROJECTS_QUERY]: () => ({ projects: conn([]) }),
    })
    const res = await summaryCmd.run(ctx({}))
    expect(res.ok).toBe(true)
    const data = (res as { data: Record<string, unknown> }).data
    expect(data.team).toBeNull()
    expect(data.activeCycle).toBeNull()
    expect((data.myActiveIssues as unknown[]).length).toBe(1)
  })

  test('partial GraphQL errors surface as warnings alongside data', async () => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string }
      const data =
        body.query === MY_OPEN_ISSUES_QUERY
          ? { viewer: { assignedIssues: conn([]) } }
          : { projects: conn([]) }
      return new Response(
        JSON.stringify({ data, errors: [{ message: `partial failure in ${body.query === PROJECTS_QUERY ? 'projects' : 'issues'}` }] }),
        { status: 200 },
      )
    }) as typeof fetch

    const res = await summaryCmd.run(ctx({}))
    expect(res.ok).toBe(true)
    const data = (res as { data: { warnings?: string[] } }).data
    expect(data.warnings).toEqual(['partial failure in issues', 'partial failure in projects'])
  })
})
