import { describe, expect, mock, test } from 'bun:test'
import type { HassConfig } from '../modules/assistant/client'

const EMPTY_CTX = {
  config: {},
  json: false,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {},
}

const CONFIG: HassConfig = {
  version: '2026.6.0',
  location_name: 'Home',
  time_zone: 'UTC',
  components: ['light', 'sensor'],
  unit_system: { temperature: '°C' },
}

const realClient = await import('../modules/assistant/client')

mock.module('../modules/assistant/client', () => ({
  ...realClient,
  getConfig: async () => CONFIG,
  errorLog: async () => 'ERROR line 1\nWARNING line 2\n',
}))

const { configGet } = await import('../modules/assistant/commands/config')
const { errorLogCmd } = await import('../modules/assistant/commands/error-log')

describe('assistant config get', () => {
  test('command path', () => {
    expect(configGet.path).toEqual(['config', 'get'])
  })
  test('returns the config object', async () => {
    const res = await configGet.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: HassConfig }).data.version).toBe('2026.6.0')
  })
})

describe('assistant error-log', () => {
  test('command path', () => {
    expect(errorLogCmd.path).toEqual(['error-log'])
  })
  test('returns the log text', async () => {
    const res = await errorLogCmd.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: string }).data).toContain('ERROR line 1')
  })
})
