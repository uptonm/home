import type { CommandSpec } from '../../../core/types'
import { createTransport, readBeszelConfig } from '../client'
import { fetchSystems, summarizeSystems } from './shared'

export const overviewCmd: CommandSpec = {
  path: ['overview'],
  effect: 'read',
  description: 'Compact all-system summary: up/down counts, active alerts, per-host cpu/memory/disk %',
  args: [],
  examples: ['home beszel overview --json'],
  async run(ctx) {
    const t = createTransport(readBeszelConfig(ctx.config))
    const systems = await fetchSystems(t)
    const activeAlerts = await t.count('alerts', 'triggered=true')
    return {
      ok: true,
      data: {
        systems: summarizeSystems(systems),
        activeAlerts,
        hosts: systems.map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          cpuPct: s.cpuPct,
          memoryPct: s.memoryPct,
          diskPct: s.diskPct,
        })),
      },
    }
  },
}
