import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { MessagesPage, MessageSummary } from '../modules/gchat/client'
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
  } as Parameters<typeof messagesList.run>[0]
}
function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

const realClient = await import('../modules/gchat/client')

const listMessages = mock(
  async (_cfg: unknown, _space: string, _params?: unknown): Promise<MessagesPage> => ({
    messages: [{ name: 'spaces/AAAA/messages/CCCC.CCCC', text: 'hello', sender: {} }],
    nextPageToken: 'n2',
  }),
)
const getMessage = mock(
  async (_cfg: unknown, _name: string): Promise<MessageSummary> => ({
    name: 'spaces/AAAA/messages/CCCC.CCCC',
    text: 'hello',
    sender: { name: 'users/123', displayName: 'Jane' },
  }),
)
// messageName stays real (spread) so the space+id combination is exercised.
mock.module('../modules/gchat/client', () => ({ ...realClient, listMessages, getMessage }))

const resolveSpaceOrError = mock(
  async (_cfg: unknown, _ref: string): Promise<ResolveOk | ResolveErr> => ({
    ok: true,
    space: { name: 'spaces/AAAA', displayName: 'Engineering' },
  }),
)
mock.module('../modules/gchat/commands/resolve', () => ({ resolveSpaceOrError }))

const { messagesList, messageGet } = await import('../modules/gchat/commands/messages')

beforeEach(() => {
  listMessages.mockClear()
  getMessage.mockClear()
  resolveSpaceOrError.mockClear()
})

describe('gchat messages list', () => {
  test('requires a space', async () => {
    expect(errCode(await messagesList.run(ctx({})))).toBe('missing_arg')
  })

  test('forwards orderBy alongside paging params under the resolved space', async () => {
    resolveSpaceOrError.mockResolvedValueOnce({ ok: true, space: { name: 'spaces/ZZZ' } })
    const res = await messagesList.run(ctx({ space: 'Eng', pageSize: 20, orderBy: 'createTime desc' }))
    expect(res.ok).toBe(true)
    expect((res as { data: MessagesPage }).data.nextPageToken).toBe('n2')
    expect(listMessages.mock.calls[0]![1]).toBe('spaces/ZZZ')
    expect(listMessages.mock.calls[0]![2]).toEqual({ pageSize: 20, orderBy: 'createTime desc' })
  })

  test('rejects a non-positive pageSize', async () => {
    expect(errCode(await messagesList.run(ctx({ space: 'spaces/AAAA', pageSize: 0 })))).toBe('bad_arg')
  })

  test('propagates a not_found resolution result', async () => {
    resolveSpaceOrError.mockResolvedValueOnce({
      ok: false,
      result: { ok: false, kind: 'user', message: 'no space', code: 'not_found' },
    })
    expect(errCode(await messagesList.run(ctx({ space: 'nope' })))).toBe('not_found')
    expect(listMessages).not.toHaveBeenCalled()
  })
})

describe('gchat messages get', () => {
  test('requires both space and message', async () => {
    expect(errCode(await messageGet.run(ctx({ space: 'spaces/AAAA' })))).toBe('missing_arg')
    expect(errCode(await messageGet.run(ctx({ message: 'CCCC.CCCC' })))).toBe('missing_arg')
  })

  test('combines a bare message id with the resolved space resource name', async () => {
    resolveSpaceOrError.mockResolvedValueOnce({ ok: true, space: { name: 'spaces/ZZZ' } })
    const res = await messageGet.run(ctx({ space: 'Eng', message: 'CCCC.CCCC' }))
    expect(res.ok).toBe(true)
    expect(getMessage.mock.calls[0]![1]).toBe('spaces/ZZZ/messages/CCCC.CCCC')
  })

  test('passes a full message resource name through unchanged', async () => {
    resolveSpaceOrError.mockResolvedValueOnce({ ok: true, space: { name: 'spaces/ZZZ' } })
    await messageGet.run(ctx({ space: 'Eng', message: 'spaces/QQQ/messages/DD.DD' }))
    expect(getMessage.mock.calls[0]![1]).toBe('spaces/QQQ/messages/DD.DD')
  })
})

describe('gchat messages command specs', () => {
  test('declare expected paths, required args, and an orderBy flag on list', () => {
    expect(messagesList.path).toEqual(['messages', 'list'])
    expect(messageGet.path).toEqual(['messages', 'get'])
    expect(messageGet.args[0]?.required).toBe(true)
    expect(messageGet.args[1]?.required).toBe(true)
    expect(messagesList.args.some((a) => a.name === 'orderBy')).toBe(true)
  })
})
