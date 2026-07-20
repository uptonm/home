import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { BatchModifyOptions, CreateLabelOptions, GmailFilter, MessagesListOptions } from '../modules/gmail/client'

const CTX = {
  config: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
  json: true,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {} as Record<string, string | number | boolean | undefined>,
}

let batchCalls: BatchModifyOptions[] = []
let trashCalls: string[][] = []
let labelCalls: CreateLabelOptions[] = []
let filterCreates: GmailFilter[] = []
let filterDeletes: string[] = []
let listPages: MessagesListOptions[] = []

const realClient = await import('../modules/gmail/client')

mock.module('../modules/gmail/client', () => ({
  ...realClient,
  readGmailCredentials: () => ({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }),
  listMessages: async (_cfg: unknown, opts: MessagesListOptions = {}) => {
    listPages.push(opts)
    // Two pages of ids for a query, so pagination is exercised.
    if (!opts.pageToken) return { messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'P2' }
    return { messages: [{ id: 'm3' }] }
  },
  listMessagesHydrated: async (_cfg: unknown, _opts: MessagesListOptions = {}) => ({
    messages: [{ id: 'm1', from: 'a@x.com', subject: 'One' }],
  }),
  batchModifyMessages: async (_cfg: unknown, opts: BatchModifyOptions) => {
    batchCalls.push(opts)
    return opts.ids.length
  },
  trashMessages: async (_cfg: unknown, ids: string[]) => {
    trashCalls.push(ids)
    return ids.length
  },
  createLabel: async (_cfg: unknown, opts: CreateLabelOptions) => {
    labelCalls.push(opts)
    return { id: 'Label_new', name: opts.name, type: 'user' }
  },
  listFilters: async () => ({ filter: [{ id: 'f1', criteria: { from: 'x@y.com' }, action: {} }] }),
  createFilter: async (_cfg: unknown, f: GmailFilter) => {
    filterCreates.push(f)
    return { id: 'f_new', ...f }
  },
  deleteFilter: async (_cfg: unknown, id: string) => {
    filterDeletes.push(id)
  },
}))

const { messagesModify } = await import('../modules/gmail/commands/messages')
const { labelsCreate } = await import('../modules/gmail/commands/labels')
const { filtersList, filtersCreate, filtersDelete } = await import('../modules/gmail/commands/filters')

afterEach(() => {
  batchCalls = []
  trashCalls = []
  labelCalls = []
  filterCreates = []
  filterDeletes = []
  listPages = []
})

describe('gmail messages modify', () => {
  test('invalid plan is a user error, nothing mutated', async () => {
    const res = await messagesModify.run({ ...CTX, args: { archive: true } })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('bad_arg')
    expect(batchCalls).toHaveLength(0)
  })

  test('dry-run: paginates the query, previews count + sample, mutates nothing', async () => {
    const res = await messagesModify.run({ ...CTX, args: { q: 'from:github.com', archive: true } })
    expect(res.ok).toBe(true)
    const data = (res as { data: Record<string, unknown> }).data
    expect(data.dryRun).toBe(true)
    expect(data.matched).toBe(3) // m1,m2 (page1) + m3 (page2)
    expect(data.removeLabelIds).toEqual(['INBOX'])
    expect(batchCalls).toHaveLength(0)
    expect(trashCalls).toHaveLength(0)
  })

  test('--yes archive: batchModify removes INBOX over the resolved ids', async () => {
    const res = await messagesModify.run({ ...CTX, args: { q: 'from:github.com', archive: true, yes: true } })
    expect(res.ok).toBe(true)
    expect(batchCalls).toHaveLength(1)
    expect(batchCalls[0]!.ids).toEqual(['m1', 'm2', 'm3'])
    expect(batchCalls[0]!.removeLabelIds).toEqual(['INBOX'])
    expect((res as { data: { affected: number } }).data.affected).toBe(3)
  })

  test('--yes --trash routes to trashMessages, not batchModify', async () => {
    const res = await messagesModify.run({ ...CTX, args: { ids: 'a,b', trash: true, yes: true } })
    expect(res.ok).toBe(true)
    expect(batchCalls).toHaveLength(0)
    expect(trashCalls).toEqual([['a', 'b']])
  })

  test('ids-mode dry-run does not paginate and mutates nothing', async () => {
    const res = await messagesModify.run({ ...CTX, args: { ids: 'a,b,c', 'mark-read': true } })
    expect(res.ok).toBe(true)
    const data = (res as { data: Record<string, unknown> }).data
    expect(data.dryRun).toBe(true)
    expect(data.matched).toBe(3)
    expect(listPages).toHaveLength(0) // ids given → no list calls
    expect(batchCalls).toHaveLength(0)
  })
})

describe('gmail labels create', () => {
  test('requires --name', async () => {
    const res = await labelsCreate.run({ ...CTX, args: {} })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('missing_arg')
    expect(labelCalls).toHaveLength(0)
  })

  test('creates the label and returns its id', async () => {
    const res = await labelsCreate.run({ ...CTX, args: { name: 'Newsletters' } })
    expect(res.ok).toBe(true)
    expect(labelCalls).toEqual([{ name: 'Newsletters' }])
    expect((res as { data: { id: string } }).data.id).toBe('Label_new')
  })
})

describe('gmail filters', () => {
  test('list returns the filter array', async () => {
    const res = await filtersList.run({ ...CTX, args: {} })
    expect(res.ok).toBe(true)
    expect((res as { data: { filter: unknown[] } }).data.filter).toHaveLength(1)
  })

  test('create dry-run previews without creating', async () => {
    const res = await filtersCreate.run({ ...CTX, args: { from: 'news@shop.com', archive: true } })
    expect(res.ok).toBe(true)
    expect((res as { data: { dryRun: boolean } }).data.dryRun).toBe(true)
    expect(filterCreates).toHaveLength(0)
  })

  test('create --yes posts the filter', async () => {
    const res = await filtersCreate.run({ ...CTX, args: { from: 'news@shop.com', add: 'Label_3', archive: true, yes: true } })
    expect(res.ok).toBe(true)
    expect(filterCreates).toHaveLength(1)
    expect(filterCreates[0]!.criteria).toEqual({ from: 'news@shop.com' })
    expect(filterCreates[0]!.action.removeLabelIds).toEqual(['INBOX'])
  })

  test('create with no criterion is a user error', async () => {
    const res = await filtersCreate.run({ ...CTX, args: { add: 'Label_3', yes: true } })
    expect(res.ok).toBe(false)
    expect(filterCreates).toHaveLength(0)
  })

  test('delete requires an id', async () => {
    const res = await filtersDelete.run({ ...CTX, args: {} })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('missing_arg')
  })

  test('delete without --yes does not delete', async () => {
    const res = await filtersDelete.run({ ...CTX, args: { id: 'f1' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { dryRun: boolean } }).data.dryRun).toBe(true)
    expect(filterDeletes).toHaveLength(0)
  })

  test('delete --yes removes the filter', async () => {
    const res = await filtersDelete.run({ ...CTX, args: { id: 'f1', yes: true } })
    expect(res.ok).toBe(true)
    expect(filterDeletes).toEqual(['f1'])
  })
})
