import { describe, expect, mock, test } from 'bun:test'
import type { HassServiceDomain } from '../modules/assistant/client'

const EMPTY_CTX = {
  config: {},
  json: false,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {},
}

const SAMPLE: HassServiceDomain[] = [
  { domain: 'light', services: { turn_on: {}, turn_off: {}, toggle: {} } },
  { domain: 'switch', services: { turn_on: {}, turn_off: {} } },
]

const realClient = await import('../modules/assistant/client')

mock.module('../modules/assistant/client', () => ({
  ...realClient,
  listServices: async (_cfg: unknown, domain?: string) =>
    domain ? SAMPLE.filter((s) => s.domain === domain) : SAMPLE,
}))

const { servicesList } = await import('../modules/assistant/commands/services')

describe('assistant services list', () => {
  test('command path and args', () => {
    expect(servicesList.path).toEqual(['services', 'list'])
    expect(servicesList.args.find((a) => a.name === 'domain')?.kind).toBe('string')
  })

  test('returns all domains when no --domain', async () => {
    const res = await servicesList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: HassServiceDomain[] }).data).toHaveLength(2)
  })

  test('forwards --domain to the client filter', async () => {
    const res = await servicesList.run({ ...EMPTY_CTX, args: { domain: 'light' } })
    expect(res.ok).toBe(true)
    const data = (res as { data: HassServiceDomain[] }).data
    expect(data).toHaveLength(1)
    expect(data[0]?.domain).toBe('light')
  })
})
