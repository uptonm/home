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

const GROUPS = [
  { id: 'g1', name: 'Administrators' },
  { id: 'g2', name: 'Viewers' },
]

const realClient = await import('../modules/protect/client')

mock.module('../modules/protect/client', () => ({
  ...realClient,
  getBootstrap: async () => ({ groups: GROUPS }),
}))

const { groupsGet, groupsList } = await import('../modules/protect/commands/groups')

describe('protect groups list', () => {
  test('returns the groups collection', async () => {
    const res = await groupsList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: unknown[] }).data).toHaveLength(2)
  })
})

describe('protect groups get', () => {
  test('rejects missing ref', async () => {
    expect(errCode(await groupsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('resolves by substring name', async () => {
    const res = await groupsGet.run({ ...EMPTY_CTX, args: { ref: 'Admin' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { id: string } }).data.id).toBe('g1')
  })

  test('unknown ref is not_found', async () => {
    expect(errCode(await groupsGet.run({ ...EMPTY_CTX, args: { ref: 'nope' } }))).toBe('not_found')
  })

  test('declares expected paths', () => {
    expect(groupsList.path).toEqual(['groups', 'list'])
    expect(groupsGet.path).toEqual(['groups', 'get'])
  })
})
