import type { CommandSpec } from '../../../core/types'
import { openTransport, runKumaCommand, summarizeHeartbeats } from './shared'

export const summaryCmd: CommandSpec = {
  path: ['summary'],
  effect: 'read',
  description: 'Compact page summary: monitor counts by state, worst state, average latency, data freshness',
  args: [],
  examples: ['home uptime-kuma summary --json'],
  run: (ctx) =>
    runKumaCommand(async () => {
      const { cfg, t } = openTransport(ctx)
      const summary = summarizeHeartbeats(t, await t.getHeartbeats(cfg.statusPageSlug))
      return { ok: true, data: summary }
    }),
}
