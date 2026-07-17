import type { CommandSpec } from '../../../core/types'
import { getSharedEnvValues, listSharedEnv, readVercelConfig } from '../client'
import { collectLocal, decodeKey, fieldFor } from '../sync'

export const envDiffCmd: CommandSpec = {
  path: ['env', 'diff'],
  description: 'Compare this host\'s config and secrets against Vercel without writing either side',
  args: [],
  examples: [
    'home vercel env diff',
    'home vercel env diff --json',
  ],
  async run(ctx) {
    try {
      const cfg = readVercelConfig(ctx.config)
      const local = collectLocal()
      const remoteSummaries = await listSharedEnv(cfg)
      const ours = remoteSummaries.filter((e) => decodeKey(e.key) !== null)
      const remoteValues = await getSharedEnvValues(cfg, ours)

      const localByKey = new Map(local.map((e) => [e.key, e] as const))

      const onlyLocal: string[] = []
      const differs: string[] = []
      const same: string[] = []
      for (const entry of local) {
        if (!remoteValues.has(entry.key)) onlyLocal.push(`${entry.module}.${entry.field}`)
        else if (remoteValues.get(entry.key) !== entry.value) differs.push(`${entry.module}.${entry.field}`)
        else same.push(`${entry.module}.${entry.field}`)
      }

      const onlyRemote: string[] = []
      const unknownRemote: string[] = []
      for (const key of remoteValues.keys()) {
        if (localByKey.has(key)) continue
        const decoded = decodeKey(key)!
        const label = `${decoded.module}.${decoded.field}`
        if (fieldFor(decoded.module, decoded.field)) onlyRemote.push(label)
        else unknownRemote.push(label)
      }

      // Values are deliberately never emitted — several of these are secrets.
      return {
        ok: true,
        data: {
          onlyLocal,
          onlyRemote,
          differs,
          same,
          unknownRemote,
          hint:
            onlyLocal.length || differs.length
              ? 'run `home vercel env push` to upload local values'
              : onlyRemote.length
                ? 'run `home vercel env pull` to apply remote values'
                : 'in sync',
        },
      }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'env_diff_failed' }
    }
  },
}
