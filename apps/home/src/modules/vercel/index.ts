import type { ModuleManifest } from '../../core/types'
import { listTeams, listProjects, listDeployments, readVercelConfig, listSharedEnv } from './client'
import { hasToken } from './auth'
import { configPushCmd } from './commands/config-push'
import { configPullCmd } from './commands/config-pull'
import { configDiffCmd } from './commands/config-diff'
import { projectsListCmd, projectsGetCmd } from './commands/projects'
import { deploymentsListCmd, deploymentsGetCmd, deploymentsEventsCmd } from './commands/deployments'
import { domainsListCmd, domainsGetCmd } from './commands/domains'
import { decodeKey } from './sync'

export const manifest: ModuleManifest = {
  name: 'vercel',
  description:
    'Read Vercel projects, deployments, and domains, and share `home` config and secrets between machines via shared environment variables',
  whenToUse:
    'Use for anything on your Vercel team: check what deployed and whether it succeeded (`deployments list/get`, normalized states queued/building/ready/error/canceled), read a failing build\'s log lines (`deployments events`), inspect a project\'s framework, linked repo, and targets (`projects list/get`), or see how a domain is attached and verified (`domains list/get`). All of that is read-only — this module never deploys or mutates Vercel. Separately, the `config` commands sync the home CLI\'s own config and secrets between machines using Vercel *shared* environment variables as the store — they do not touch any Vercel project\'s environment variables. `home vercel config push` uploads this host\'s module config and secrets, `config pull` applies them on another host, `config diff` compares without writing; both directions are additive. Authentication comes from `vercel login` (or VERCEL_TOKEN); host-specific settings such as the sonos speaker subnet are never synced.',
  configSchema: [
    {
      key: 'teamSlug',
      label: 'Vercel team',
      kind: 'enum',
      required: true,
      help: 'The team whose projects, deployments, and shared environment variables this module reads. Requires `vercel login` first.',
      dynamicEnum: async () => {
        const teams = await listTeams()
        return teams.map((t) => ({ value: t.slug, label: t.name ?? t.slug, hint: t.slug }))
      },
    },
    {
      key: 'defaultProject',
      label: 'Default project',
      kind: 'enum',
      required: false,
      help: 'Optional: project whose newest production deployment `home vercel status` reports. Pick (none) to skip.',
      dynamicEnum: async (partial) => {
        const teamSlug = String(partial.teamSlug ?? '').trim()
        const none = { value: '', label: '(none)', hint: 'skip deployment status' }
        if (!teamSlug) return [none]
        const projects = await listProjects({ teamSlug }, 100)
        return [none, ...projects.map((p) => ({ value: p.name, hint: p.id }))]
      },
    },
  ],
  commands: [
    projectsListCmd,
    projectsGetCmd,
    deploymentsListCmd,
    deploymentsGetCmd,
    deploymentsEventsCmd,
    domainsListCmd,
    domainsGetCmd,
    configPushCmd,
    configPullCmd,
    configDiffCmd,
  ],
  async status(cfg) {
    if (!hasToken()) {
      return { ok: false, kind: 'config', message: 'not logged in — run `vercel login`, or set VERCEL_TOKEN', code: 'vercel_no_token' }
    }
    try {
      const vc = readVercelConfig(cfg)
      const all = await listSharedEnv(vc)
      const ours = all.filter((e) => decodeKey(e.key) !== null)
      const data: Record<string, unknown> = { team: vc.teamSlug, homeVariables: ours.length }
      if (vc.defaultProject) {
        const [latest] = await listDeployments(vc, { project: vc.defaultProject, target: 'production', limit: 1 })
        data.production = latest
          ? { project: vc.defaultProject, deploymentId: latest.id, state: latest.state, url: latest.url, createdAt: latest.createdAt }
          : { project: vc.defaultProject, state: 'unknown', note: 'no production deployments found' }
      }
      return { ok: true, data }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
