import { describe, expect, test } from 'bun:test'
import { firewallGroupsGet, firewallGroupsList } from '../modules/unifi/commands/firewall-groups'

const EMPTY_CTX = { config: {}, json: false, quiet: true, verbose: false, log: null as unknown as ReturnType<typeof import('consola').createConsola>, args: {} }

function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

describe('unifi firewall-groups list', () => {
  test('command path is firewall-groups list', () => {
    expect(firewallGroupsList.path).toEqual(['firewall-groups', 'list'])
  })

  test('has no args', () => {
    expect(firewallGroupsList.args).toEqual([])
  })
})

describe('unifi firewall-groups get', () => {
  test('command path is firewall-groups get', () => {
    expect(firewallGroupsGet.path).toEqual(['firewall-groups', 'get'])
  })

  test('declares a required name positional arg', () => {
    const name = firewallGroupsGet.args.find((a) => a.name === 'name')
    expect(name).toBeDefined()
    expect(name?.kind).toBe('positional')
    expect(name?.required).toBe(true)
  })

  test('rejects empty name', async () => {
    expect(errCode(await firewallGroupsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })
})
