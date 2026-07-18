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

// Private API rows carry a Mongo `_id` that is NOT valid against the integration
// API — the integration device/client list below carries the real UUIDs, keyed
// by macAddress, and must be resolved through separately from the private `_id`.
const SAMPLE_DEVICES = [
  { _id: 'd1', mac: 'aa:bb:cc:dd:ee:ff', name: 'Living Room AP', type: 'uap' },
  { _id: 'd2', mac: '11:22:33:44:55:66', name: 'Office Switch', type: 'usw' },
]
const SAMPLE_CLIENTS = [
  { _id: 'c1', mac: '78:8a:20:11:22:33', hostname: 'iphone', ip: '192.168.1.50' },
]
const INTEGRATION_DEVICES = [
  { id: 'idev-1', macAddress: 'aa:bb:cc:dd:ee:ff' },
  { id: 'idev-2', macAddress: '11:22:33:44:55:66' },
]
const INTEGRATION_CLIENTS = [{ id: 'iclient-1', macAddress: '78:8a:20:11:22:33' }]

let deviceAction: { id: string; action: string } | null = null
let portAction: { id: string; port: number; action: string } | null = null
let clientAction: { id: string; action: string; extra?: Record<string, unknown> } | null = null
let privatePowerCycle: { mac: string; port: number } | null = null
// Forces resolveIntegrationDeviceId to null regardless of the private match found —
// simulates "private API knows the device, integration API has no counterpart".
let forceUnresolvableDeviceId = false

// Mock the private client layer for device/client resolution + the private PoE path.
const realClient = await import('../modules/unifi/client')
mock.module('../modules/unifi/client', () => ({
  ...realClient,
  listDevices: async () => SAMPLE_DEVICES,
  listClients: async () => SAMPLE_CLIENTS,
  powerCyclePort: async (_cfg: unknown, mac: string, port: number) => {
    privatePowerCycle = { mac, port }
    return { transport: 'private' }
  },
}))

// Mock the integration list + action calls (withSource, resolveIntegration*Id stay
// real so poe-cycle/restart/authorize-guest exercise the real fallback + MAC-resolution logic).
const realIntegration = await import('../modules/unifi/integration-client')
mock.module('../modules/unifi/integration-client', () => ({
  ...realIntegration,
  integrationListDevices: async () => INTEGRATION_DEVICES,
  integrationListClients: async () => INTEGRATION_CLIENTS,
  resolveIntegrationDeviceId: async (_cfg: unknown, mac: string) =>
    forceUnresolvableDeviceId ? null : realIntegration.matchDeviceByMac(INTEGRATION_DEVICES, mac),
  integrationDeviceAction: async (_cfg: unknown, id: string, action: string) => {
    deviceAction = { id, action }
    return { transport: 'integration' }
  },
  integrationPortAction: async (_cfg: unknown, id: string, port: number, action: string) => {
    portAction = { id, port, action }
    return { transport: 'integration' }
  },
  integrationClientAction: async (_cfg: unknown, id: string, action: string, extra?: Record<string, unknown>) => {
    clientAction = { id, action, extra }
    return { transport: 'integration' }
  },
}))

const { devicesRestart } = await import('../modules/unifi/commands/devices')
const { devicesPoeCycle } = await import('../modules/unifi/commands/poe-cycle')
const { clientsAuthorizeGuest } = await import('../modules/unifi/commands/client-control')

