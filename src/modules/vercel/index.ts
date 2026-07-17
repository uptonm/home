import type { ModuleManifest } from '../../core/types'
import { listTeams, readVercelConfig, listSharedEnv } from './client'
import { hasToken } from './auth'
import { envPushCmd } from './commands/env-push'
import { envPullCmd } from './commands/env-pull'
import { envDiffCmd } from './commands/env-diff'
import { decodeKey } from './sync'

export const manifest: ModuleManifest = {
  name: 'vercel',
  description: 'Share `home` config and secrets between machines via Vercel shared environment variables',
  whenToUse:
    'Use to keep the same `home` setup on more than one machine. `home vercel env push` uploads this host\'s module config and secrets to your Vercel team as shared environment variables; `home vercel env pull` applies them on another host; `home vercel env diff` compares the two without writing. Both directions are additive — neither deletes anything the other side lacks. Authentication comes from `vercel login` (or VERCEL_TOKEN); host-specific settings such as the sonos speaker subnet are never synced. Do not use for deploying to Vercel — this module only reads and writes shared environment variables.',
  configSchema: [
    {
      key: 'teamSlug',
      label: 'Vercel team',
      kind: 'enum',
      required: true,
      help: 'The team whose shared environment variables hold your `home` config. Requires `vercel login` first.',
      dynamicEnum: async () => {
        const teams = await listTeams()
        return teams.map((t) => ({ value: t.slug, label: t.name ?? t.slug, hint: t.slug }))
      },
    },
  ],
  commands: [envPushCmd, envPullCmd, envDiffCmd],
  async status(cfg) {
    if (!hasToken()) {
      return { ok: false, kind: 'config', message: 'not logged in — run `vercel login`, or set VERCEL_TOKEN', code: 'vercel_no_token' }
    }
    try {
      const vc = readVercelConfig(cfg)
      const all = await listSharedEnv(vc)
      const ours = all.filter((e) => decodeKey(e.key) !== null)
      return { ok: true, data: { team: vc.teamSlug, homeVariables: ours.length } }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
