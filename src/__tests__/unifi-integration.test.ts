import { describe, expect, mock, test } from 'bun:test'

// ── matchDeviceByMac (pure) ─────────────────────────────────────────────────

const { matchDeviceByMac, matchClientByMac } = await import('../modules/unifi/integration-client')

describe('matchDeviceByMac', () => {
  test('matches case-insensitively on macAddress', () => {
    const rows = [{ id: 'uuid-1', macAddress: '1C:0B:8B:6E:BA:39' }]
    expect(matchDeviceByMac(rows, '1c:0b:8b:6e:ba:39')).toBe('uuid-1')
  })

  test('null when absent', () => {
    expect(matchDeviceByMac([], 'aa:bb:cc:dd:ee:ff')).toBeNull()
  })

  test('trims and lowercases the query mac', () => {
    const rows = [{ id: 'uuid-2', macAddress: 'aa:bb:cc:dd:ee:ff' }]
    expect(matchDeviceByMac(rows, '  AA:BB:CC:DD:EE:FF  ')).toBe('uuid-2')
  })

  test('ignores rows with no macAddress', () => {
    const rows = [{ id: 'uuid-3' }]
    expect(matchDeviceByMac(rows, 'aa:bb:cc:dd:ee:ff')).toBeNull()
  })
})

describe('matchClientByMac', () => {
  test('matches case-insensitively on macAddress', () => {
    const rows = [{ id: 'client-uuid-1', macAddress: '0C:EA:14:63:09:55' }]
    expect(matchClientByMac(rows, '0c:ea:14:63:09:55')).toBe('client-uuid-1')
  })

  test('null when absent', () => {
    expect(matchClientByMac([], 'aa:bb:cc:dd:ee:ff')).toBeNull()
  })
})

// ── resolveIntegrationDeviceId / resolveIntegrationClientId ───────────────
// Mock integrationListDevices/integrationListClients (the paginated fetchers)
// so the resolvers are exercised end-to-end without hitting HTTP.

const realIntegration = await import('../modules/unifi/integration-client')

const INTEGRATION_DEVICES = [
  { id: 'idev-uuid-1', macAddress: '0c:ea:14:63:09:55' },
  { id: 'idev-uuid-2', macAddress: '1c:0b:8b:6e:ba:39' },
]
const INTEGRATION_CLIENTS = [{ id: 'iclient-uuid-1', macAddress: '78:8a:20:11:22:33' }]

mock.module('../modules/unifi/integration-client', () => ({
  ...realIntegration,
  integrationListDevices: async () => INTEGRATION_DEVICES,
  integrationListClients: async () => INTEGRATION_CLIENTS,
}))

const { resolveIntegrationDeviceId, resolveIntegrationClientId } = await import(
  '../modules/unifi/integration-client'
)

const cfg = { url: '', site: 'default', apiKey: '' }

describe('resolveIntegrationDeviceId', () => {
  test('resolves the integration UUID for a matching MAC', async () => {
    expect(await resolveIntegrationDeviceId(cfg, '0C:EA:14:63:09:55')).toBe('idev-uuid-1')
  })

  test('returns null when no device matches', async () => {
    expect(await resolveIntegrationDeviceId(cfg, 'aa:aa:aa:aa:aa:aa')).toBeNull()
  })
})

describe('resolveIntegrationClientId', () => {
  test('resolves the integration UUID for a matching MAC', async () => {
    expect(await resolveIntegrationClientId(cfg, '78:8A:20:11:22:33')).toBe('iclient-uuid-1')
  })

  test('returns null when no client matches', async () => {
    expect(await resolveIntegrationClientId(cfg, 'aa:aa:aa:aa:aa:aa')).toBeNull()
  })
})
