import type { CommandSpec } from '../../../core/types'
import { MONITOR_STATUSES, summarizeLatency } from '../adapter'
import { fetchBoard, openTransport, parseStatusFilter, pickMonitor, runKumaCommand } from './shared'

export const monitorsListCmd: CommandSpec = {
  path: ['monitors', 'list'],
  effect: 'read',
  description: 'Monitors visible on the status page with their latest public heartbeat state and latency',
  args: [
    {
      name: 'status',
      kind: 'string',
      description: 'Only monitors whose latest beat is in this state',
      enum: MONITOR_STATUSES,
    },
  ],
  examples: ['home uptime-kuma monitors list --json', 'home uptime-kuma monitors list --status down --json'],
  run: (ctx) =>
    runKumaCommand(async () => {
      const filter = parseStatusFilter(ctx)
      if (!filter.ok) return filter.error
      const { cfg, t } = openTransport(ctx)
      const board = await fetchBoard(t, cfg.statusPageSlug)
      const monitors = filter.status ? board.monitors.filter((m) => m.status === filter.status) : board.monitors
      return { ok: true, data: { monitors, freshness: board.freshness } }
    }),
}

export const monitorsGetCmd: CommandSpec = {
  path: ['monitors', 'get'],
  effect: 'read',
  description:
    'One monitor by id or exact name: state, latency summary over the recent public beats, cert expiry when exposed',
  args: [{ name: 'monitor', kind: 'positional', description: 'Monitor id or exact name', required: true }],
  examples: ['home uptime-kuma monitors get caddy --json', 'home uptime-kuma monitors get 3 --json'],
  run: (ctx) =>
    runKumaCommand(async () => {
      const ref = String(ctx.args.monitor ?? '').trim()
      if (!ref) return { ok: false, kind: 'user', message: 'monitor id or name is required', code: 'missing_arg' }
      const { cfg, t } = openTransport(ctx)
      const board = await fetchBoard(t, cfg.statusPageSlug)
      const picked = pickMonitor(board.monitors, ref)
      if (!picked.ok) return picked.error
      const beats = board.beatsByMonitor.get(picked.monitor.id) ?? []
      return {
        ok: true,
        data: {
          ...picked.monitor,
          latency: summarizeLatency(beats),
          beats: { returned: beats.length, oldestAt: beats[0]?.at ?? null, newestAt: beats[beats.length - 1]?.at ?? null },
          freshness: board.freshness,
        },
      }
    }),
}
