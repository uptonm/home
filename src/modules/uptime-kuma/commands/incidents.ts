import type { CommandSpec } from '../../../core/types'
import { normalizeStatusPage } from '../adapter'
import { openTransport, runKumaCommand } from './shared'

export const incidentsListCmd: CommandSpec = {
  path: ['incidents', 'list'],
  effect: 'read',
  description: 'Currently published (pinned, active) incidents on the status page',
  args: [],
  examples: ['home uptime-kuma incidents list --json'],
  run: (ctx) =>
    runKumaCommand(async () => {
      const { cfg, t } = openTransport(ctx)
      const page = normalizeStatusPage(await t.getStatusPage(cfg.statusPageSlug))
      // The public route exposes at most one incident — the pinned active one.
      const incidents = page.incident ? [page.incident] : []
      return {
        ok: true,
        data: { incidents, freshness: { cachedTransport: t.cachedTransport, newestBeatAt: null } },
      }
    }),
}

export const maintenancesListCmd: CommandSpec = {
  path: ['maintenances', 'list'],
  effect: 'read',
  description: 'Maintenance windows currently active on the status page',
  args: [],
  examples: ['home uptime-kuma maintenances list --json'],
  run: (ctx) =>
    runKumaCommand(async () => {
      const { cfg, t } = openTransport(ctx)
      const page = normalizeStatusPage(await t.getStatusPage(cfg.statusPageSlug))
      // getMaintenanceList only includes windows that are under maintenance right now.
      return {
        ok: true,
        data: { maintenances: page.maintenances, freshness: { cachedTransport: t.cachedTransport, newestBeatAt: null } },
      }
    }),
}
