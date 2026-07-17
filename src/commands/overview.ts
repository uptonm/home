import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { resolveModuleConfig } from '../core/citty'
import { HomeError, NotConfiguredError, UserError } from '../core/errors'
import { emit } from '../core/output'
import {
  composeOpsOverview,
  loadOpsConfig,
  type OpsBeszelData,
  type OpsContainer,
  type OpsMonitor,
  type OpsProbes,
  type OpsVercelProject,
} from '../core/overview'
import type { ModuleConfig, RunResult } from '../core/types'
import { moduleByName } from '../registry'
import { hasToken } from '../modules/vercel/auth'
import { listDeployments, readVercelConfig } from '../modules/vercel/client'
import { createKumaTransport, readKumaConfig } from '../modules/uptime-kuma/client'
import { fetchBoard } from '../modules/uptime-kuma/commands/shared'
import { createTransport, pbQuote, readBeszelConfig } from '../modules/beszel/client'
import { normalizeAlert, normalizeContainer } from '../modules/beszel/adapter'
import { fetchSystems } from '../modules/beszel/commands/shared'

const OPS_ALERTS_LIMIT = 100
const OPS_CONTAINERS_LIMIT = 100

function moduleConfigOrThrow(name: string): ModuleConfig {
  const cfg = resolveModuleConfig(moduleByName[name]!)
  if (!cfg) throw new NotConfiguredError(name)
  return cfg
}

/** Real module probes — direct client calls, no shelling out to `home`. */
const opsProbes: OpsProbes = {
  async vercel(projects) {
    const moduleCfg = moduleConfigOrThrow('vercel')
    if (!hasToken()) {
      throw new UserError('vercel: not logged in — run `vercel login`, or set VERCEL_TOKEN', 'vercel_no_token')
    }
    const cfg = readVercelConfig(moduleCfg)
    return Promise.all(
      projects.map(async (project): Promise<OpsVercelProject> => {
        const [latest] = await listDeployments(cfg, { project, target: 'production', limit: 1 })
        return {
          project,
          deployment: latest
            ? { id: latest.id, state: latest.state, url: latest.url, createdAt: latest.createdAt, commit: latest.commit }
            : null,
        }
      }),
    )
  },

  async kuma() {
    const cfg = readKumaConfig(moduleConfigOrThrow('uptime-kuma'))
    const board = await fetchBoard(createKumaTransport(cfg), cfg.statusPageSlug)
    return board.monitors.map(
      (m): OpsMonitor => ({
        id: m.id,
        name: m.name,
        status: m.status,
        latencyMs: m.latencyMs,
        lastBeatAt: m.lastBeatAt,
        uptime24hPct: m.uptime24hPct,
        certExpiryDays: m.certExpiryDays,
        validCert: m.validCert,
      }),
    )
  },

  async beszel(mappedSystems) {
    const t = createTransport(readBeszelConfig(moduleConfigOrThrow('beszel')))
    const [systems, alertsRaw] = await Promise.all([
      fetchSystems(t),
      t.list('alerts', OPS_ALERTS_LIMIT, { filter: 'triggered=true', sort: '-updated' }),
    ])
    const wanted = new Set(mappedSystems)
    const mapped = systems.filter((s) => wanted.has(s.id) || wanted.has(s.name))
    const containerLists = await Promise.all(
      mapped.map((s) => t.list('containers', OPS_CONTAINERS_LIMIT, { filter: `system=${pbQuote(s.id)}`, sort: 'name' })),
    )
    const containersBySystem: Record<string, OpsContainer[]> = {}
    mapped.forEach((s, i) => {
      containersBySystem[s.id] = containerLists[i]!.map(normalizeContainer).map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        health: c.health,
        cpuPct: c.cpuPct,
        memoryMb: c.memoryMb,
      }))
    })
    return {
      systems: systems.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        cpuPct: s.cpuPct,
        memoryPct: s.memoryPct,
        diskPct: s.diskPct,
      })),
      alerts: alertsRaw.map(normalizeAlert).map((a) => ({
        id: a.id,
        type: a.type,
        systemId: a.systemId,
        updatedAt: a.updatedAt,
      })),
      containersBySystem,
    } satisfies OpsBeszelData
  },
}

const opsArgs: ArgsDef = {
  project: { type: 'string', description: 'Only the mapping group whose vercelProject matches' },
  json: { type: 'boolean', description: 'Emit JSON to stdout' },
}

export const overviewCmd: CommandDef = defineCommand({
  meta: { name: 'overview', description: 'Cross-module composite overviews' },
  subCommands: {
    ops: defineCommand({
      meta: {
        name: 'ops',
        description:
          'Operational overview (read-only): latest Vercel production deployments, Uptime Kuma monitor state, Beszel systems with active alerts',
      },
      args: opsArgs,
      async run({ args }) {
        const raw = args as Record<string, unknown>
        const project = typeof raw.project === 'string' && raw.project.trim() !== '' ? raw.project.trim() : undefined
        let result: RunResult
        try {
          result = await composeOpsOverview(loadOpsConfig(), opsProbes, { project })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          result =
            err instanceof UserError
              ? { ok: false, kind: 'user', message, code: err.code }
              : { ok: false, kind: 'system', message, code: err instanceof HomeError ? err.code : 'run_failed' }
        }
        await emit(result, { json: Boolean(raw.json) })
      },
    }),
  },
})
