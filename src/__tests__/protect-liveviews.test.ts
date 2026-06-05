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

const LIVEVIEWS = [
  { id: 'lv1', name: 'All Cameras' },
  { id: 'lv2', name: 'Front of House' },
]

const realClient = await import('../modules/protect/client')

mock.module('../modules/protect/client', () => ({
  ...realClient,
  getBootstrap: async () => ({ liveviews: LIVEVIEWS }),
}))

const { liveviewsGet, liveviewsList } = await import('../modules/protect/commands/liveviews')

describe('protect liveviews list', () => {
  test('returns the liveviews collection', async () => {
    const res = await liveviewsList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: unknown[] }).data).toHaveLength(2)
  })
})

describe('protect liveviews get', () => {
  test('rejects missing ref', async () => {
    expect(errCode(await liveviewsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('resolves by substring name', async () => {
    const res = await liveviewsGet.run({ ...EMPTY_CTX, args: { ref: 'Front' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { id: string } }).data.id).toBe('lv2')
  })

  test('unknown ref is not_found', async () => {
    expect(errCode(await liveviewsGet.run({ ...EMPTY_CTX, args: { ref: 'nope' } }))).toBe('not_found')
  })

  test('declares expected paths', () => {
    expect(liveviewsList.path).toEqual(['liveviews', 'list'])
    expect(liveviewsGet.path).toEqual(['liveviews', 'get'])
  })
})
