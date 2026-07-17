import { afterEach, describe, expect, test } from 'bun:test'
import { SystemError, UserError } from '../core/errors'
import {
  ISSUES_QUERY,
  LINEAR_API_URL,
  VIEWER_STATUS_QUERY,
  blockedBy,
  buildIssueFilter,
  checkLinearStatus,
  gql,
  isActiveCycle,
  isProjectAtRisk,
  isUuid,
  orderMyWork,
  paginate,
  parseIssueRef,
  priorityRank,
  redactKey,
  resolveState,
  resolveTeam,
  resolveUser,
  toIssueRow,
  type Connection,
  type GqlResponse,
  type IssueRow,
} from '../modules/linear/client'

const API_KEY = 'lin_api_supersecret123'
const cfg = { apiKey: API_KEY }

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('parseIssueRef', () => {
  test('identifier normalizes the team key to upper case', () => {
    expect(parseIssueRef('upt-123')).toEqual({ kind: 'identifier', id: 'UPT-123' })
    expect(parseIssueRef('  UPT-7 ')).toEqual({ kind: 'identifier', id: 'UPT-7' })
  })

  test('uuid is recognized and lower-cased', () => {
    expect(parseIssueRef('A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11')).toEqual({
      kind: 'uuid',
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    })
  })

  test('anything else is rejected', () => {
    expect(parseIssueRef('UPT123')).toBeNull()
    expect(parseIssueRef('123-UPT')).toBeNull()
    expect(parseIssueRef('')).toBeNull()
    expect(parseIssueRef('not a ref')).toBeNull()
  })

  test('isUuid distinguishes uuids from identifiers', () => {
    expect(isUuid('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe(true)
    expect(isUuid('UPT-123')).toBe(false)
  })
})

describe('buildIssueFilter', () => {
  test('empty input yields no filter', () => {
    expect(buildIssueFilter({})).toBeUndefined()
  })

  test('composes team/state/assignee comparators from variables, never strings', () => {
    expect(
      buildIssueFilter({ teamId: 't1', stateId: 's1', assigneeId: 'u1' }),
    ).toEqual({
      team: { id: { eq: 't1' } },
      state: { id: { eq: 's1' } },
      assignee: { id: { eq: 'u1' } },
    })
  })

  test('state name uses eqIgnoreCase; isMe wins over assignee id; state types pass through', () => {
    expect(
      buildIssueFilter({
        stateName: 'In Progress',
        stateTypes: { nin: ['completed', 'canceled'] },
        assigneeIsMe: true,
        assigneeId: 'ignored',
      }),
    ).toEqual({
      state: { name: { eqIgnoreCase: 'In Progress' }, type: { nin: ['completed', 'canceled'] } },
      assignee: { isMe: { eq: true } },
    })
  })

  test('project: uuid filters by id, name filters case-insensitively', () => {
    expect(buildIssueFilter({ project: 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11' })).toEqual({
      project: { id: { eq: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' } },
    })
    expect(buildIssueFilter({ project: 'Hermes swarm' })).toEqual({
      project: { name: { eqIgnoreCase: 'Hermes swarm' } },
    })
  })
})

describe('resolvers', () => {
  const teams = [
    { id: 't1', key: 'UPT', name: 'Upton' },
    { id: 't2', key: 'PLT', name: 'Platform' },
    { id: 't3', key: 'PLA', name: 'platform' },
  ]

  test('team: exact id, then key (case-insensitive), then name', () => {
    expect(resolveTeam(teams, 't2').key).toBe('PLT')
    expect(resolveTeam(teams, 'upt').id).toBe('t1')
    expect(resolveTeam(teams, 'Upton').id).toBe('t1')
  })

  test('team: ambiguous name lists all candidates instead of picking first', () => {
    let err: unknown
    try {
      resolveTeam(teams, 'PLATFORM')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(UserError)
    expect((err as UserError).code).toBe('linear_ambiguous')
    expect((err as UserError).message).toContain('PLT')
    expect((err as UserError).message).toContain('PLA')
  })

  test('team: not found lists available keys', () => {
    expect(() => resolveTeam(teams, 'NOPE')).toThrow(/not found.*UPT/)
  })

  const users = [
    { id: 'u1', name: 'Alex Kim', displayName: 'alex', email: 'alex@x.io' },
    { id: 'u2', name: 'Alex Kim', displayName: 'akim', email: 'akim@x.io' },
  ]

  test('user: id and email match exactly before names', () => {
    expect(resolveUser(users, 'u2').email).toBe('akim@x.io')
    expect(resolveUser(users, 'ALEX@X.IO').id).toBe('u1')
    expect(resolveUser(users, 'akim').id).toBe('u2')
  })

  test('user: ambiguous name refuses with candidates', () => {
    let err: unknown
    try {
      resolveUser(users, 'alex kim')
    } catch (e) {
      err = e
    }
    expect((err as UserError).code).toBe('linear_ambiguous')
    expect((err as UserError).message).toContain('alex@x.io')
    expect((err as UserError).message).toContain('akim@x.io')
  })

  test('state: id then case-insensitive name; unknown lists team states', () => {
    const states = [
      { id: 's1', name: 'In Progress', type: 'started', team: { id: 't1', key: 'UPT' } },
      { id: 's2', name: 'Done', type: 'completed', team: { id: 't1', key: 'UPT' } },
    ]
    expect(resolveState(states, 's2').name).toBe('Done')
    expect(resolveState(states, 'in progress').id).toBe('s1')
    expect(() => resolveState(states, 'Blocked')).toThrow(/not found.*In Progress/)
  })
})

describe('redactKey', () => {
  test('removes every occurrence of the key', () => {
    expect(redactKey(`bad request: key ${API_KEY} rejected (${API_KEY})`, API_KEY)).toBe(
      'bad request: key [redacted] rejected ([redacted])',
    )
    expect(redactKey('no key here', API_KEY)).toBe('no key here')
    expect(redactKey('text', '')).toBe('text')
  })
})

describe('gql transport', () => {
  test('POSTs the document with variables and a verbatim Authorization header (no Bearer)', async () => {
    let seenUrl = ''
    let seenAuth: string | undefined
    let seenBody: { query: string; variables: Record<string, unknown> } | undefined
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seenUrl = String(url)
      seenAuth = (init?.headers as Record<string, string>).Authorization
      seenBody = JSON.parse(String(init?.body))
      return jsonResponse({ data: { ok: true } })
    }) as typeof fetch

    await gql(cfg, ISSUES_QUERY, { filter: { state: { name: { eqIgnoreCase: 'In Progress' } } }, first: 5 })
    expect(seenUrl).toBe(LINEAR_API_URL)
    expect(seenAuth).toBe(API_KEY)
    expect(seenBody!.query).toBe(ISSUES_QUERY)
    // User input travels only in variables — the document is a fixed constant.
    expect(seenBody!.query).not.toContain('In Progress')
    expect(seenBody!.variables).toEqual({ filter: { state: { name: { eqIgnoreCase: 'In Progress' } } }, first: 5 })
  })

  test('401 maps to linear_auth', async () => {
    globalThis.fetch = (async (_url: string) => jsonResponse({}, 401)) as typeof fetch
    let err: unknown
    try {
      await gql(cfg, VIEWER_STATUS_QUERY)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(UserError)
    expect((err as UserError).code).toBe('linear_auth')
  })

  test('429 maps to linear_rate_limited', async () => {
    globalThis.fetch = (async (_url: string) => jsonResponse({}, 429)) as typeof fetch
    let err: unknown
    try {
      await gql(cfg, VIEWER_STATUS_QUERY)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(SystemError)
    expect((err as SystemError).code).toBe('linear_rate_limited')
  })

  test('data + errors returns data with structured warnings', async () => {
    globalThis.fetch = (async (_url: string) =>
      jsonResponse({
        data: { issues: { nodes: [], pageInfo: { hasNextPage: false } } },
        errors: [{ message: 'field deprecated' }],
      })) as typeof fetch
    const res = await gql<{ issues: unknown }>(cfg, ISSUES_QUERY)
    expect(res.data.issues).toBeDefined()
    expect(res.warnings).toEqual(['field deprecated'])
  })

  test('errors without data fail with linear_api_failed and redact the key', async () => {
    globalThis.fetch = (async (_url: string) =>
      jsonResponse({ data: null, errors: [{ message: `invalid request for ${API_KEY}` }] })) as typeof fetch
    let err: unknown
    try {
      await gql(cfg, ISSUES_QUERY)
    } catch (e) {
      err = e
    }
    expect((err as SystemError).code).toBe('linear_api_failed')
    expect((err as SystemError).message).not.toContain(API_KEY)
    expect((err as SystemError).message).toContain('[redacted]')
  })

  test('auth-typed GraphQL error maps to linear_auth', async () => {
    globalThis.fetch = (async (_url: string) =>
      jsonResponse({
        errors: [{ message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } }],
      }, 400)) as typeof fetch
    let err: unknown
    try {
      await gql(cfg, VIEWER_STATUS_QUERY)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(UserError)
    expect((err as UserError).code).toBe('linear_auth')
  })

  test('partial-error warnings are redacted too', async () => {
    globalThis.fetch = (async (_url: string) =>
      jsonResponse({
        data: { viewer: {} },
        errors: [{ message: `rate context ${API_KEY}` }],
      })) as typeof fetch
    const res = await gql(cfg, VIEWER_STATUS_QUERY)
    expect(res.warnings).toEqual(['rate context [redacted]'])
  })
})

describe('paginate', () => {
  const page = <T>(nodes: T[], endCursor: string | null): GqlResponse<Connection<T>> => ({
    data: { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } },
    warnings: [],
  })

  test('follows endCursor and trims to the limit', async () => {
    const calls: (string | undefined)[] = []
    const res = await paginate<number>(async (first, after) => {
      calls.push(after)
      expect(first).toBeLessThanOrEqual(50)
      if (after === undefined) return page([...Array(50).keys()], 'c1')
      return page([...Array(50).keys()].map((n) => n + 50), 'c2')
    }, 60)
    expect(calls).toEqual([undefined, 'c1'])
    expect(res.nodes.length).toBe(60)
    expect(res.nodes[59]).toBe(59)
  })

  test('stops when the server has no next page', async () => {
    let calls = 0
    const res = await paginate<number>(async () => {
      calls++
      return page([1, 2], null)
    }, 30)
    expect(calls).toBe(1)
    expect(res.nodes).toEqual([1, 2])
  })

  test('a lying server cannot spin forever — bounded page follow', async () => {
    let calls = 0
    await paginate<number>(async () => {
      calls++
      return page([], 'again')
    }, 30)
    expect(calls).toBe(10)
  })
})

describe('orderMyWork', () => {
  const row = (identifier: string, stateType: string, priority: number): IssueRow => ({
    id: identifier,
    identifier,
    title: identifier,
    state: { name: stateType, type: stateType },
    assignee: null,
    priority,
    priorityLabel: null,
    project: null,
    updatedAt: '2026-07-17T00:00:00.000Z',
  })

  test('orders by state type (started, triage, unstarted, backlog) then priority; priority 0 sorts last', () => {
    const rows = [
      row('UPT-1', 'backlog', 1),
      row('UPT-2', 'started', 0),
      row('UPT-3', 'unstarted', 1),
      row('UPT-4', 'started', 2),
      row('UPT-5', 'triage', 4),
      row('UPT-6', 'started', 1),
    ]
    expect(orderMyWork(rows).map((r) => r.identifier)).toEqual([
      'UPT-6', // started, urgent
      'UPT-4', // started, high
      'UPT-2', // started, none (0 → last within state)
      'UPT-5', // triage
      'UPT-3', // unstarted
      'UPT-1', // backlog
    ])
  })

  test('does not mutate its input and breaks full ties by identifier', () => {
    const rows = [row('UPT-9', 'started', 1), row('UPT-8', 'started', 1)]
    const sorted = orderMyWork(rows)
    expect(sorted.map((r) => r.identifier)).toEqual(['UPT-8', 'UPT-9'])
    expect(rows.map((r) => r.identifier)).toEqual(['UPT-9', 'UPT-8'])
  })

  test('priorityRank pushes "none" after "low"', () => {
    expect(priorityRank(0)).toBeGreaterThan(priorityRank(4))
    expect(priorityRank(1)).toBeLessThan(priorityRank(2))
  })
})

describe('summary helpers', () => {
  test('blockedBy keeps only open blockers from inverse "blocks" relations', () => {
    const node = {
      id: 'i1',
      identifier: 'UPT-1',
      title: 'blocked one',
      priority: 2,
      updatedAt: '2026-07-17T00:00:00.000Z',
      inverseRelations: {
        nodes: [
          { type: 'blocks', issue: { identifier: 'UPT-9', title: 'blocker', state: { name: 'Todo', type: 'unstarted' } } },
          { type: 'blocks', issue: { identifier: 'UPT-8', title: 'done blocker', state: { name: 'Done', type: 'completed' } } },
          { type: 'related', issue: { identifier: 'UPT-7', title: 'just related', state: { name: 'Todo', type: 'unstarted' } } },
        ],
      },
    }
    expect(blockedBy(node)).toEqual([{ identifier: 'UPT-9', title: 'blocker' }])
    expect(blockedBy({ ...node, inverseRelations: null })).toEqual([])
  })

  test('isProjectAtRisk needs an open state and atRisk/offTrack health', () => {
    expect(isProjectAtRisk({ id: 'p', name: 'p', state: 'started', health: 'atRisk' })).toBe(true)
    expect(isProjectAtRisk({ id: 'p', name: 'p', state: 'started', health: 'offTrack' })).toBe(true)
    expect(isProjectAtRisk({ id: 'p', name: 'p', state: 'started', health: 'onTrack' })).toBe(false)
    expect(isProjectAtRisk({ id: 'p', name: 'p', state: 'completed', health: 'offTrack' })).toBe(false)
    expect(isProjectAtRisk({ id: 'p', name: 'p', state: 'started' })).toBe(false)
  })

  test('isActiveCycle is a half-open interval over now', () => {
    const c = { id: 'c', number: 3, startsAt: '2026-07-14T00:00:00.000Z', endsAt: '2026-07-28T00:00:00.000Z' }
    expect(isActiveCycle(c, new Date('2026-07-17T12:00:00Z'))).toBe(true)
    expect(isActiveCycle(c, new Date('2026-07-28T00:00:00Z'))).toBe(false)
    expect(isActiveCycle(c, new Date('2026-07-13T00:00:00Z'))).toBe(false)
  })
})

describe('toIssueRow', () => {
  test('flattens assignee/project and prefers displayName', () => {
    expect(
      toIssueRow({
        id: 'i1',
        identifier: 'UPT-1',
        title: 'Fix keyring',
        priority: 2,
        priorityLabel: 'High',
        updatedAt: '2026-07-17T00:00:00.000Z',
        state: { id: 's1', name: 'In Progress', type: 'started' },
        assignee: { id: 'u1', name: 'Mike Upton', displayName: 'mike' },
        project: { id: 'p1', name: 'Boris recovery' },
      }),
    ).toEqual({
      id: 'i1',
      identifier: 'UPT-1',
      title: 'Fix keyring',
      state: { name: 'In Progress', type: 'started' },
      assignee: 'mike',
      priority: 2,
      priorityLabel: 'High',
      project: 'Boris recovery',
      updatedAt: '2026-07-17T00:00:00.000Z',
    })
  })
})

describe('checkLinearStatus', () => {
  test('missing apiKey → not_configured without touching the network', async () => {
    let calls = 0
    globalThis.fetch = (async (_url: string) => {
      calls++
      return jsonResponse({})
    }) as typeof fetch
    const res = await checkLinearStatus({})
    expect(res).toEqual({
      ok: false,
      kind: 'config',
      message: 'linear apiKey not set — run `home linear configure`',
      code: 'not_configured',
    })
    expect(calls).toBe(0)
  })

  test('working key → viewer + organization + configured team', async () => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.query).toBe(VIEWER_STATUS_QUERY)
      return jsonResponse({
        data: {
          viewer: { id: 'u1', name: 'Mike Upton', email: 'uptonm.dev@gmail.com' },
          organization: { id: 'o1', name: 'Upton HQ', urlKey: 'upton' },
        },
      })
    }) as typeof fetch
    expect(await checkLinearStatus({ apiKey: API_KEY, defaultTeam: 'UPT' })).toEqual({
      ok: true,
      data: { user: 'Mike Upton', email: 'uptonm.dev@gmail.com', organization: 'Upton HQ', defaultTeam: 'UPT' },
    })
  })

  test('rejected key → linear_auth as a config failure', async () => {
    globalThis.fetch = (async (_url: string) => jsonResponse({}, 401)) as typeof fetch
    const res = await checkLinearStatus({ apiKey: 'lin_api_bad' })
    expect(res.ok).toBe(false)
    expect((res as { kind?: string; code?: string }).kind).toBe('config')
    expect((res as { code?: string }).code).toBe('linear_auth')
  })

  test('rate limit → linear_rate_limited; other failures → linear_api_failed', async () => {
    globalThis.fetch = (async (_url: string) => jsonResponse({}, 429)) as typeof fetch
    expect((await checkLinearStatus({ apiKey: API_KEY }) as { code?: string }).code).toBe('linear_rate_limited')

    globalThis.fetch = (async (_url: string) => jsonResponse({ data: null, errors: [{ message: 'boom' }] })) as typeof fetch
    expect((await checkLinearStatus({ apiKey: API_KEY }) as { code?: string }).code).toBe('linear_api_failed')
  })
})
