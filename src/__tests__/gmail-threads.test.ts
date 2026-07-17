import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { MessagesListOptions, ThreadFormat } from '../modules/gmail/client'

const CTX = {
  config: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
  json: true,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {} as Record<string, string | number | boolean | undefined>,
}

let listCalls: MessagesListOptions[] = []
let getCalls: { id: string; opts: { format?: ThreadFormat } }[] = []

const realClient = await import('../modules/gmail/client')

mock.module('../modules/gmail/client', () => ({
  ...realClient,
  readGmailCredentials: () => ({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }),
  listThreads: async (_cfg: unknown, opts: MessagesListOptions = {}) => {
    listCalls.push(opts)
    return { threads: [{ id: 't1' }], nextPageToken: 'NPT' }
  },
  getThread: async (_cfg: unknown, id: string, opts: { format?: ThreadFormat } = {}) => {
    getCalls.push({ id, opts })
    return { id, messages: [] }
  },
}))

const { threadsList, threadsGet } = await import('../modules/gmail/commands/threads')

afterEach(() => {
  listCalls = []
  getCalls = []
})

describe('gmail threads list', () => {
  test('defaults maxResults and parses q/label', async () => {
    const res = await threadsList.run({ ...CTX, args: { q: 'from:x', label: 'INBOX' } })
    expect(res.ok).toBe(true)
    expect(listCalls[0]).toEqual({
      q: 'from:x',
      labelIds: ['INBOX'],
      maxResults: 25,
      pageToken: undefined,
      includeSpamTrash: false,
    })
  })

  test('rejects a bad max', async () => {
    const res = await threadsList.run({ ...CTX, args: { max: -1 } })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('bad_arg')
    expect(listCalls).toHaveLength(0)
  })
})

describe('gmail threads get', () => {
  test('requires an id', async () => {
    const res = await threadsGet.run({ ...CTX, args: {} })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('missing_arg')
    expect(getCalls).toHaveLength(0)
  })

  test('passes a valid format through', async () => {
    const res = await threadsGet.run({ ...CTX, args: { id: 't1', format: 'metadata' } })
    expect(res.ok).toBe(true)
    expect(getCalls[0]).toEqual({ id: 't1', opts: { format: 'metadata' } })
  })

  test('rejects the message-only "raw" format (threads have no raw projection)', async () => {
    const res = await threadsGet.run({ ...CTX, args: { id: 't1', format: 'raw' } })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('bad_arg')
    expect(getCalls).toHaveLength(0)
  })
})
