import { describe, expect, mock, test } from 'bun:test'

const EMPTY_CTX = {
  config: {},
  json: false,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {},
}

function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

const SAMPLE_VOUCHERS = [
  { id: 'v1', code: '1234-5678', name: 'Guest day pass' },
  { id: 'v2', code: '8765-4321', name: 'Conference' },
]

// Captured in an object so control-flow narrowing resets across the awaited run().
const calls: { createOpts: Record<string, unknown> | null; deletedId: string | null } = {
  createOpts: null,
  deletedId: null,
}

const realIntegration = await import('../modules/unifi/integration-client')

mock.module('../modules/unifi/integration-client', () => ({
  ...realIntegration,
  integrationListVouchers: async () => SAMPLE_VOUCHERS,
  integrationGetVoucher: async (_cfg: unknown, id: string) =>
    SAMPLE_VOUCHERS.find((v) => v.id === id) ?? null,
  integrationCreateVouchers: async (_cfg: unknown, opts: Record<string, unknown>) => {
    calls.createOpts = opts
    return { created: opts }
  },
  integrationDeleteVoucher: async (_cfg: unknown, id: string) => {
    calls.deletedId = id
    return null
  },
}))

const { vouchersCreate, vouchersDelete, vouchersGet, vouchersList } = await import(
  '../modules/unifi/commands/vouchers'
)

describe('unifi vouchers list', () => {
  test('path is vouchers list with no args', () => {
    expect(vouchersList.path).toEqual(['vouchers', 'list'])
    expect(vouchersList.args).toEqual([])
  })

  test('returns the paginated vouchers', async () => {
    const res = await vouchersList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: unknown[] }).data).toHaveLength(2)
  })
})

describe('unifi vouchers get', () => {
  test('path is vouchers get with required id positional', () => {
    expect(vouchersGet.path).toEqual(['vouchers', 'get'])
    const id = vouchersGet.args.find((a) => a.name === 'id')
    expect(id?.kind).toBe('positional')
    expect(id?.required).toBe(true)
  })

  test('rejects missing id', async () => {
    expect(errCode(await vouchersGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('not_found for unknown id', async () => {
    expect(errCode(await vouchersGet.run({ ...EMPTY_CTX, args: { id: 'nope' } }))).toBe('not_found')
  })

  test('returns the matching voucher', async () => {
    const res = await vouchersGet.run({ ...EMPTY_CTX, args: { id: 'v2' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { id: string } }).data.id).toBe('v2')
  })
})

describe('unifi vouchers create', () => {
  test('path, --yes boolean and numeric args', () => {
    expect(vouchersCreate.path).toEqual(['vouchers', 'create'])
    expect(vouchersCreate.args.find((a) => a.name === 'yes')?.kind).toBe('boolean')
    expect(vouchersCreate.args.find((a) => a.name === 'count')?.kind).toBe('number')
    expect(vouchersCreate.args.find((a) => a.name === 'minutes')?.kind).toBe('number')
  })

  test('rejects invalid count / minutes / quota before confirming', async () => {
    expect(errCode(await vouchersCreate.run({ ...EMPTY_CTX, args: { count: 0, yes: true } }))).toBe('invalid_arg')
    expect(errCode(await vouchersCreate.run({ ...EMPTY_CTX, args: { count: 1.5, yes: true } }))).toBe('invalid_arg')
    expect(errCode(await vouchersCreate.run({ ...EMPTY_CTX, args: { minutes: 0, yes: true } }))).toBe('invalid_arg')
    expect(errCode(await vouchersCreate.run({ ...EMPTY_CTX, args: { quota: -1, yes: true } }))).toBe('invalid_arg')
  })

  test('refuses to create without --yes', async () => {
    calls.createOpts = null
    const res = await vouchersCreate.run({ ...EMPTY_CTX, args: { count: 5, minutes: 60 } })
    expect(errCode(res)).toBe('confirmation_required')
    expect(calls.createOpts).toBeNull()
  })

  test('creates with --yes and maps flags to the API body', async () => {
    calls.createOpts = null
    const res = await vouchersCreate.run({
      ...EMPTY_CTX,
      args: { count: 3, minutes: 90, name: 'Lobby', quota: 2, yes: true },
    })
    expect(res.ok).toBe(true)
    expect(calls.createOpts as Record<string, unknown> | null).toEqual({
      count: 3,
      timeLimitMinutes: 90,
      name: 'Lobby',
      authorizedGuestLimit: 2,
    })
  })
})

describe('unifi vouchers delete', () => {
  test('path with required id and --yes flag', () => {
    expect(vouchersDelete.path).toEqual(['vouchers', 'delete'])
    expect(vouchersDelete.args.find((a) => a.name === 'id')?.required).toBe(true)
    expect(vouchersDelete.args.find((a) => a.name === 'yes')?.kind).toBe('boolean')
  })

  test('rejects missing id', async () => {
    expect(errCode(await vouchersDelete.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('refuses to delete without --yes', async () => {
    calls.deletedId = null
    const res = await vouchersDelete.run({ ...EMPTY_CTX, args: { id: 'v1' } })
    expect(errCode(res)).toBe('confirmation_required')
    expect(calls.deletedId).toBeNull()
  })

  test('deletes with --yes', async () => {
    calls.deletedId = null
    const res = await vouchersDelete.run({ ...EMPTY_CTX, args: { id: 'v1', yes: true } })
    expect(res.ok).toBe(true)
    expect(calls.deletedId as string | null).toBe('v1')
  })
})
