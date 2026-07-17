import { afterEach, describe, expect, mock, test } from 'bun:test'

const CTX = {
  config: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
  json: true,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {} as Record<string, string | number | boolean | undefined>,
}

let listCalls = 0
let getCalls: string[] = []

const realClient = await import('../modules/gmail/client')

mock.module('../modules/gmail/client', () => ({
  ...realClient,
  readGmailCredentials: () => ({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }),
  listLabels: async () => {
    listCalls++
    return { labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }] }
  },
  getLabel: async (_cfg: unknown, id: string) => {
    getCalls.push(id)
    return { id, name: id, messagesTotal: 3, threadsTotal: 2 }
  },
}))

const { labelsList, labelsGet } = await import('../modules/gmail/commands/labels')

afterEach(() => {
  listCalls = 0
  getCalls = []
})

describe('gmail labels list', () => {
  test('returns the label list', async () => {
    const res = await labelsList.run({ ...CTX, args: {} })
    expect(res.ok).toBe(true)
    expect(listCalls).toBe(1)
    expect((res as { data: { labels: unknown[] } }).data.labels).toHaveLength(1)
  })
})

describe('gmail labels get', () => {
  test('requires an id', async () => {
    const res = await labelsGet.run({ ...CTX, args: {} })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('missing_arg')
    expect(getCalls).toHaveLength(0)
  })

  test('fetches a label by id', async () => {
    const res = await labelsGet.run({ ...CTX, args: { id: 'UNREAD' } })
    expect(res.ok).toBe(true)
    expect(getCalls).toEqual(['UNREAD'])
  })
})
