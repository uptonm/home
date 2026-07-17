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
      const data: Record<string, unknown> = {
        incidents,
        freshness: { cachedTransport: t.cachedTransport, newestBeatAt: null },
      }
      if (t.privateData !== null) {
        // Kuma 1.23.x pushes no incident event over the authenticated socket —
        // pinned incidents exist only on public status pages.
        data.note =
          'Uptime Kuma 1.23 exposes pinned incidents only via public status pages; the authenticated socket carries none — use mode=public-status to read them'
      }
      return { ok: true, data }
    }),
}

export const maintenancesListCmd: CommandSpec = {
  path: ['maintenances', 'list'],
  effect: 'read',
  description:
    'Maintenance windows — public mode lists only those active on the status page right now; authenticated mode lists every window with its status',
  args: [],
  examples: ['home uptime-kuma maintenances list --json'],
  run: (ctx) =>
    runKumaCommand(async () => {
      const { cfg, t } = openTransport(ctx)
      const page = normalizeStatusPage(await t.getStatusPage(cfg.statusPageSlug))
      // Public getMaintenanceList only includes windows under maintenance right
      // now; the authenticated snapshot carries all windows, each with `status`.
      return {
        ok: true,
        data: { maintenances: page.maintenances, freshness: { cachedTransport: t.cachedTransport, newestBeatAt: null } },
      }
    }),
}
