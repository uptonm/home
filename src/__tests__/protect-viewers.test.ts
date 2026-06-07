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

const VIEWERS = [
  { id: 'v1', name: 'Office Display', liveview: 'lv1' },
  { id: 'v2', name: 'Lobby Display', liveview: 'lv2' },
]

const realClient = await import('../modules/protect/client')

mock.module('../modules/protect/client', () => ({
  ...realClient,
  getBootstrap: async () => ({ viewers: VIEWERS }),
}))

const { viewersGet, viewersList } = await import('../modules/protect/commands/viewers')

describe('protect viewers list', () => {
  test('returns the viewers collection', async () => {
    const res = await viewersList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: unknown[] }).data).toHaveLength(2)
  })
})

describe('protect viewers get', () => {
  test('rejects missing ref', async () => {
    expect(errCode(await viewersGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('resolves by id', async () => {
    const res = await viewersGet.run({ ...EMPTY_CTX, args: { ref: 'v2' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { id: string } }).data.id).toBe('v2')
  })

  test('unknown ref is not_found', async () => {
    expect(errCode(await viewersGet.run({ ...EMPTY_CTX, args: { ref: 'nope' } }))).toBe('not_found')
  })

  test('declares expected paths', () => {
    expect(viewersList.path).toEqual(['viewers', 'list'])
    expect(viewersGet.path).toEqual(['viewers', 'get'])
  })
})
