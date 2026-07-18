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

// Toggled by the "integration API unreachable" tests below to make the mocked
// list fetchers throw, exercising the resolvers' graceful-degrade path without
// re-registering mock.module mid-file.
let throwOnListDevices = false
let throwOnListClients = false

mock.module('../modules/unifi/integration-client', () => ({
  ...realIntegration,
  integrationListDevices: async () => {
    if (throwOnListDevices) throw new Error('integration API unreachable')
    return INTEGRATION_DEVICES
  },
  integrationListClients: async () => {
    if (throwOnListClients) throw new Error('integration API unreachable')
    return INTEGRATION_CLIENTS
  },
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

describe('resolver graceful degrade when the integration API is unreachable', () => {
  test('resolveIntegrationDeviceId returns null (not a throw) when the list fn throws', async () => {
    throwOnListDevices = true
    try {
      expect(await resolveIntegrationDeviceId(cfg, '0c:ea:14:63:09:55')).toBeNull()
    } finally {
      throwOnListDevices = false
    }
  })

  test('resolveIntegrationClientId returns null (not a throw) when the list fn throws', async () => {
    throwOnListClients = true
    try {
      expect(await resolveIntegrationClientId(cfg, '78:8a:20:11:22:33')).toBeNull()
    } finally {
      throwOnListClients = false
    }
  })
})

// ── integrationGetDeviceStats envelope ──────────────────────────────────────
// statistics/latest returns the stats object directly, unlike every other
// integration endpoint's { data: ... } envelope — verified live on 10.4.57.

describe('integrationGetDeviceStats', () => {
  test('returns the bare object from requestJson as-is, with no {data} unwrap', async () => {
    const BARE_STATS = { uptimeSec: 123, cpuUtilizationPct: 12.3 }
    const realHttp = await import('../core/http')
    mock.module('../core/http', () => ({
      ...realHttp,
      requestJson: async (url: string) =>
        url.includes('/statistics/latest') ? BARE_STATS : { data: [{ id: 'site-1', name: 'default' }] },
    }))

    const { integrationGetDeviceStats } = await import('../modules/unifi/integration-client')
    const statsCfg = { url: 'https://example.test', site: 'default', apiKey: 'k' }
    expect(await integrationGetDeviceStats(statsCfg, 'uuid-1')).toEqual(BARE_STATS)
  })
})
