import { describe, expect, test } from 'bun:test'
import { wlansGet } from '../modules/unifi/commands/wlans'

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

describe('unifi wlans get', () => {
  test('is registered with the expected command path', () => {
    expect(wlansGet.path).toEqual(['wlans', 'get'])
  })

  test('declares a required ssid positional arg', () => {
    expect(wlansGet.args).toEqual([
      { name: 'ssid', kind: 'positional', description: 'SSID name (case-insensitive)', required: true },
    ])
  })

  test('rejects missing ssid', async () => {
    expect(errCode(await wlansGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('rejects empty ssid', async () => {
    expect(errCode(await wlansGet.run({ ...EMPTY_CTX, args: { ssid: '' } }))).toBe('missing_arg')
  })
})
