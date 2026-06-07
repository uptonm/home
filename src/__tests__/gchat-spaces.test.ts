import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { SpacesPage, SpaceSummary } from '../modules/gchat/client'
import type { RunResult } from '../core/types'

// Command-layer tests. The client *data* functions are mocked, and the thin
// `resolveSpaceOrError` wrapper (commands/resolve) is mocked so resolution
// outcomes are driven directly. We never mock `client.resolveSpace` itself —
// module mocks are process-global in this setup, so it stays real for
// gchat-client.test.ts which unit-tests it.

type ResolveOk = { ok: true; space: { name: string; displayName?: string } }
type ResolveErr = { ok: false; result: RunResult }

const log = null as unknown as ReturnType<typeof import('consola').createConsola>
function ctx(args: Record<string, unknown> = {}) {
  return {
    config: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
    json: false,
    quiet: true,
    verbose: false,
    log,
    args,
  } as Parameters<typeof spacesList.run>[0]
}
function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

const realClient = await import('../modules/gchat/client')

const listSpaces = mock(
  async (_cfg: unknown, _params?: unknown): Promise<SpacesPage> => ({
    spaces: [{ name: 'spaces/AAAA', displayName: 'Engineering' }],
    nextPageToken: 'n1',
  }),
)
const getSpace = mock(
  async (_cfg: unknown, _name: string): Promise<SpaceSummary> => ({
    name: 'spaces/AAAA',
    displayName: 'Engineering',
    spaceType: 'SPACE',
  }),
)
mock.module('../modules/gchat/client', () => ({ ...realClient, listSpaces, getSpace }))

const resolveSpaceOrError = mock(
  async (_cfg: unknown, _ref: string): Promise<ResolveOk | ResolveErr> => ({
    ok: true,
    space: { name: 'spaces/AAAA', displayName: 'Engineering' },
  }),
)
mock.module('../modules/gchat/commands/resolve', () => ({ resolveSpaceOrError }))

const { spacesList, spaceGet } = await import('../modules/gchat/commands/spaces')

beforeEach(() => {
  listSpaces.mockClear()
  getSpace.mockClear()
  resolveSpaceOrError.mockClear()
})

describe('gchat spaces list', () => {
  test('returns the page and forwards parsed paging params (pageSize clamped)', async () => {
    const res = await spacesList.run(ctx({ pageSize: 5000, pageToken: 't', filter: 'spaceType = "SPACE"' }))
    expect(res.ok).toBe(true)
    expect((res as { data: SpacesPage }).data.nextPageToken).toBe('n1')
    expect(listSpaces).toHaveBeenCalledTimes(1)
    expect(listSpaces.mock.calls[0]![1]).toEqual({ pageSize: 1000, pageToken: 't', filter: 'spaceType = "SPACE"' })
  })

  test('rejects a non-positive pageSize before calling the API', async () => {
    expect(errCode(await spacesList.run(ctx({ pageSize: 0 })))).toBe('bad_arg')
    expect(listSpaces).not.toHaveBeenCalled()
  })
})

describe('gchat spaces get', () => {
  test('requires a space', async () => {
    expect(errCode(await spaceGet.run(ctx({})))).toBe('missing_arg')
  })

  test('propagates a not_found resolution result', async () => {
    resolveSpaceOrError.mockResolvedValueOnce({
      ok: false,
      result: { ok: false, kind: 'user', message: 'no space matching "nope"', code: 'not_found' },
    })
    expect(errCode(await spaceGet.run(ctx({ space: 'nope' })))).toBe('not_found')
    expect(getSpace).not.toHaveBeenCalled()
  })

  test('propagates an ambiguous resolution result', async () => {
    resolveSpaceOrError.mockResolvedValueOnce({
      ok: false,
      result: { ok: false, kind: 'user', message: 'ambiguous', code: 'ambiguous' },
    })
    expect(errCode(await spaceGet.run(ctx({ space: 'eng' })))).toBe('ambiguous')
  })

  test('resolves the reference then fetches by the resolved resource name', async () => {
    resolveSpaceOrError.mockResolvedValueOnce({ ok: true, space: { name: 'spaces/ZZZ', displayName: 'Z' } })
    const res = await spaceGet.run(ctx({ space: 'Z' }))
    expect(res.ok).toBe(true)
    expect(resolveSpaceOrError.mock.calls[0]![1]).toBe('Z')
    expect(getSpace.mock.calls[0]![1]).toBe('spaces/ZZZ')
  })
})

describe('gchat spaces command specs', () => {
  test('declare expected paths and required args', () => {
    expect(spacesList.path).toEqual(['spaces', 'list'])
    expect(spaceGet.path).toEqual(['spaces', 'get'])
    expect(spaceGet.args[0]?.required).toBe(true)
  })
})
