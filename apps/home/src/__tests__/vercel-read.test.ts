import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  deploymentPathSegment,
  findDomainOwner,
  getDeployment,
  listDeploymentEvents,
  listDeployments,
  listProjects,
  listSharedEnv,
  normalizeDeploymentState,
  redactToken,
  toIso,
  type VercelConfig,
} from '../modules/vercel/client'
// Enter the sync↔registry import cycle through the registry, as the app does —
// importing ../modules/vercel directly here would hit the manifest's TDZ.
import { moduleByName } from '../registry'
import { HomeError, UserError } from '../core/errors'

const manifest = moduleByName.vercel!

const TOKEN = 'vtok_test_1234567890abcdef'
const CFG: VercelConfig = { teamSlug: 'my-team' }

const realFetch = globalThis.fetch
let requests: URL[] = []

function stubFetch(handler: (url: URL) => Response): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input))
    requests.push(url)
    return handler(url)
  }) as typeof fetch
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

beforeEach(() => {
  requests = []
  process.env.VERCEL_TOKEN = TOKEN
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('normalizeDeploymentState', () => {
  test('maps every raw readyState onto the normalized vocabulary', () => {
    expect(normalizeDeploymentState('QUEUED')).toBe('queued')
    expect(normalizeDeploymentState('INITIALIZING')).toBe('building')
    expect(normalizeDeploymentState('BUILDING')).toBe('building')
    expect(normalizeDeploymentState('READY')).toBe('ready')
    expect(normalizeDeploymentState('ERROR')).toBe('error')
    expect(normalizeDeploymentState('CANCELED')).toBe('canceled')
  })

  test('lowercase input and unknowns are handled', () => {
    expect(normalizeDeploymentState('ready')).toBe('ready')
    expect(normalizeDeploymentState('DELETED')).toBe('unknown')
    expect(normalizeDeploymentState(undefined)).toBe('unknown')
  })
})

describe('deploymentPathSegment (id vs url resolution)', () => {
  test('a deployment id passes through untouched', () => {
    expect(deploymentPathSegment('dpl_C6aWACLBVrErTMV7gC94YRcUzM7x')).toBe('dpl_C6aWACLBVrErTMV7gC94YRcUzM7x')
  })

  test('a full URL is reduced to its hostname', () => {
    expect(deploymentPathSegment('https://my-app-abc123.vercel.app/some/path')).toBe('my-app-abc123.vercel.app')
    expect(deploymentPathSegment('http://my-app.vercel.app/')).toBe('my-app.vercel.app')
    expect(deploymentPathSegment(' my-app.vercel.app ')).toBe('my-app.vercel.app')
  })
})

describe('listProjects pagination', () => {
  test('follows pagination.next as until= and preserves upstream ids', async () => {
    stubFetch((url) => {
      if (url.searchParams.get('until') === '111') {
        return jsonResponse({
          projects: [{ id: 'prj_2', name: 'two', updatedAt: 1700000000000 }],
          pagination: { next: null },
        })
      }
      return jsonResponse({
        projects: [
          {
            id: 'prj_1',
            name: 'one',
            framework: 'nextjs',
            link: { type: 'github', org: 'me', repo: 'one', productionBranch: 'main' },
          },
        ],
        pagination: { next: 111 },
      })
    })

    const projects = await listProjects(CFG, 10)

    expect(projects.map((p) => p.id)).toEqual(['prj_1', 'prj_2'])
    expect(projects[0]).toEqual({
      id: 'prj_1',
      name: 'one',
      framework: 'nextjs',
      repo: 'github:me/one',
      updatedAt: null,
    })
    expect(projects[1]!.updatedAt).toBe(toIso(1700000000000))
    expect(requests).toHaveLength(2)
    expect(requests.every((u) => u.pathname === '/v9/projects' && u.searchParams.get('slug') === 'my-team')).toBe(true)
    expect(requests[1]!.searchParams.get('until')).toBe('111')
  })

  test('stops at --limit even when more pages exist', async () => {
    stubFetch(() =>
      jsonResponse({
        projects: [{ id: 'prj_1', name: 'one' }],
        pagination: { next: 222 },
      }),
    )

    const projects = await listProjects(CFG, 1)

    expect(projects).toHaveLength(1)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.searchParams.get('limit')).toBe('1')
  })
})

describe('listSharedEnv pagination', () => {
  test('concatenates every page, following pagination.next as until=', async () => {
    stubFetch((url) => {
      if (url.searchParams.get('until') === '555') {
        return jsonResponse({
          data: [{ id: 'e2', key: 'HOME__gcal__token', type: 'encrypted' }],
          pagination: { next: null },
        })
      }
      return jsonResponse({
        data: [{ id: 'e1', key: 'HOME__unifi__url', type: 'encrypted' }],
        pagination: { next: 555 },
      })
    })

    const vars = await listSharedEnv(CFG)

    expect(vars).toEqual([
      { id: 'e1', key: 'HOME__unifi__url', type: 'encrypted' },
      { id: 'e2', key: 'HOME__gcal__token', type: 'encrypted' },
    ])
    expect(requests).toHaveLength(2)
    expect(requests.every((u) => u.pathname === '/v1/env' && u.searchParams.get('slug') === 'my-team')).toBe(true)
    expect(requests.every((u) => u.searchParams.get('search') === 'HOME__')).toBe(true)
    expect(requests[0]!.searchParams.has('until')).toBe(false)
    expect(requests[1]!.searchParams.get('until')).toBe('555')
  })
})

describe('listDeployments', () => {
  const READY_DEPLOYMENT = {
    uid: 'dpl_1',
    name: 'myapp',
    url: 'myapp-abc.vercel.app',
    readyState: 'READY',
    target: 'production',
    projectId: 'prj_1',
    createdAt: 1783783933976,
    creator: { username: 'mike' },
    meta: {
      githubCommitSha: '97646d1',
      githubCommitMessage: 'fix build',
      githubCommitRef: 'master',
    },
  }

  test('paginates and normalizes state, commit, creator, timestamps', async () => {
    stubFetch((url) => {
      if (url.searchParams.get('until') === '333') {
        return jsonResponse({
          deployments: [{ uid: 'dpl_2', name: 'myapp', readyState: 'ERROR', created: 1700000000000 }],
          pagination: { next: null },
        })
      }
      return jsonResponse({ deployments: [READY_DEPLOYMENT], pagination: { next: 333 } })
    })

    const deployments = await listDeployments(CFG, { limit: 10 })

    expect(deployments.map((d) => d.id)).toEqual(['dpl_1', 'dpl_2'])
    expect(deployments[0]).toEqual({
      id: 'dpl_1',
      project: 'myapp',
      projectId: 'prj_1',
      url: 'myapp-abc.vercel.app',
      state: 'ready',
      target: 'production',
      commit: { sha: '97646d1', message: 'fix build', ref: 'master' },
      creator: 'mike',
      createdAt: '2026-07-11T15:32:13.976Z',
    })
    expect(deployments[1]!.state).toBe('error')
    expect(deployments[1]!.createdAt).toBe(toIso(1700000000000))
    expect(requests).toHaveLength(2)
    expect(requests[1]!.searchParams.get('until')).toBe('333')
  })

  test('maps filters onto v6 query params (name→app, prj_→projectId, state expansion)', async () => {
    stubFetch(() => jsonResponse({ deployments: [], pagination: { next: null } }))

    await listDeployments(CFG, { project: 'myapp', target: 'production', state: 'building', limit: 5 })
    await listDeployments(CFG, { project: 'prj_123', limit: 5 })

    const first = requests[0]!
    expect(first.pathname).toBe('/v6/deployments')
    expect(first.searchParams.get('app')).toBe('myapp')
    expect(first.searchParams.get('target')).toBe('production')
    expect(first.searchParams.get('state')).toBe('BUILDING,INITIALIZING')
    expect(requests[1]!.searchParams.get('projectId')).toBe('prj_123')
    expect(requests[1]!.searchParams.has('app')).toBe(false)
  })

  test('rejects an unknown state filter before calling the API', async () => {
    stubFetch(() => jsonResponse({}))
    expect(listDeployments(CFG, { state: 'exploded', limit: 5 })).rejects.toThrow(UserError)
    expect(requests).toHaveLength(0)
  })
})

describe('getDeployment', () => {
  const RAW = {
    id: 'dpl_1',
    name: 'myapp',
    url: 'myapp-abc.vercel.app',
    readyState: 'READY',
    readySubstate: 'PROMOTED',
    target: 'production',
    alias: ['myapp.example.com', 'myapp.vercel.app'],
    gitSource: { sha: '97646d1', ref: 'master' },
    meta: { githubCommitSha: '97646d1', githubCommitMessage: 'fix build', githubCommitRef: 'master' },
    creator: { username: 'mike' },
    createdAt: 1783783933976,
    buildingAt: 1783783935218,
    ready: 1783783966276,
    inspectorUrl: 'https://vercel.com/x/y',
  }

  test('resolves by id and adapts the raw response', async () => {
    stubFetch(() => jsonResponse(RAW))

    const detail = await getDeployment(CFG, 'dpl_1')

    expect(requests[0]!.pathname).toBe('/v13/deployments/dpl_1')
    expect(detail.state).toBe('ready')
    expect(detail.aliases).toEqual(['myapp.example.com', 'myapp.vercel.app'])
    expect(detail.commit).toEqual({ sha: '97646d1', message: 'fix build', ref: 'master' })
    expect(detail.timing).toEqual({
      createdAt: '2026-07-11T15:32:13.976Z',
      buildingAt: '2026-07-11T15:32:15.218Z',
      ready: '2026-07-11T15:32:46.276Z',
    })
    expect(detail.creator).toBe('mike')
  })

  test('resolves by URL: scheme and path are stripped for the API path', async () => {
    stubFetch(() => jsonResponse(RAW))
    await getDeployment(CFG, 'https://myapp-abc.vercel.app/dashboard')
    expect(requests[0]!.pathname).toBe('/v13/deployments/myapp-abc.vercel.app')
  })
})

describe('listDeploymentEvents', () => {
  test('passes limit upstream and bounds the mapped output', async () => {
    stubFetch(() =>
      jsonResponse([
        { type: 'stdout', created: 1700000000000, text: 'one' },
        { type: 'stdout', created: 1700000001000, text: 'two' },
        { type: 'stderr', created: 1700000002000, text: 'three' },
      ]),
    )

    const events = await listDeploymentEvents(CFG, 'dpl_1', 2)

    expect(requests[0]!.pathname).toBe('/v3/deployments/dpl_1/events')
    expect(requests[0]!.searchParams.get('limit')).toBe('2')
    expect(events).toEqual([
      { type: 'stdout', created: toIso(1700000000000), text: 'one' },
      { type: 'stdout', created: toIso(1700000001000), text: 'two' },
    ])
  })

  test('a non-array response yields no events rather than a crash', async () => {
    stubFetch(() => jsonResponse({ error: undefined }))
    expect(await listDeploymentEvents(CFG, 'dpl_1', 5)).toEqual([])
  })
})

describe('findDomainOwner', () => {
  test('matches a production alias across project pages', async () => {
    stubFetch((url) => {
      if (url.searchParams.get('until') === '444') {
        return jsonResponse({
          projects: [
            { id: 'prj_2', name: 'blog', targets: { production: { alias: ['Blog.example.com', 'blog.vercel.app'] } } },
          ],
          pagination: { next: null },
        })
      }
      return jsonResponse({
        projects: [{ id: 'prj_1', name: 'shop', targets: { production: { alias: ['shop.example.com'] } } }],
        pagination: { next: 444 },
      })
    })

    expect(await findDomainOwner(CFG, 'blog.example.com')).toEqual({
      projectId: 'prj_2',
      projectName: 'blog',
      ownerLookup: 'production-alias',
    })
    expect(requests).toHaveLength(2)
  })

  test('null when nothing owns the domain', async () => {
    stubFetch(() => jsonResponse({ projects: [], pagination: { next: null } }))
    expect(await findDomainOwner(CFG, 'nope.example.com')).toBeNull()
  })
})

describe('error normalization', () => {
  test('4xx adopts the Vercel error code as a stable UserError code', async () => {
    stubFetch(() => jsonResponse({ error: { code: 'not_found', message: 'Deployment not found' } }, 404))

    try {
      await getDeployment(CFG, 'dpl_missing')
      throw new Error('expected a throw')
    } catch (err) {
      expect(err).toBeInstanceOf(UserError)
      expect((err as HomeError).code).toBe('vercel_not_found')
      expect((err as Error).message).toContain('Deployment not found')
    }
  })

  test('429 becomes vercel_rate_limited and carries retry-after', async () => {
    stubFetch(() =>
      jsonResponse({ error: { code: 'too_many_requests', message: 'slow down' } }, 429, { 'retry-after': '30' }),
    )

    try {
      await listProjects(CFG, 5)
      throw new Error('expected a throw')
    } catch (err) {
      expect((err as HomeError).code).toBe('vercel_rate_limited')
      expect((err as Error).message).toContain('retry after 30s')
    }
  })

  test('a body without an error code falls back to the http status', async () => {
    stubFetch(() => new Response('nope', { status: 403 }))

    try {
      await listProjects(CFG, 5)
      throw new Error('expected a throw')
    } catch (err) {
      expect((err as HomeError).code).toBe('vercel_http_403')
    }
  })
})

describe('token redaction', () => {
  test('redactToken strips the resolved token from arbitrary text', () => {
    expect(redactToken(`Bearer ${TOKEN} rejected`)).toBe('Bearer [redacted] rejected')
    expect(redactToken('no token here')).toBe('no token here')
  })

  test('an upstream error message echoing the token never reaches the caller intact', async () => {
    stubFetch(() => jsonResponse({ error: { code: 'forbidden', message: `invalid token ${TOKEN}` } }, 403))

    try {
      await listProjects(CFG, 5)
      throw new Error('expected a throw')
    } catch (err) {
      expect((err as Error).message).not.toContain(TOKEN)
      expect((err as Error).message).toContain('[redacted]')
    }
  })
})

describe('status()', () => {
  const ENV_RESPONSE = {
    data: [
      { id: 'e1', key: 'HOME__unifi__url', type: 'encrypted' },
      { id: 'e2', key: 'DATABASE_URL', type: 'encrypted' },
    ],
  }

  test('without defaultProject: one round trip, no deployment lookup', async () => {
    stubFetch(() => jsonResponse(ENV_RESPONSE))

    const res = await manifest.status({ teamSlug: 'my-team' })

    expect(res.ok).toBe(true)
    const data = (res as { data: Record<string, unknown> }).data
    expect(data).toEqual({ team: 'my-team', homeVariables: 1 })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.pathname).toBe('/v1/env')
  })

  test('with defaultProject: exactly one extra round trip reporting production state', async () => {
    stubFetch((url) => {
      if (url.pathname === '/v6/deployments') {
        return jsonResponse({
          deployments: [
            { uid: 'dpl_9', name: 'myapp', url: 'myapp-xyz.vercel.app', readyState: 'BUILDING', target: 'production', createdAt: 1700000000000 },
          ],
          pagination: { next: null },
        })
      }
      return jsonResponse(ENV_RESPONSE)
    })

    const res = await manifest.status({ teamSlug: 'my-team', defaultProject: 'myapp' })

    expect(res.ok).toBe(true)
    const data = (res as { data: Record<string, unknown> }).data
    expect(data.production).toEqual({
      project: 'myapp',
      deploymentId: 'dpl_9',
      state: 'building',
      url: 'myapp-xyz.vercel.app',
      createdAt: toIso(1700000000000),
    })
    expect(requests).toHaveLength(2)
    const dep = requests.find((u) => u.pathname === '/v6/deployments')!
    expect(dep.searchParams.get('app')).toBe('myapp')
    expect(dep.searchParams.get('target')).toBe('production')
    expect(dep.searchParams.get('limit')).toBe('1')
  })

  test('with defaultProject but no production deployments yet', async () => {
    stubFetch((url) =>
      url.pathname === '/v6/deployments'
        ? jsonResponse({ deployments: [], pagination: { next: null } })
        : jsonResponse(ENV_RESPONSE),
    )

    const res = await manifest.status({ teamSlug: 'my-team', defaultProject: 'myapp' })

    expect(res.ok).toBe(true)
    const data = (res as { data: { production: { state: string } } }).data
    expect(data.production.state).toBe('unknown')
  })
})
