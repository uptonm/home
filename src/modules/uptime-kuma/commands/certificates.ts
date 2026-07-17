import type { CommandSpec } from '../../../core/types'
import { normalizeCertificate, normalizeStatusPage, type KumaCertificate } from '../adapter'
import { openTransport, parseBoundedInt, privateDataOrError, runKumaCommand } from './shared'

/** No --days ⇒ every stored cert; the cap only bounds nonsense input. */
const DAYS_MAX = 3650

export const certificatesListCmd: CommandSpec = {
  path: ['certificates', 'list'],
  effect: 'read',
  description:
    'TLS certificates Kuma has stored for monitored endpoints — validity, days remaining, expiry (mode=authenticated-socket only)',
  args: [
    {
      name: 'days',
      kind: 'number',
      description: 'Only certs expiring within N days; invalid certs are always included',
    },
  ],
  examples: ['home uptime-kuma certificates list --json', 'home uptime-kuma certificates list --days 30 --json'],
  run: (ctx) =>
    runKumaCommand(async () => {
      const days = parseBoundedInt(ctx, 'days', 0, DAYS_MAX)
      if (!days.ok) return days.error
      const maxDays = ctx.args.days === undefined ? null : days.value

      const { cfg, t } = openTransport(ctx)
      const priv = privateDataOrError(cfg, t)
      if (!priv.ok) return priv.error

      const page = normalizeStatusPage(await t.getStatusPage(cfg.statusPageSlug))
      const nameById = new Map<string, string>()
      for (const group of page.groups) {
        for (const monitor of group.monitors) nameById.set(monitor.id, monitor.name)
      }

      const certificates: (KumaCertificate & { monitorName: string | null })[] = []
      for (const [monitorId, raw] of Object.entries(await priv.data.certificates())) {
        const cert = normalizeCertificate(monitorId, raw)
        const expiring = maxDays === null || (cert.daysRemaining !== null && cert.daysRemaining <= maxDays)
        if (cert.valid === false || expiring) {
          certificates.push({ ...cert, monitorName: nameById.get(monitorId) ?? null })
        }
      }
      certificates.sort((a, b) => (a.daysRemaining ?? Number.MAX_SAFE_INTEGER) - (b.daysRemaining ?? Number.MAX_SAFE_INTEGER))
      return {
        ok: true,
        data: { certificates, freshness: { cachedTransport: t.cachedTransport, newestBeatAt: null } },
      }
    }),
}
