import type { ModuleManifest } from '../../core/types'
import { defaultControllerUrl } from '../../core/net'
import { listSites, readUnifiConfig } from './client'
import { devicesGet, devicesList, devicesRestart, devicesStats } from './commands/devices'
import { devicesPoeCycle } from './commands/poe-cycle'
import { clientsList, clientsGet } from './commands/clients'
import { clientsControl, clientsAuthorizeGuest } from './commands/client-control'
import { vouchersCreate, vouchersDelete, vouchersGet, vouchersList } from './commands/vouchers'
import { siteHealthCmd, siteInfoCmd } from './commands/site'
import { networksList, networksGet } from './commands/networks'
import { reservationsGet, reservationsList } from './commands/reservations'
import { wlansGet, wlansList } from './commands/wlans'
import { portForwardsGet, portForwardsList } from './commands/port-forwards'
import { firewallGet, firewallList } from './commands/firewall'
import { firewallGroupsList, firewallGroupsGet } from './commands/firewall-groups'
import { portProfilesList, portProfilesGet } from './commands/port-profiles'
import { wlanGroupsList, wlanGroupsGet } from './commands/wlan-groups'
import { userGroupsList, userGroupsGet } from './commands/user-groups'
import { radiusProfilesList, radiusProfilesGet } from './commands/radius-profiles'
import { routesList, routesGet } from './commands/routes'
import { dpiAppsList, dpiAppsGet } from './commands/dpi-apps'
import { dpiGroupsList, dpiGroupsGet } from './commands/dpi-groups'
import { radiusAccountsList, radiusAccountsGet } from './commands/radius-accounts'
import { dynamicDnsList } from './commands/dynamic-dns'
import { settingsList, settingsGet } from './commands/settings'
import { clientsAll, dpiStatsClient, dpiStatsSite, eventsList, alarmsList, rogueApsList, guestsList } from './commands/operational'
import { integrationAppInfo } from './integration-client'
import { controllerInfoCmd } from './commands/controller'
import { healthCmd } from './commands/health'

export const manifest: ModuleManifest = {
  name: 'unifi',
  description:
    'Query and act on the UniFi Network controller (devices, clients, networks/VLANs, fixed-IP reservations, SSIDs, port forwards, firewall rules, health, hotspot guest vouchers, and device/client actions)',
  whenToUse:
    'Use when the user asks about their home network, wifi, APs, switches, the gateway, wired/wireless clients, VLANs/subnets, fixed-IP (DHCP) reservations, SSIDs, port forwards, or firewall rules; or wants to restart a device, power-cycle a PoE port, authorize a guest client, or manage hotspot guest vouchers. Do not use for cameras (that is `home-protect`) or sensors/automations (that is `home-assistant`).',
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
      key: 'source',
      label: 'API source',
      kind: 'enum',
      enum: ['auto', 'network', 'integration'],
      default: 'auto',
      help: "auto: prefer private Network API, fallback to Integration on 401/403/404. network: private API only. integration: Integration API only.",
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
    devicesStats,
    devicesRestart,
    devicesPoeCycle,
    clientsList,
    clientsGet,
    clientsControl,
    clientsAuthorizeGuest,
    vouchersList,
    vouchersGet,
    vouchersCreate,
    vouchersDelete,
    siteInfoCmd,
    siteHealthCmd,
    networksList,
    networksGet,
    reservationsList,
    reservationsGet,
    wlansList,
    wlansGet,
    portForwardsList,
    portForwardsGet,
    firewallList,
    firewallGet,
    firewallGroupsList,
    firewallGroupsGet,
    portProfilesList,
    portProfilesGet,
    wlanGroupsList,
    wlanGroupsGet,
    userGroupsList,
    userGroupsGet,
    radiusProfilesList,
    radiusProfilesGet,
    routesList,
    routesGet,
    dpiAppsList,
    dpiAppsGet,
    dpiGroupsList,
    dpiGroupsGet,
    radiusAccountsList,
    radiusAccountsGet,
    dynamicDnsList,
    settingsList,
    settingsGet,
    clientsAll,
    eventsList,
    alarmsList,
    rogueApsList,
    guestsList,
    dpiStatsSite,
    dpiStatsClient,
    controllerInfoCmd,
    healthCmd,
  ],
  async status(cfg) {
    try {
      const sites = await listSites(readUnifiConfig(cfg))
      const info = await integrationAppInfo(readUnifiConfig(cfg))
      return { ok: true, data: { sites: sites.length, status: 'reachable', integration: info ? { version: info.version } : null } }
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
