import { describe, expect, mock, test } from 'bun:test'

const EMPTY_CTX = {
  config: {},
  json: false,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {},
}

const RINGTONES = [
  { id: 'r1', name: 'Default' },
  { id: 'r2', name: 'Ding Dong' },
]

const realClient = await import('../modules/protect/client')

mock.module('../modules/protect/client', () => ({
  ...realClient,
  getBootstrap: async () => ({ ringtones: RINGTONES }),
}))

const { ringtonesList } = await import('../modules/protect/commands/ringtones')

describe('protect ringtones list', () => {
  test('returns the ringtones collection', async () => {
    const res = await ringtonesList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: unknown[] }).data).toHaveLength(2)
  })

  test('declares expected path', () => {
    expect(ringtonesList.path).toEqual(['ringtones', 'list'])
  })
})
