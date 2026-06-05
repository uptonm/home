import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { DraftsListOptions, MessageFormat } from '../modules/gmail/client'

const CTX = {
  config: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
  json: true,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {} as Record<string, string | number | boolean | undefined>,
}

let listCalls: DraftsListOptions[] = []
let getCalls: { id: string; opts: { format?: MessageFormat } }[] = []

const realClient = await import('../modules/gmail/client')

mock.module('../modules/gmail/client', () => ({
  ...realClient,
  listDrafts: async (_cfg: unknown, opts: DraftsListOptions = {}) => {
    listCalls.push(opts)
    return { drafts: [{ id: 'd1', message: { id: 'm1', threadId: 't1' } }], resultSizeEstimate: 1 }
  },
  getDraft: async (_cfg: unknown, id: string, opts: { format?: MessageFormat } = {}) => {
    getCalls.push({ id, opts })
    return { id, message: { id: 'm1' } }
  },
}))

const { draftsList, draftsGet } = await import('../modules/gmail/commands/drafts')

afterEach(() => {
  listCalls = []
  getCalls = []
})

describe('gmail drafts list', () => {
  test('defaults maxResults and parses q', async () => {
    const res = await draftsList.run({ ...CTX, args: { q: 'subject:wip' } })
    expect(res.ok).toBe(true)
    expect(listCalls[0]).toEqual({
      q: 'subject:wip',
      maxResults: 25,
      pageToken: undefined,
      includeSpamTrash: false,
    })
  })

  test('rejects a bad max', async () => {
    const res = await draftsList.run({ ...CTX, args: { max: 'nope' } })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('bad_arg')
    expect(listCalls).toHaveLength(0)
  })
})

describe('gmail drafts get', () => {
  test('requires an id', async () => {
    const res = await draftsGet.run({ ...CTX, args: {} })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('missing_arg')
    expect(getCalls).toHaveLength(0)
  })

  test('passes a valid format through', async () => {
    const res = await draftsGet.run({ ...CTX, args: { id: 'd1', format: 'metadata' } })
    expect(res.ok).toBe(true)
    expect(getCalls[0]).toEqual({ id: 'd1', opts: { format: 'metadata' } })
  })

  test('rejects an invalid format', async () => {
    const res = await draftsGet.run({ ...CTX, args: { id: 'd1', format: 'weird' } })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('bad_arg')
    expect(getCalls).toHaveLength(0)
  })
})
