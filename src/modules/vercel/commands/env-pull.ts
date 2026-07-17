import type { CommandSpec } from '../../../core/types'
import { getSharedEnvValues, listSharedEnv, readVercelConfig } from '../client'
import { applyRemote, decodeKey } from '../sync'

export const envPullCmd: CommandSpec = {
  path: ['env', 'pull'],
  description: 'Apply Vercel shared environment variables to this host\'s config and secrets',
  args: [
    { name: 'dry-run', kind: 'boolean', description: 'Report what would change without writing', required: false },
  ],
  examples: [
    'home vercel env pull --dry-run',
    'home vercel env pull',
    'home vercel env pull --json',
  ],
  async run(ctx) {
    const dryRun = Boolean(ctx.args['dry-run'])
    try {
      const cfg = readVercelConfig(ctx.config)
      const remoteSummaries = await listSharedEnv(cfg)
      const ours = remoteSummaries.filter((e) => decodeKey(e.key) !== null)
      if (ours.length === 0) {
        return { ok: true, data: { applied: [], skipped: [], note: 'no home-cli variables found — run `home vercel env push` from a configured host first' } }
      }

      const values = await getSharedEnvValues(cfg, ours)
      const result = applyRemote(values, dryRun)

      const label = (a: { module: string; field: string; secret: boolean }) =>
        `${a.module}.${a.field}${a.secret ? ' (secret)' : ''}`
      return {
        ok: true,
        data: {
          dryRun,
          applied: result.applied.map(label),
          unchanged: result.unchanged.map(label),
          skipped: result.skipped,
        },
      }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'env_pull_failed' }
    }
  },
}
