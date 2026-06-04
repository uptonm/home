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

// Sample firewall rules as returned by /rest/firewallrule (data array).
const SAMPLE = [
  {
    _id: 'b2',
    name: 'Allow established',
    enabled: true,
    action: 'accept',
    ruleset: 'WAN_IN',
    rule_index: 2001,
    protocol: 'all',
    src_address: '',
    dst_address: '',
    dst_port: '',
  },
  {
    _id: 'a1',
    name: 'Block IoT to LAN',
    enabled: false,
    action: 'drop',
    ruleset: 'LAN_IN',
    rule_index: 3001,
    protocol: 'tcp',
    src_address: '10.180.0.0/24',
    dst_address: '10.0.0.0/24',
    dst_port: '443',
  },
]

const realClient = await import('../modules/unifi/client')

mock.module('../modules/unifi/client', () => ({
  ...realClient,
  listFirewallRules: async () => SAMPLE,
  getFirewallRule: async (_cfg: unknown, id: string) => SAMPLE.find((r) => r._id === id) ?? null,
}))

const { firewallGet, firewallList } = await import('../modules/unifi/commands/firewall')

describe('unifi firewall list', () => {
  test('shapes and sorts rules by ruleset then index', async () => {
    const res = await firewallList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    const data = (res as { data: Array<Record<string, unknown>> }).data
    expect(data).toHaveLength(2)
    // LAN_IN sorts before WAN_IN alphabetically
    expect(data[0]?.ruleset).toBe('LAN_IN')
    expect(data[1]?.ruleset).toBe('WAN_IN')
  })

  test('exposes a normalized shape', async () => {
    const res = await firewallList.run({ ...EMPTY_CTX })
    const lan = (res as { data: Array<Record<string, unknown>> }).data[0]
    expect(lan).toEqual({
      id: 'a1',
      name: 'Block IoT to LAN',
      enabled: false,
      action: 'drop',
      ruleset: 'LAN_IN',
      index: 3001,
      proto: 'tcp',
      src: '10.180.0.0/24',
      dst: '10.0.0.0/24',
      dstPort: '443',
    })
  })
})

describe('unifi firewall get', () => {
  test('rejects missing id', async () => {
    expect(errCode(await firewallGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('returns not_found for unknown id', async () => {
    expect(errCode(await firewallGet.run({ ...EMPTY_CTX, args: { id: 'nope' } }))).toBe('not_found')
  })

  test('returns the matching rule', async () => {
    const res = await firewallGet.run({ ...EMPTY_CTX, args: { id: 'a1' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { _id: string } }).data._id).toBe('a1')
  })
})

describe('unifi firewall command specs', () => {
  test('declare expected command paths', () => {
    expect(firewallList.path).toEqual(['firewall', 'list'])
    expect(firewallGet.path).toEqual(['firewall', 'get'])
    expect(firewallGet.args[0]?.required).toBe(true)
  })
})
