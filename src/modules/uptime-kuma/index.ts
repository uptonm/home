import type { ModuleManifest } from '../../core/types'
import { createKumaTransport, readKumaConfig, KUMA_MODES } from './client'
import { summarizeHeartbeats } from './commands/shared'
import { pagesGetCmd } from './commands/pages'
import { monitorsGetCmd, monitorsListCmd } from './commands/monitors'
import { incidentsListCmd, maintenancesListCmd } from './commands/incidents'
import { summaryCmd } from './commands/summary'

const CONFIG_CODES = new Set(['kuma_not_configured', 'kuma_mode_unsupported', 'kuma_page_not_found'])
const SYSTEM_CODES = new Set(['kuma_unreachable', 'kuma_api_failed'])

export const manifest: ModuleManifest = {
  name: 'uptime-kuma',
  description: 'Query Uptime Kuma service monitoring — endpoint reachability, latency, certificates, incidents, maintenance',
  whenToUse:
    'Use when the user asks "can a user or dependent system reach the service?": which monitored endpoints are up or down, response latency, TLS certificate expiry, published incidents, and maintenance windows. Uptime Kuma owns synthetic reachability from the outside; when a service is down, the host/container cause (CPU, memory, disk, docker health) is beszel\'s job, and network gear belongs to `home-unifi`. Data comes from the public status page, which is server-side cached — results can trail reality by ~5 minutes, and every command reports this via `freshness` (newest heartbeat timestamp + `cachedTransport: true`). Read-only — it never mutates the instance.',
  configSchema: [
    {
      key: 'url',
      label: 'Uptime Kuma URL',
      kind: 'url',
      required: true,
      default: 'http://localhost:3001',
    },
    {
      key: 'mode',
      label: 'Access mode',
      kind: 'enum',
      required: true,
      enum: KUMA_MODES,
      default: 'public-status',
      help: 'public-status reads the public status page; authenticated-socket arrives in a later release and is rejected at runtime for now',
    },
    {
      key: 'statusPageSlug',
      label: 'Status page slug',
      kind: 'string',
      help: 'required when mode=public-status — the slug in /status/<slug> on the instance',
    },
    {
      key: 'insecureTLS',
      label: 'Allow self-signed TLS certificate?',
      kind: 'boolean',
      default: false,
    },
  ],
  commands: [pagesGetCmd, monitorsListCmd, monitorsGetCmd, incidentsListCmd, maintenancesListCmd, summaryCmd],
  async status(cfg) {
    try {
      const kumaCfg = readKumaConfig(cfg)
      const t = createKumaTransport(kumaCfg)
      const summary = summarizeHeartbeats(t, await t.getHeartbeats(kumaCfg.statusPageSlug))
      return {
        ok: true,
        data: {
          mode: kumaCfg.mode,
          url: kumaCfg.url,
          statusPageSlug: kumaCfg.statusPageSlug,
          monitors: summary.monitors,
          worst: summary.worst,
          freshness: summary.freshness,
        },
      }
    } catch (err) {
      const code = (err as { code?: string }).code
      const message = (err as Error).message
      // kuma_page_not_found means the instance answered — its message names the
      // configured slug and says "reachable", distinct from kuma_unreachable.
      if (code && CONFIG_CODES.has(code)) return { ok: false, kind: 'config', message, code }
      if (code && SYSTEM_CODES.has(code)) return { ok: false, kind: 'system', message, code }
      return { ok: false, kind: 'system', message, code: 'status_failed' }
    }
  },
}

export default manifest
