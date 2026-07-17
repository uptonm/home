import type { ModuleManifest } from '../../core/types'
import { createTransport, readBeszelConfig } from './client'
import { systemsGetCmd, systemsListCmd } from './commands/systems'
import { containersGetCmd, containersListCmd } from './commands/containers'
import { containerMetricsGetCmd, metricsGetCmd } from './commands/metrics'
import { smartGetCmd } from './commands/smart'
import { alertsListCmd } from './commands/alerts'
import { overviewCmd } from './commands/overview'
import { fetchSystems, summarizeSystems } from './commands/shared'

const AUTH_CODES = new Set(['beszel_auth_failed', 'beszel_auth_unavailable', 'beszel_not_configured'])

export const manifest: ModuleManifest = {
  name: 'beszel',
  description: 'Query Beszel server monitoring — host and container status, resource pressure, and alerts',
  whenToUse:
    'Use when the user asks "what is wrong with the machine or container?": which hosts are up or down, CPU/memory/disk pressure, load average, per-container resource usage and docker health, bounded metric history over time (system or per-container), disk SMART health, or which Beszel alerts are firing. Beszel owns hosts, containers, disks, and resource pressure. Synthetic service availability (is a URL or service responding) is uptime-kuma\'s job, not this module\'s; network gear belongs to `home-unifi`. Read-only — it never mutates the hub.',
  configSchema: [
    {
      key: 'url',
      label: 'Beszel hub URL',
      kind: 'url',
      required: true,
      default: 'http://localhost:8090',
    },
    {
      key: 'email',
      label: 'Beszel user email',
      kind: 'string',
      required: true,
      help: 'a regular hub user that can log in with a password — OIDC-only accounts cannot authenticate here',
    },
    {
      key: 'password',
      label: 'Beszel user password',
      kind: 'secret',
      required: true,
    },
    {
      key: 'insecureTLS',
      label: 'Allow self-signed TLS certificate?',
      kind: 'boolean',
      default: false,
    },
  ],
  commands: [
    systemsListCmd,
    systemsGetCmd,
    containersListCmd,
    containersGetCmd,
    metricsGetCmd,
    containerMetricsGetCmd,
    smartGetCmd,
    alertsListCmd,
    overviewCmd,
  ],
  async status(cfg) {
    try {
      const t = createTransport(readBeszelConfig(cfg))
      const systems = summarizeSystems(await fetchSystems(t))
      const activeAlerts = await t.count('alerts', 'triggered=true')
      // A down system is a finding, not a failure — report it as data.
      return { ok: true, data: { systems, activeAlerts } }
    } catch (err) {
      const code = (err as { code?: string }).code
      const message = (err as Error).message
      if (code && AUTH_CODES.has(code)) return { ok: false, kind: 'config', message, code }
      if (code === 'beszel_incompatible_version') return { ok: false, kind: 'system', message, code }
      return { ok: false, kind: 'system', message, code: 'status_failed' }
    }
  },
}

export default manifest
