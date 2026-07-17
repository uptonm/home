import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { MessagesListOptions, MessageGetOptions } from '../modules/gmail/client'

const CTX = {
  config: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
  json: true,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {} as Record<string, string | number | boolean | undefined>,
}

let listCalls: MessagesListOptions[] = []
let hydrateCalls: MessagesListOptions[] = []
let getCalls: { id: string; opts: MessageGetOptions }[] = []

const realClient = await import('../modules/gmail/client')

mock.module('../modules/gmail/client', () => ({
  ...realClient,
  readGmailCredentials: () => ({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }),
  listMessages: async (_cfg: unknown, opts: MessagesListOptions = {}) => {
    listCalls.push(opts)
    return { messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'NPT', resultSizeEstimate: 1 }
  },
  listMessagesHydrated: async (_cfg: unknown, opts: MessagesListOptions = {}) => {
    hydrateCalls.push(opts)
    return { messages: [{ id: 'm1', threadId: 't1', subject: 'Hi' }], nextPageToken: 'NPT', resultSizeEstimate: 1 }
  },
  getMessage: async (_cfg: unknown, id: string, opts: MessageGetOptions = {}) => {
    getCalls.push({ id, opts })
    return { id, threadId: 't1' }
  },
}))

const { messagesList, messagesGet } = await import('../modules/gmail/commands/messages')

afterEach(() => {
  listCalls = []
  hydrateCalls = []
  getCalls = []
})

describe('gmail messages list', () => {
  test('defaults to maxResults 25 and the plain (non-hydrated) listing', async () => {
    const res = await messagesList.run({ ...CTX, args: {} })
    expect(res.ok).toBe(true)
    expect(hydrateCalls).toHaveLength(0)
    expect(listCalls).toHaveLength(1)
    expect(listCalls[0]).toEqual({
      q: undefined,
      labelIds: undefined,
      maxResults: 25,
      pageToken: undefined,
      includeSpamTrash: false,
    })
  })

  test('parses q, label (csv), max, page-token, include-spam-trash', async () => {
    const res = await messagesList.run({
      ...CTX,
      args: { q: 'is:unread', label: 'INBOX, UNREAD', max: 10, 'page-token': 'P', 'include-spam-trash': true },
    })
    expect(res.ok).toBe(true)
    expect(listCalls[0]).toEqual({
      q: 'is:unread',
      labelIds: ['INBOX', 'UNREAD'],
      maxResults: 10,
      pageToken: 'P',
      includeSpamTrash: true,
    })
  })

  test('--hydrate routes to listMessagesHydrated', async () => {
    const res = await messagesList.run({ ...CTX, args: { q: 'is:unread', hydrate: true } })
    expect(res.ok).toBe(true)
    expect(listCalls).toHaveLength(0)
    expect(hydrateCalls).toHaveLength(1)
    expect(hydrateCalls[0]?.q).toBe('is:unread')
  })

  test('caps max at 500', async () => {
    await messagesList.run({ ...CTX, args: { max: 99999 } })
    expect(listCalls[0]?.maxResults).toBe(500)
  })

  test('rejects a non-positive max', async () => {
    const res = await messagesList.run({ ...CTX, args: { max: 0 } })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('bad_arg')
    expect(listCalls).toHaveLength(0)
  })
})

describe('gmail messages get', () => {
  test('requires an id', async () => {
    const res = await messagesGet.run({ ...CTX, args: {} })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('missing_arg')
    expect(getCalls).toHaveLength(0)
  })

  test('passes a valid format through', async () => {
    const res = await messagesGet.run({ ...CTX, args: { id: 'm1', format: 'metadata' } })
    expect(res.ok).toBe(true)
    expect(getCalls[0]).toEqual({ id: 'm1', opts: { format: 'metadata' } })
  })

  test('rejects an invalid format', async () => {
    const res = await messagesGet.run({ ...CTX, args: { id: 'm1', format: 'bogus' } })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('bad_arg')
    expect(getCalls).toHaveLength(0)
  })
})
