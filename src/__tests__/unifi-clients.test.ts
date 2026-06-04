import { describe, expect, test } from 'bun:test'
import { clientsGet } from '../modules/unifi/commands/clients'

const EMPTY_CTX = { config: {}, json: false, quiet: true, verbose: false, log: null as unknown as ReturnType<typeof import('consola').createConsola>, args: {} }

function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

describe('unifi clients get', () => {
  test('command path is clients get', () => {
    expect(clientsGet.path).toEqual(['clients', 'get'])
  })

  test('declares a required mac positional arg', () => {
    const mac = clientsGet.args.find((a) => a.name === 'mac')
    expect(mac).toBeDefined()
    expect(mac?.kind).toBe('positional')
    expect(mac?.required).toBe(true)
  })

  test('rejects missing mac', async () => {
    expect(errCode(await clientsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('rejects blank mac', async () => {
    expect(errCode(await clientsGet.run({ ...EMPTY_CTX, args: { mac: '' } }))).toBe('missing_arg')
  })
})
