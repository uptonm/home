import type { CommandSpec } from '../../../core/types'
import { discover, readSonosConfig, summarizePlayer, withRoom, type PlayerSummary } from '../client'

export const playersList: CommandSpec = {
  path: ['players', 'list'],
  effect: 'read',
  description: 'List all Sonos players discovered on the network',
  args: [],
  examples: [
    'home sonos players list',
    'home sonos players list --json | jq \'.[] | select(.isCoordinator)\'',
  ],
  async run(ctx) {
    const mgr = await discover(readSonosConfig(ctx.config))
    const data = mgr.Devices.map(summarizePlayer).sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}

export interface PlayerDetail extends PlayerSummary {
  model?: string
  modelNumber?: string
  manufacturer?: string
  serial?: string
  softwareVersion?: string
  hardwareVersion?: string
  ip?: string
  mac?: string
  /** LED indicator: true = on, false = off, undefined = speaker didn't report. */
  ledOn?: boolean
  icon?: string
}

/**
 * Merge the topology summary with the per-device detail responses into one flat
 * record. Pure (no I/O) so it's unit-testable; the command does the fetching.
 *
 * `GetZoneInfo` and `GetDeviceDescription` overlap on serial / software /
 * hardware version — prefer `GetZoneInfo` (the lighter call) and fall back to
 * the device description, so a speaker that fails one call still reports the
 * field from the other.
 */
export function buildPlayerDetail(
  summary: PlayerSummary,
  parts: {
    zoneInfo?: { SerialNumber?: string; SoftwareVersion?: string; HardwareVersion?: string; IPAddress?: string; MACAddress?: string } | null
    desc?: { manufacturer?: string; modelName?: string; modelNumber?: string; softwareVersion?: string; hardwareVersion?: string; serialNumber?: string } | null
    ledState?: string
    icon?: string
  },
): PlayerDetail {
  const { zoneInfo, desc } = parts
  return {
    ...summary,
    model: desc?.modelName,
    modelNumber: desc?.modelNumber,
    manufacturer: desc?.manufacturer,
    serial: zoneInfo?.SerialNumber ?? desc?.serialNumber,
    softwareVersion: zoneInfo?.SoftwareVersion ?? desc?.softwareVersion,
    hardwareVersion: zoneInfo?.HardwareVersion ?? desc?.hardwareVersion,
    ip: zoneInfo?.IPAddress ?? summary.host,
    mac: zoneInfo?.MACAddress,
    ledOn: parts.ledState === undefined ? undefined : parts.ledState === 'On',
    icon: parts.icon,
  }
}

export const playersGet: CommandSpec = {
  path: ['players', 'get'],
  effect: 'read',
  description: 'Get full detail for one player: model, IP, MAC, serial, software/hardware version, LED state, and group membership (beyond what `players list` shows)',
  args: [{ name: 'room', kind: 'positional', description: 'Room name (case-insensitive, partial match)', required: true }],
  examples: [
    'home sonos players get kitchen',
    'home sonos players get "living room" --json',
  ],
  async run(ctx) {
    return withRoom(ctx, { pick: 'device', required: true }, async (d) => {
      // Each call is best-effort: older / partnered speakers fail some of these,
      // and one missing field shouldn't sink the whole detail view.
      const [zoneInfo, attrs, led, desc] = await Promise.all([
        d.DevicePropertiesService.GetZoneInfo().catch(() => null),
        d.DevicePropertiesService.GetZoneAttributes().catch(() => null),
        d.DevicePropertiesService.GetLEDState().catch(() => null),
        d.GetDeviceDescription().catch(() => null),
      ])
      const detail = buildPlayerDetail(summarizePlayer(d), {
        zoneInfo,
        desc,
        ledState: led?.CurrentLEDState,
        icon: attrs?.CurrentIcon,
      })
      return { ok: true, data: detail }
    })
  },
}
