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

const CHIMES = [
  { id: 'c1', name: 'Kitchen Chime', volume: 100 },
  { id: 'c2', name: 'Hallway Chime', volume: 50 },
]

const realClient = await import('../modules/protect/client')

mock.module('../modules/protect/client', () => ({
  ...realClient,
  getBootstrap: async () => ({ chimes: CHIMES }),
}))

const { chimesGet, chimesList } = await import('../modules/protect/commands/chimes')

describe('protect chimes list', () => {
  test('returns the chimes collection', async () => {
    const res = await chimesList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: unknown[] }).data).toHaveLength(2)
  })
})

describe('protect chimes get', () => {
  test('rejects missing ref', async () => {
    expect(errCode(await chimesGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('resolves by substring name', async () => {
    const res = await chimesGet.run({ ...EMPTY_CTX, args: { ref: 'Kitchen' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { id: string } }).data.id).toBe('c1')
  })

  test('unknown ref is not_found', async () => {
    expect(errCode(await chimesGet.run({ ...EMPTY_CTX, args: { ref: 'nope' } }))).toBe('not_found')
  })

  test('declares expected paths', () => {
    expect(chimesList.path).toEqual(['chimes', 'list'])
    expect(chimesGet.path).toEqual(['chimes', 'get'])
  })
})
