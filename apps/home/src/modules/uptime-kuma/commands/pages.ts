import type { CommandSpec } from '../../../core/types'
import { normalizeStatusPage } from '../adapter'
import { openTransport, runKumaCommand } from './shared'

export const pagesGetCmd: CommandSpec = {
  path: ['pages', 'get'],
  effect: 'read',
  description:
    'Status-page metadata: title, description, monitor groups, published incident, active maintenance windows',
  args: [
    {
      name: 'slug',
      kind: 'positional',
      description: 'Status page slug (defaults to the configured statusPageSlug)',
      required: false,
    },
  ],
  examples: ['home uptime-kuma pages get --json', 'home uptime-kuma pages get public --json'],
  run: (ctx) =>
    runKumaCommand(async () => {
      const { cfg, t } = openTransport(ctx)
      const slug = String(ctx.args.slug ?? cfg.statusPageSlug).trim() || cfg.statusPageSlug
      const page = normalizeStatusPage(await t.getStatusPage(slug))
      const data: Record<string, unknown> = {
        slug: page.slug ?? slug,
        title: page.title,
        description: page.description,
        published: page.published,
        showCertificateExpiry: page.showCertificateExpiry,
        groups: page.groups,
        incident: page.incident,
        maintenances: page.maintenances,
        // This command reads only the page config route — no beats seen.
        freshness: { cachedTransport: t.cachedTransport, newestBeatAt: null },
      }
      const slugRequested = typeof ctx.args.slug === 'string' && ctx.args.slug.trim() !== ''
      if (slugRequested && t.privateData !== null) {
        // The authenticated socket has no per-slug read — it serves one
        // synthesized all-monitors page — so a requested slug can't be honored.
        data.note = `mode=${cfg.mode} serves only the synthesized all-monitors page; the "${ctx.args.slug}" slug was ignored — use mode=public-status to read a specific status page`
      }
      return { ok: true, data }
    }),
}
