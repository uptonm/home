import type { ModuleManifest } from '../../core/types'
import { listSites, readUnifiConfig } from './client'
import { devicesGet, devicesList } from './commands/devices'
import { clientsList } from './commands/clients'
import { siteHealthCmd, siteInfoCmd } from './commands/site'

export const manifest: ModuleManifest = {
  name: 'unifi',
  description: 'Query the UniFi Network controller (devices, clients, sites, health)',
  whenToUse:
    'Use when the user asks about their home network, wifi, APs, switches, the gateway, or wired/wireless clients. Do not use for cameras (that is `home-protect`) or sensors/automations (that is `home-assistant`).',
  configSchema: [
    {
      key: 'url',
      label: 'UniFi controller URL (e.g. https://10.0.0.1)',
      kind: 'url',
      required: true,
    },
    {
      key: 'apiKey',
      label: 'UniFi Network API key',
      kind: 'secret',
      required: true,
      help: 'Site Manager → Settings → Admins → API Keys',
    },
    {
      key: 'site',
      label: 'Site name (internal id, usually "default")',
      kind: 'string',
      default: 'default',
    },
    {
      key: 'insecureTLS',
      label: 'Allow self-signed TLS certificate?',
      kind: 'boolean',
      default: true,
      help: 'UniFi controllers ship with self-signed certs by default',
    },
  ],
  commands: [devicesList, devicesGet, clientsList, siteInfoCmd, siteHealthCmd],
  async status(cfg) {
    try {
      const sites = await listSites(readUnifiConfig(cfg))
      return { ok: true, data: { sites: sites.length, status: 'reachable' } }
    } catch (err) {
      return {
        ok: false,
        kind: 'system',
        message: (err as Error).message,
        code: 'status_failed',
      }
    }
  },
}

export default manifest
