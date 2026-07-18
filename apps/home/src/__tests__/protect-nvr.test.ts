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

const NVR = { id: 'nvr1', name: 'Dream Machine', version: '4.0.0', uptime: 123456 }

const realClient = await import('../modules/protect/client')

let bootstrap: Record<string, unknown> = { nvr: NVR }

mock.module('../modules/protect/client', () => ({
  ...realClient,
  getBootstrap: async () => bootstrap,
}))

const { nvrInfo } = await import('../modules/protect/commands/nvr')

describe('protect nvr info', () => {
  test('returns the nvr singleton', async () => {
    bootstrap = { nvr: NVR }
    const res = await nvrInfo.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: { name: string } }).data.name).toBe('Dream Machine')
  })

  test('errors when bootstrap has no nvr', async () => {
    bootstrap = {}
    expect(errCode(await nvrInfo.run({ ...EMPTY_CTX }))).toBe('empty')
  })

  test('declares expected path', () => {
    expect(nvrInfo.path).toEqual(['nvr', 'info'])
  })
})
