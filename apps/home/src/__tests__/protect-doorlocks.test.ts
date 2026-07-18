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

const DOORLOCKS = [
  { id: 'l1', name: 'Front Lock', lockState: 'locked' },
  { id: 'l2', name: 'Side Lock', lockState: 'unlocked' },
]

const realClient = await import('../modules/protect/client')

mock.module('../modules/protect/client', () => ({
  ...realClient,
  getBootstrap: async () => ({ doorlocks: DOORLOCKS }),
}))

const { doorlocksGet, doorlocksList } = await import('../modules/protect/commands/doorlocks')

describe('protect doorlocks list', () => {
  test('returns the doorlocks collection', async () => {
    const res = await doorlocksList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: unknown[] }).data).toHaveLength(2)
  })
})

describe('protect doorlocks get', () => {
  test('rejects missing ref', async () => {
    expect(errCode(await doorlocksGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('resolves by substring name', async () => {
    const res = await doorlocksGet.run({ ...EMPTY_CTX, args: { ref: 'Side' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { id: string } }).data.id).toBe('l2')
  })

  test('unknown ref is not_found', async () => {
    expect(errCode(await doorlocksGet.run({ ...EMPTY_CTX, args: { ref: 'nope' } }))).toBe('not_found')
  })

  test('declares expected paths', () => {
    expect(doorlocksList.path).toEqual(['doorlocks', 'list'])
    expect(doorlocksGet.path).toEqual(['doorlocks', 'get'])
  })
})
