import type { ModuleManifest } from '../../core/types'
import { defaultControllerUrl } from '../../core/net'
import { listSites, readUnifiConfig } from './client'
import { devicesGet, devicesList } from './commands/devices'
import { devicesPoeCycle } from './commands/poe-cycle'
import { clientsList, clientsGet } from './commands/clients'
import { clientsControl } from './commands/client-control'
import { siteHealthCmd, siteInfoCmd } from './commands/site'
import { networksList, networksGet } from './commands/networks'
import { reservationsList } from './commands/reservations'
import { wlansGet, wlansList } from './commands/wlans'
import { portForwardsList } from './commands/port-forwards'
import { firewallGet, firewallList } from './commands/firewall'
import { controllerInfoCmd } from './commands/controller'
import { healthCmd } from './commands/health'

export const manifest: ModuleManifest = {
  name: 'unifi',
  description:
    'Query the UniFi Network controller (devices, clients, networks/VLANs, fixed-IP reservations, SSIDs, port forwards, firewall rules, health)',
  whenToUse:
    'Use when the user asks about their home network, wifi, APs, switches, the gateway, wired/wireless clients, VLANs/subnets, fixed-IP (DHCP) reservations, SSIDs, port forwards, or firewall rules. Do not use for cameras (that is `home-protect`) or sensors/automations (that is `home-assistant`).',
  configSchema: [
    {
      key: 'url',
      label: 'UniFi controller URL',
      kind: 'url',
      required: true,
      default: defaultControllerUrl,
    },
    {
      key: 'insecureTLS',
      label: 'Allow self-signed TLS certificate?',
      kind: 'boolean',
      default: false,
      help: 'UniFi controllers ship with self-signed certs — answer yes only if you have not installed a real cert',
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
      label: 'Site',
      kind: 'enum',
      required: true,
      default: 'default',
      async dynamicEnum(partial) {
        const sites = (await listSites(readUnifiConfig(partial))) as { name?: string; desc?: string }[]
        return sites
          .filter((s) => s.name)
          .map((s) => ({
            value: s.name as string,
            label: s.desc ? `${s.desc} (${s.name})` : (s.name as string),
          }))
      },
    },
  ],
  commands: [
    devicesList,
    devicesGet,
    devicesPoeCycle,
    clientsList,
    clientsGet,
    clientsControl,
    siteInfoCmd,
    siteHealthCmd,
    networksList,
    networksGet,
    reservationsList,
    wlansList,
    wlansGet,
    portForwardsList,
    firewallList,
    firewallGet,
    controllerInfoCmd,
    healthCmd,
  ],
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
