import type { CommandSpec } from '../../../core/types'
import {
  createSharedEnv,
  getSharedEnvValues,
  listSharedEnv,
  readVercelConfig,
  updateSharedEnv,
  type NewSharedEnv,
  type SharedEnvUpdate,
} from '../client'
import { collectLocal, decodeKey } from '../sync'

export const envPushCmd: CommandSpec = {
  path: ['env', 'push'],
  description: 'Upload this host\'s config and secrets to Vercel shared environment variables',
  args: [
    { name: 'dry-run', kind: 'boolean', description: 'Report what would change without writing', required: false },
  ],
  examples: [
    'home vercel env push --dry-run',
    'home vercel env push',
    'home vercel env push --json',
  ],
  async run(ctx) {
    const dryRun = Boolean(ctx.args['dry-run'])
    try {
      const cfg = readVercelConfig(ctx.config)
      const local = collectLocal()
      if (local.length === 0) {
        return { ok: true, data: { created: [], updated: [], unchanged: [], note: 'nothing configured locally to push' } }
      }

      const remoteSummaries = await listSharedEnv(cfg)
      const ours = remoteSummaries.filter((e) => decodeKey(e.key) !== null)
      const remoteValues = await getSharedEnvValues(cfg, ours)
      const idByKey = new Map(ours.map((e) => [e.key, e.id] as const))

      const toCreate: NewSharedEnv[] = []
      const toUpdate: SharedEnvUpdate[] = []
      const created: string[] = []
      const updated: string[] = []
      const unchanged: string[] = []

      for (const entry of local) {
        const id = idByKey.get(entry.key)
        if (id === undefined) {
          toCreate.push({
            key: entry.key,
            value: entry.value,
            comment: `home cli: ${entry.module}.${entry.field}`,
          })
          created.push(entry.key)
        } else if (remoteValues.get(entry.key) !== entry.value) {
          toUpdate.push({ id, key: entry.key, value: entry.value })
          updated.push(entry.key)
        } else {
          unchanged.push(entry.key)
        }
      }

      if (!dryRun) {
        if (toCreate.length) await createSharedEnv(cfg, toCreate)
        await updateSharedEnv(cfg, toUpdate)
      }

      return { ok: true, data: { dryRun, created, updated, unchanged } }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'env_push_failed' }
    }
  },
}
