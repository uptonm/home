import type { CommandSpec } from '../../../core/types'
import { AUTH_BEATS_MAX, normalizeAuthBeats, summarizeLatency } from '../adapter'
import { fetchBoard, freshnessFrom, openTransport, parseBoundedInt, pickMonitor, privateDataOrError, runKumaCommand } from './shared'

const BEATS_DEFAULT = 20

export const heartbeatsListCmd: CommandSpec = {
  path: ['heartbeats', 'list'],
  effect: 'read',
  description:
    'Recent checks for one monitor — status, timestamp, latency, failure message (mode=authenticated-socket only)',
  args: [
    { name: 'monitor', kind: 'positional', description: 'Monitor id or exact name', required: true },
    { name: 'since', kind: 'string', description: 'Only beats at or after this ISO 8601 timestamp' },
    {
      name: 'limit',
      kind: 'number',
      description: `Max beats returned, newest kept (default ${BEATS_DEFAULT}, cap ${AUTH_BEATS_MAX})`,
    },
  ],
  examples: [
    'home uptime-kuma heartbeats list caddy --json',
    'home uptime-kuma heartbeats list 3 --since 2026-07-17T00:00:00Z --limit 50 --json',
  ],
  run: (ctx) =>
    runKumaCommand(async () => {
      const ref = String(ctx.args.monitor ?? '').trim()
      if (!ref) return { ok: false, kind: 'user', message: 'monitor id or name is required', code: 'missing_arg' }

      let sinceIso: string | null = null
      if (ctx.args.since !== undefined) {
        const parsed = new Date(String(ctx.args.since))
        if (Number.isNaN(parsed.getTime())) {
          return { ok: false, kind: 'user', message: `--since must be an ISO 8601 timestamp, got "${ctx.args.since}"`, code: 'bad_arg' }
        }
        sinceIso = parsed.toISOString()
      }
      const limit = parseBoundedInt(ctx, 'limit', BEATS_DEFAULT, AUTH_BEATS_MAX)
      if (!limit.ok) return limit.error

      const { cfg, t } = openTransport(ctx)
      const priv = privateDataOrError(cfg, t)
      if (!priv.ok) return priv.error

      const board = await fetchBoard(t, cfg.statusPageSlug)
      const picked = pickMonitor(board.monitors, ref)
      if (!picked.ok) return picked.error

      const all = normalizeAuthBeats(await priv.data.monitorBeats(picked.monitor.id))
      const inWindow = sinceIso === null ? all : all.filter((b) => b.at !== null && b.at >= sinceIso)
      const beats = inWindow.slice(-limit.value)
      return {
        ok: true,
        data: {
          monitor: { id: picked.monitor.id, name: picked.monitor.name, type: picked.monitor.type, url: picked.monitor.url },
          beats,
          returned: beats.length,
          available: all.length,
          latency: summarizeLatency(beats),
          freshness: freshnessFrom(t, [all]),
        },
      }
    }),
}
