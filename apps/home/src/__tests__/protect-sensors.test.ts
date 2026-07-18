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

const SENSORS = [
  { id: 's1', name: 'Front Door', type: 'doorbell', batteryStatus: { percentage: 90 } },
  { id: 's2', name: 'Garage Leak', type: 'leak' },
  { id: 's3', name: 'Garage Motion', type: 'motion' },
]

const realClient = await import('../modules/protect/client')

mock.module('../modules/protect/client', () => ({
  ...realClient,
  getBootstrap: async () => ({ sensors: SENSORS }),
}))

const { sensorsGet, sensorsList } = await import('../modules/protect/commands/sensors')

describe('protect sensors list', () => {
  test('returns the sensors collection', async () => {
    const res = await sensorsList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: unknown[] }).data).toHaveLength(3)
  })
})

describe('protect sensors get', () => {
  test('rejects missing ref', async () => {
    expect(errCode(await sensorsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('resolves by id', async () => {
    const res = await sensorsGet.run({ ...EMPTY_CTX, args: { ref: 's2' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { id: string } }).data.id).toBe('s2')
  })

  test('resolves by exact name', async () => {
    const res = await sensorsGet.run({ ...EMPTY_CTX, args: { ref: 'Front Door' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { id: string } }).data.id).toBe('s1')
  })

  test('ambiguous substring is reported', async () => {
    expect(errCode(await sensorsGet.run({ ...EMPTY_CTX, args: { ref: 'Garage' } }))).toBe('ambiguous')
  })

  test('unknown ref is not_found', async () => {
    expect(errCode(await sensorsGet.run({ ...EMPTY_CTX, args: { ref: 'nope' } }))).toBe('not_found')
  })
})

describe('protect sensors command specs', () => {
  test('declare expected paths', () => {
    expect(sensorsList.path).toEqual(['sensors', 'list'])
    expect(sensorsGet.path).toEqual(['sensors', 'get'])
    expect(sensorsGet.args[0]?.required).toBe(true)
  })
})
