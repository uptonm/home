import type { CommandSpec } from '../../../core/types'
import { healthWidget, readUnifiConfig } from '../client'

interface DeviceStatus {
  adopted?: number
  connected?: number
  disconnected?: number
}

interface RawHealth {
  wifi_score?: { client_score_avg?: number; clients?: number; clients_with_poor_score?: number }
  average_wifi_utilization?: { total?: number }
  devices_status?: Record<string, DeviceStatus>
}

export const healthCmd: CommandSpec = {
  path: ['health'],
  description: 'Controller health rollup: wifi score, device up/down counts, utilization',
  args: [],
  examples: ['home unifi health', 'home unifi health --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const h = (await healthWidget(cfg)) as RawHealth | null
    if (!h) return { ok: false, kind: 'system', message: 'no health data returned', code: 'empty' }

    const status = h.devices_status ?? {}
    const byType: Record<string, string> = {}
    let connected = 0
    let disconnected = 0
    for (const [type, s] of Object.entries(status)) {
      if (!s.adopted) continue
      byType[type] = `${s.connected ?? 0}/${s.adopted}`
      connected += s.connected ?? 0
      disconnected += s.disconnected ?? 0
    }

    const util = h.average_wifi_utilization?.total
    const data = {
      wifi_score: h.wifi_score?.client_score_avg ?? null,
      clients: h.wifi_score?.clients ?? null,
      clients_with_poor_score: h.wifi_score?.clients_with_poor_score ?? null,
      avg_wifi_utilization_pct: typeof util === 'number' ? Math.round(util * 10) / 10 : null,
      devices_connected: connected,
      devices_disconnected: disconnected,
      devices: byType,
    }
    return { ok: true, data }
  },
}
