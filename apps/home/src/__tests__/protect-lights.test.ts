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

const LIGHTS = [
  { id: 'li1', name: 'Front Light', isLightOn: false },
  { id: 'li2', name: 'Garage Light', isLightOn: true },
]

const patches: Array<{ type: string; id: string; body: Record<string, unknown> }> = []
const lastPatch = () => patches[patches.length - 1]

const realClient = await import('../modules/protect/client')

mock.module('../modules/protect/client', () => ({
  ...realClient,
  getBootstrap: async () => ({ lights: LIGHTS }),
  patchDevice: async (_cfg: unknown, type: string, id: string, body: Record<string, unknown>) => {
    patches.push({ type, id, body })
    return { id }
  },
}))

const { lightsGet, lightsList, lightsOff, lightsOn, lightsToggle } = await import('../modules/protect/commands/lights')

describe('protect lights list', () => {
  test('returns the lights collection', async () => {
    const res = await lightsList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: unknown[] }).data).toHaveLength(2)
  })
})

describe('protect lights get', () => {
  test('rejects missing ref', async () => {
    expect(errCode(await lightsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('resolves by substring name', async () => {
    const res = await lightsGet.run({ ...EMPTY_CTX, args: { ref: 'Garage' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { id: string } }).data.id).toBe('li2')
  })

  test('unknown ref is not_found', async () => {
    expect(errCode(await lightsGet.run({ ...EMPTY_CTX, args: { ref: 'nope' } }))).toBe('not_found')
  })
})

describe('protect lights control', () => {
  test('on patches the resolved light', async () => {
    const res = await lightsOn.run({ ...EMPTY_CTX, args: { light: 'Front Light' } })
    expect(res.ok).toBe(true)
    expect(lastPatch()?.id).toBe('li1')
    expect(lastPatch()?.body).toEqual({ lightOnSettings: { isLedForceOn: true } })
  })

  test('on with brightness sets ledLevel', async () => {
    await lightsOn.run({ ...EMPTY_CTX, args: { light: 'li1', brightness: '80' } })
    expect(lastPatch()?.body.lightDeviceSettings).toEqual({ ledLevel: 80 })
  })

  test('off turns the light off', async () => {
    const res = await lightsOff.run({ ...EMPTY_CTX, args: { light: 'li2' } })
    expect(res.ok).toBe(true)
    expect(lastPatch()?.body).toEqual({ lightOnSettings: { isLedForceOn: false } })
  })

  test('toggle inverts current state', async () => {
    // li2 is on → toggle should turn it off
    await lightsToggle.run({ ...EMPTY_CTX, args: { light: 'li2' } })
    expect(lastPatch()?.body).toEqual({ lightOnSettings: { isLedForceOn: false } })
  })

  test('rejects missing light', async () => {
    expect(errCode(await lightsOn.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('rejects invalid brightness', async () => {
    expect(errCode(await lightsOn.run({ ...EMPTY_CTX, args: { light: 'li1', brightness: '150' } }))).toBe('invalid_arg')
  })
})

describe('protect lights command specs', () => {
  test('declare expected paths', () => {
    expect(lightsOn.path).toEqual(['lights', 'on'])
    expect(lightsList.path).toEqual(['lights', 'list'])
    expect(lightsGet.path).toEqual(['lights', 'get'])
  })
})
