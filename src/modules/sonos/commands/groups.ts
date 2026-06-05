import type SonosDevice from '@svrooij/sonos/lib/sonos-device'
import type { CommandSpec } from '../../../core/types'
import { discover, readSonosConfig, resolveRoom, summarizeGroups } from '../client'

export const groupsList: CommandSpec = {
  path: ['groups', 'list'],
  description: 'List Sonos groups (coordinator + members)',
  args: [],
  examples: [
    'home sonos groups list',
    'home sonos groups list --json',
  ],
  async run(ctx) {
    const mgr = await discover(readSonosConfig(ctx.config))
    const data = summarizeGroups(mgr.Devices).sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}

export type SelectGroup =
  | { kind: 'ok'; coordinator: SonosDevice; members: SonosDevice[]; name: string }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; candidates: string[] }

/**
 * Resolve a room reference to the whole group it belongs to: the coordinator
 * plus every member device. Pure (operates on the discovered device list) so
 * it's unit-testable; the command layer fetches per-member state.
 *
 * Members share a `GroupName` (the same key `summarizeGroups` groups on); the
 * coordinator is the member that is its own `Coordinator`.
 */
export function selectGroup(devices: SonosDevice[], ref: string): SelectGroup {
  const r = resolveRoom(devices, ref)
  if (r.kind === 'not_found') return { kind: 'not_found' }
  if (r.kind === 'ambiguous') return { kind: 'ambiguous', candidates: r.candidates }
  const name = r.device.GroupName ?? r.device.Name
  const members = devices.filter((d) => (d.GroupName ?? d.Name) === name)
  const coordinator = members.find((d) => d.Coordinator?.Uuid === d.Uuid) ?? r.device.Coordinator ?? r.device
  return { kind: 'ok', coordinator, members, name }
}

export const groupsGet: CommandSpec = {
  path: ['groups', 'get'],
  description: 'Get one group by room: coordinator, transport state, and every member with its per-device volume and mute',
  args: [{ name: 'room', kind: 'positional', description: 'Any room in the target group (case-insensitive, partial match)', required: true }],
  examples: [
    'home sonos groups get kitchen',
    'home sonos groups get "living room" --json',
  ],
  async run(ctx) {
    const ref = ctx.args.room ? String(ctx.args.room) : undefined
    if (!ref) return { ok: false, kind: 'user', message: 'room is required', code: 'missing_arg' }

    const mgr = await discover(readSonosConfig(ctx.config))
    const sel = selectGroup(mgr.Devices, ref)
    if (sel.kind === 'not_found') {
      return { ok: false, kind: 'user', message: `no room matching "${ref}"`, code: 'not_found' }
    }
    if (sel.kind === 'ambiguous') {
      return { ok: false, kind: 'user', message: `room is ambiguous — candidates: ${sel.candidates.join(', ')}`, code: 'ambiguous' }
    }

    const members = await Promise.all(
      sel.members.map(async (m) => {
        const [vol, mute] = await Promise.all([
          m.RenderingControlService.GetVolume({ InstanceID: 0, Channel: 'Master' }).catch(() => null),
          m.RenderingControlService.GetMute({ InstanceID: 0, Channel: 'Master' }).catch(() => null),
        ])
        return {
          name: m.Name,
          uuid: m.Uuid,
          host: m.Host,
          isCoordinator: m.Coordinator?.Uuid === m.Uuid,
          volume: vol?.CurrentVolume,
          muted: mute?.CurrentMute,
        }
      }),
    )
    const transport = await sel.coordinator.AVTransportService.GetTransportInfo().catch(() => null)

    return {
      ok: true,
      data: {
        name: sel.name,
        coordinator: sel.coordinator.Name,
        state: transport?.CurrentTransportState ?? 'UNKNOWN',
        members: members.sort((a, b) => a.name.localeCompare(b.name)),
      },
    }
  },
}
