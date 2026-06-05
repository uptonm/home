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

const USERS = [
  { id: 'u1', name: 'Mike Upton', localUsername: 'mike' },
  { id: 'u2', name: 'Guest User', localUsername: 'guest' },
]

const realClient = await import('../modules/protect/client')

mock.module('../modules/protect/client', () => ({
  ...realClient,
  getBootstrap: async () => ({ users: USERS }),
}))

const { usersGet, usersList } = await import('../modules/protect/commands/users')

describe('protect users list', () => {
  test('returns the users collection', async () => {
    const res = await usersList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: unknown[] }).data).toHaveLength(2)
  })
})

describe('protect users get', () => {
  test('rejects missing ref', async () => {
    expect(errCode(await usersGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('resolves by id', async () => {
    const res = await usersGet.run({ ...EMPTY_CTX, args: { ref: 'u2' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { id: string } }).data.id).toBe('u2')
  })

  test('resolves by substring name', async () => {
    const res = await usersGet.run({ ...EMPTY_CTX, args: { ref: 'Mike' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { id: string } }).data.id).toBe('u1')
  })

  test('unknown ref is not_found', async () => {
    expect(errCode(await usersGet.run({ ...EMPTY_CTX, args: { ref: 'nope' } }))).toBe('not_found')
  })

  test('declares expected paths', () => {
    expect(usersList.path).toEqual(['users', 'list'])
    expect(usersGet.path).toEqual(['users', 'get'])
  })
})
