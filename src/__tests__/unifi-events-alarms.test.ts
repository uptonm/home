import { describe, expect, mock, test } from 'bun:test'

const EMPTY_CTX = {
  config: {},
  json: false,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {},
}

// Captured from a live probe against a Network 10.4.57 controller behind a
// UDM (POST /proxy/network/v2/api/site/default/system-log/all, X-API-KEY
// auth, body {pageNumber:0, pageSize:5}). The legacy stat/event and
// stat/alarm endpoints 404 on this controller; this v2 endpoint is the
// documented-nowhere replacement. message_raw is always a template with
// {PLACEHOLDER} tokens resolved via `parameters` — there is no pre-rendered
// message field — so `title_raw` (already-resolved, no placeholders) is what
// the mapper uses for the output `msg` field.
const CAPTURED_ROW = {
  category: 'CLIENT_DEVICES',
  event: 'CLIENT_ROAMED',
  id: '6a5aefb651c96f670443f18b',
  key: 'CLIENT_ROAMED_2',
  message_raw:
    '{CLIENT} roamed from {DEVICE_FROM} to {DEVICE_TO}. Connection Info: {WIFI_STATS}. Roaming Decision: {PREVIOUS_SIGNAL_STRENGTH} dBm to {SIGNAL_STRENGTH} dBm.',
  parameters: {
    CLIENT: { id: '5a:8e:b5:ce:b2:e9', name: 'iPhone - Personal', hostname: 'iPhone', ip: '10.0.10.162' },
  },
  severity: 'LOW',
  show_on_dashboard: false,
  status: 'NEW',
  subcategory: 'MONITORING_WIFI',
  target: 'CLIENT',
  timestamp: 1784344502809,
  title_raw: 'WiFi Client Roamed',
  type: 'CLIENT_CONNECTION',
}

const { mapSystemLogRow } = await import('../modules/unifi/commands/operational')

describe('mapSystemLogRow', () => {
  test('maps a captured v2 system-log row to {time, key, msg}', () => {
    expect(mapSystemLogRow(CAPTURED_ROW)).toEqual({
      time: '2026-07-18T03:15:02.809Z',
      key: 'CLIENT_ROAMED_2',
      msg: 'WiFi Client Roamed',
    })
  })

  test('falls back to empty strings for missing fields', () => {
    expect(mapSystemLogRow({})).toEqual({ time: '', key: '', msg: '' })
  })
})

// ── eventsList / alarmsList command flow (mocked client) ───────────────────

const realClient = await import('../modules/unifi/client')

let lastCall: { category: string; pageNumber: number; pageSize: number } | null = null
let nextRows: unknown[] = []

mock.module('../modules/unifi/client', () => ({
  ...realClient,
  v2SystemLog: async (_cfg: unknown, category: string, pageNumber: number, pageSize: number) => {
    lastCall = { category, pageNumber, pageSize }
    return nextRows
  },
}))

const { eventsList, alarmsList } = await import('../modules/unifi/commands/operational')

describe('unifi events list', () => {
  test('queries category "all" with a default pageSize and maps rows', async () => {
    nextRows = [CAPTURED_ROW]
    const res = await eventsList.run({ ...EMPTY_CTX, args: {} })
    expect(res.ok).toBe(true)
    expect(lastCall).toEqual({ category: 'all', pageNumber: 0, pageSize: 50 })
    expect((res as { data: unknown[] }).data).toEqual([
      { time: '2026-07-18T03:15:02.809Z', key: 'CLIENT_ROAMED_2', msg: 'WiFi Client Roamed' },
    ])
  })

  test('maps --limit to pageSize', async () => {
    nextRows = []
    await eventsList.run({ ...EMPTY_CTX, args: { limit: 20 } })
    expect(lastCall).toEqual({ category: 'all', pageNumber: 0, pageSize: 20 })
  })
})

describe('unifi alarms list', () => {
  test('queries category "critical" and maps rows', async () => {
    nextRows = [{ ...CAPTURED_ROW, key: 'CRITICAL_ALARM_1', title_raw: 'Something Critical' }]
    const res = await alarmsList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect(lastCall).toEqual({ category: 'critical', pageNumber: 0, pageSize: 50 })
    expect((res as { data: unknown[] }).data).toEqual([
      { time: '2026-07-18T03:15:02.809Z', key: 'CRITICAL_ALARM_1', msg: 'Something Critical' },
    ])
  })
})
