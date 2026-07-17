import type { ModuleManifest } from '../../core/types'
import { listTeams, readVercelConfig, listSharedEnv } from './client'
import { hasToken } from './auth'
import { configPushCmd } from './commands/config-push'
import { configPullCmd } from './commands/config-pull'
import { configDiffCmd } from './commands/config-diff'
import { decodeKey } from './sync'

export const manifest: ModuleManifest = {
  name: 'vercel',
  description: 'Share `home` config and secrets between machines via Vercel shared environment variables',
  whenToUse:
    'Use to keep the same `home` setup on more than one machine. The `config` commands sync the home CLI\'s own config and secrets, using Vercel *shared* environment variables as the store — they do not touch any Vercel project\'s environment variables. `home vercel config push` uploads this host\'s module config and secrets to your Vercel team; `home vercel config pull` applies them on another host; `home vercel config diff` compares the two without writing. Both directions are additive — neither deletes anything the other side lacks. Authentication comes from `vercel login` (or VERCEL_TOKEN); host-specific settings such as the sonos speaker subnet are never synced. Do not use for deploying to Vercel.',
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
  commands: [configPushCmd, configPullCmd, configDiffCmd],
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