describe('unifi devices restart', () => {
  test('path with required device positional and --yes flag', () => {
    expect(devicesRestart.path).toEqual(['devices', 'restart'])
    expect(devicesRestart.args.find((a) => a.name === 'device')?.required).toBe(true)
    expect(devicesRestart.args.find((a) => a.name === 'yes')?.kind).toBe('boolean')
  })

  test('rejects missing device', async () => {
    expect(errCode(await devicesRestart.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('refuses to restart without --yes (no API call)', async () => {
    deviceAction = null
    expect(errCode(await devicesRestart.run({ ...EMPTY_CTX, args: { device: 'Living Room AP' } }))).toBe(
      'confirmation_required',
    )
    expect(deviceAction as unknown).toBeNull()
  })

  test('not_found for unknown device', async () => {
    expect(errCode(await devicesRestart.run({ ...EMPTY_CTX, args: { device: 'ghost', yes: true } }))).toBe('not_found')
  })

  test('resolves by name and posts a RESTART action with the integration id', async () => {
    deviceAction = null
    const res = await devicesRestart.run({ ...EMPTY_CTX, args: { device: 'Living Room AP', yes: true } })
    expect(res.ok).toBe(true)
    expect(deviceAction as unknown).toEqual({ id: 'idev-1', action: 'RESTART' })
  })

  test('resolves by MAC too', async () => {
    deviceAction = null
    await devicesRestart.run({ ...EMPTY_CTX, args: { device: '11:22:33:44:55:66', yes: true } })
    expect(deviceAction as unknown).toEqual({ id: 'idev-2', action: 'RESTART' })
  })
})

describe('unifi devices poe-cycle', () => {
  test('path with --yes flag', () => {
    expect(devicesPoeCycle.path).toEqual(['devices', 'poe-cycle'])
    expect(devicesPoeCycle.args.find((a) => a.name === 'yes')?.kind).toBe('boolean')
  })

  test('rejects missing device and bad port', async () => {
    expect(errCode(await devicesPoeCycle.run({ ...EMPTY_CTX, args: { port: '4' } }))).toBe('missing_arg')
    expect(errCode(await devicesPoeCycle.run({ ...EMPTY_CTX, args: { device: 'Office Switch', port: '0' } }))).toBe('invalid_arg')
  })

  test('refuses without --yes (no API call)', async () => {
    privatePowerCycle = null
    portAction = null
    const res = await devicesPoeCycle.run({ ...EMPTY_CTX, args: { device: 'Office Switch', port: '4' } })
    expect(errCode(res)).toBe('confirmation_required')
    expect(privatePowerCycle as unknown).toBeNull()
    expect(portAction as unknown).toBeNull()
  })

  test('rejects non-switch devices', async () => {
    expect(
      errCode(await devicesPoeCycle.run({ ...EMPTY_CTX, args: { device: 'Living Room AP', port: '4', yes: true } })),
    ).toBe('not_supported')
  })

  test('auto source uses the private power-cycle path', async () => {
    privatePowerCycle = null
    portAction = null
    const res = await devicesPoeCycle.run({ ...EMPTY_CTX, args: { device: 'Office Switch', port: '4', yes: true } })
    expect(res.ok).toBe(true)
    expect(privatePowerCycle as unknown).toEqual({ mac: '11:22:33:44:55:66', port: 4 })
    expect(portAction as unknown).toBeNull()
  })

  test('source=integration uses the integration POWER_CYCLE action', async () => {
    privatePowerCycle = null
    portAction = null
    const res = await devicesPoeCycle.run({
      ...EMPTY_CTX,
      config: { source: 'integration' },
      args: { device: 'Office Switch', port: '4', yes: true },
    })
    expect(res.ok).toBe(true)
    expect(portAction as unknown).toEqual({ id: 'idev-2', port: 4, action: 'POWER_CYCLE' })
    expect(privatePowerCycle as unknown).toBeNull()
  })

  test('private match found but integration id unresolvable -> user not_found, not a system exit', async () => {
    portAction = null
    forceUnresolvableDeviceId = true
    try {
      const res = await devicesPoeCycle.run({
        ...EMPTY_CTX,
        config: { source: 'integration' },
        args: { device: 'Office Switch', port: '4', yes: true },
      })
      expect(res.ok).toBe(false)
      expect((res as { kind?: string }).kind).toBe('user')
      expect(errCode(res)).toBe('not_found')
      expect(portAction as unknown).toBeNull()
    } finally {
      forceUnresolvableDeviceId = false
    }
  })
})

describe('unifi clients authorize-guest', () => {
  test('path with required client positional and --yes flag', () => {
    expect(clientsAuthorizeGuest.path).toEqual(['clients', 'authorize-guest'])
    expect(clientsAuthorizeGuest.args.find((a) => a.name === 'client')?.required).toBe(true)
    expect(clientsAuthorizeGuest.args.find((a) => a.name === 'yes')?.kind).toBe('boolean')
  })

  test('rejects missing client and invalid minutes', async () => {
    expect(errCode(await clientsAuthorizeGuest.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
    expect(errCode(await clientsAuthorizeGuest.run({ ...EMPTY_CTX, args: { client: 'iphone', minutes: 0 } }))).toBe('invalid_arg')
  })

  test('refuses without --yes (no API call)', async () => {
    clientAction = null
    expect(errCode(await clientsAuthorizeGuest.run({ ...EMPTY_CTX, args: { client: 'iphone' } }))).toBe(
      'confirmation_required',
    )
    expect(clientAction as unknown).toBeNull()
  })

  test('not_found for unknown client', async () => {
    expect(errCode(await clientsAuthorizeGuest.run({ ...EMPTY_CTX, args: { client: 'ghost', yes: true } }))).toBe('not_found')
  })

  test('authorizes by hostname and forwards a time limit', async () => {
    clientAction = null
    const res = await clientsAuthorizeGuest.run({
      ...EMPTY_CTX,
      args: { client: 'iphone', minutes: 60, yes: true },
    })
    expect(res.ok).toBe(true)
    expect(clientAction as unknown).toEqual({ id: 'iclient-1', action: 'AUTHORIZE_GUEST_ACCESS', extra: { timeLimitMinutes: 60 } })
  })

  test('resolves by IP with no time limit', async () => {
    clientAction = null
    await clientsAuthorizeGuest.run({ ...EMPTY_CTX, args: { client: '192.168.1.50', yes: true } })
    expect(clientAction as unknown).toEqual({ id: 'iclient-1', action: 'AUTHORIZE_GUEST_ACCESS', extra: undefined })
  })
})
