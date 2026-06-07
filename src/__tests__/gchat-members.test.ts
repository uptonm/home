import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { MembersPage, MemberSummary } from '../modules/gchat/client'
import type { RunResult } from '../core/types'

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
  } as Parameters<typeof membersList.run>[0]
}
function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

const realClient = await import('../modules/gchat/client')

const listMembers = mock(
  async (_cfg: unknown, _space: string, _params?: unknown): Promise<MembersPage> => ({
    members: [{ name: 'spaces/AAAA/members/BBBB', member: { displayName: 'Jane' } }],
    nextPageToken: undefined,
  }),
)
const getMember = mock(
  async (_cfg: unknown, _name: string): Promise<MemberSummary> => ({
    name: 'spaces/AAAA/members/BBBB',
    role: 'ROLE_MEMBER',
    member: { name: 'users/123', displayName: 'Jane', type: 'HUMAN' },
  }),
)
// memberName stays real (spread) so the space+id combination is exercised.
mock.module('../modules/gchat/client', () => ({ ...realClient, listMembers, getMember }))

const resolveSpaceOrError = mock(
  async (_cfg: unknown, _ref: string): Promise<ResolveOk | ResolveErr> => ({
    ok: true,
    space: { name: 'spaces/AAAA', displayName: 'Engineering' },
  }),
)
mock.module('../modules/gchat/commands/resolve', () => ({ resolveSpaceOrError }))

const { membersList, memberGet } = await import('../modules/gchat/commands/members')

beforeEach(() => {
  listMembers.mockClear()
  getMember.mockClear()
  resolveSpaceOrError.mockClear()
})

describe('gchat members list', () => {
  test('requires a space', async () => {
    expect(errCode(await membersList.run(ctx({})))).toBe('missing_arg')
  })

  test('rejects a non-positive pageSize', async () => {
    expect(errCode(await membersList.run(ctx({ space: 'spaces/AAAA', pageSize: -1 })))).toBe('bad_arg')
  })

  test('resolves the space then lists members under the resolved name', async () => {
    resolveSpaceOrError.mockResolvedValueOnce({ ok: true, space: { name: 'spaces/ZZZ' } })
    const res = await membersList.run(ctx({ space: 'Eng', pageSize: 10 }))
    expect(res.ok).toBe(true)
    expect((res as { data: MembersPage }).data.members).toHaveLength(1)
    expect(listMembers.mock.calls[0]![1]).toBe('spaces/ZZZ')
    expect(listMembers.mock.calls[0]![2]).toEqual({ pageSize: 10 })
  })

  test('propagates a not_found resolution result', async () => {
    resolveSpaceOrError.mockResolvedValueOnce({
      ok: false,
      result: { ok: false, kind: 'user', message: 'no space', code: 'not_found' },
    })
    expect(errCode(await membersList.run(ctx({ space: 'nope' })))).toBe('not_found')
    expect(listMembers).not.toHaveBeenCalled()
  })
})

describe('gchat members get', () => {
  test('requires both space and member', async () => {
    expect(errCode(await memberGet.run(ctx({ space: 'spaces/AAAA' })))).toBe('missing_arg')
    expect(errCode(await memberGet.run(ctx({ member: '1234' })))).toBe('missing_arg')
  })

  test('combines a bare member id with the resolved space resource name', async () => {
    resolveSpaceOrError.mockResolvedValueOnce({ ok: true, space: { name: 'spaces/ZZZ' } })
    const res = await memberGet.run(ctx({ space: 'Eng', member: '1234' }))
    expect(res.ok).toBe(true)
    expect(getMember.mock.calls[0]![1]).toBe('spaces/ZZZ/members/1234')
  })

  test('passes a full membership resource name through unchanged', async () => {
    resolveSpaceOrError.mockResolvedValueOnce({ ok: true, space: { name: 'spaces/ZZZ' } })
    await memberGet.run(ctx({ space: 'Eng', member: 'spaces/QQQ/members/9999' }))
    expect(getMember.mock.calls[0]![1]).toBe('spaces/QQQ/members/9999')
  })
})

describe('gchat members command specs', () => {
  test('declare expected paths and required args', () => {
    expect(membersList.path).toEqual(['members', 'list'])
    expect(memberGet.path).toEqual(['members', 'get'])
    expect(memberGet.args[0]?.required).toBe(true)
    expect(memberGet.args[1]?.required).toBe(true)
  })
})
