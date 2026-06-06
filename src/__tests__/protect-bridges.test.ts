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

const BRIDGES = [
  { id: 'b1', name: 'Bridge One' },
  { id: 'b2', name: 'Bridge Two' },
]

const realClient = await import('../modules/protect/client')

mock.module('../modules/protect/client', () => ({
  ...realClient,
  getBootstrap: async () => ({ bridges: BRIDGES }),
}))

const { bridgesGet, bridgesList } = await import('../modules/protect/commands/bridges')

describe('protect bridges list', () => {
  test('returns the bridges collection', async () => {
    const res = await bridgesList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: unknown[] }).data).toHaveLength(2)
  })
})

describe('protect bridges get', () => {
  test('rejects missing ref', async () => {
    expect(errCode(await bridgesGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('resolves by id', async () => {
    const res = await bridgesGet.run({ ...EMPTY_CTX, args: { ref: 'b1' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { id: string } }).data.id).toBe('b1')
  })

  test('unknown ref is not_found', async () => {
    expect(errCode(await bridgesGet.run({ ...EMPTY_CTX, args: { ref: 'nope' } }))).toBe('not_found')
  })

  test('declares expected paths', () => {
    expect(bridgesList.path).toEqual(['bridges', 'list'])
    expect(bridgesGet.path).toEqual(['bridges', 'get'])
  })
})
