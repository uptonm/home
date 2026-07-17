import type { ModuleManifest } from '../../core/types'
import { createKumaTransport, readKumaConfig, KUMA_MODES } from './client'
import { summarizeHeartbeats } from './commands/shared'
import { pagesGetCmd } from './commands/pages'
import { monitorsGetCmd, monitorsListCmd } from './commands/monitors'
import { incidentsListCmd, maintenancesListCmd } from './commands/incidents'
import { summaryCmd } from './commands/summary'
import { heartbeatsListCmd } from './commands/heartbeats'
import { certificatesListCmd } from './commands/certificates'

const CONFIG_CODES = new Set([
  'kuma_not_configured',
  'kuma_page_not_found',
  'kuma_auth_failed',
  'kuma_2fa_unsupported',
  'kuma_untested_version',
])
const SYSTEM_CODES = new Set(['kuma_unreachable', 'kuma_api_failed', 'kuma_socket_failed'])

export const manifest: ModuleManifest = {
  name: 'uptime-kuma',
  description: 'Query Uptime Kuma service monitoring — endpoint reachability, latency, certificates, incidents, maintenance',
  whenToUse:
    'Use when the user asks "can a user or dependent system reach the service?": which monitored endpoints are up or down, response latency, TLS certificate expiry, published incidents, and maintenance windows. Uptime Kuma owns synthetic reachability from the outside; when a service is down, the host/container cause (CPU, memory, disk, docker health) is beszel\'s job, and network gear belongs to `home-unifi`. Two access modes: `public-status` reads the public status page (server-side cached — results can trail reality by ~5 minutes) and sees only monitors published there; `authenticated-socket` logs in over Socket.IO (one-shot, no daemon) and reads every monitor live, plus per-check heartbeats and stored TLS certificates. Every command reports data staleness via `freshness` (`cachedTransport` + newest heartbeat timestamp). Read-only — it never mutates the instance. 2FA accounts are not supported in authenticated mode (`kuma_2fa_unsupported`).',
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
      help: 'public-status reads the public status page without credentials (cached, published monitors only); authenticated-socket logs in over Socket.IO and reads all monitors live',
    },
    {
      key: 'statusPageSlug',
      label: 'Status page slug',
      kind: 'string',
      help: 'required when mode=public-status — the slug in /status/<slug> on the instance',
    },
    {
      key: 'username',
      label: 'Uptime Kuma username',
      kind: 'string',
      help: 'required when mode=authenticated-socket — accounts with 2FA enabled are not supported',
    },
    {
      key: 'password',
      label: 'Uptime Kuma password',
      kind: 'secret',
      help: 'required when mode=authenticated-socket',
    },
    {
      key: 'allowUnsupported',
      label: 'Allow untested Uptime Kuma versions?',
      kind: 'boolean',
      default: false,
      help: 'authenticated-socket refuses servers outside the tested 1.23.x series unless this is set',
    },
    {
      key: 'insecureTLS',
      label: 'Allow self-signed TLS certificate?',
      kind: 'boolean',
      default: false,
    },
  ],
  commands: [
    pagesGetCmd,
    monitorsListCmd,
    monitorsGetCmd,
    heartbeatsListCmd,
    certificatesListCmd,
    incidentsListCmd,
    maintenancesListCmd,
    summaryCmd,
  ],
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
          statusPageSlug: kumaCfg.statusPageSlug || null,
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
