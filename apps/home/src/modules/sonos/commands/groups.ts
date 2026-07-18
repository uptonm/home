import type SonosDevice from '@svrooij/sonos/lib/sonos-device'
import type { CommandSpec, RunResult } from '../../../core/types'
import { discover, pickCoordinator, readSonosConfig, resolveRoom, summarizeGroups, withRoom } from '../client'

export const groupsList: CommandSpec = {
  path: ['groups', 'list'],
  effect: 'read',
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
  effect: 'read',
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

/** Map a failed room/coordinator resolution to a labelled user error. */
function resolveErr(ref: string, r: { kind: 'not_found' } | { kind: 'ambiguous'; candidates: string[] }, label: string): RunResult {
  if (r.kind === 'ambiguous') {
    return { ok: false, kind: 'user', message: `${label} is ambiguous — candidates: ${r.candidates.join(', ')}`, code: 'ambiguous' }
  }
  return { ok: false, kind: 'user', message: `no ${label} matching "${ref}"`, code: 'not_found' }
}

export const groupsJoin: CommandSpec = {
  path: ['groups', 'join'],
  effect: 'write',
  description: 'Add a room to another room\'s group — they play in sync under the target group\'s coordinator',
  args: [
    { name: 'room', kind: 'positional', description: 'Room to move into the group', required: true },
    { name: 'target', kind: 'positional', description: 'Any room already in the destination group', required: true },
  ],
  examples: [
    'home sonos groups join kitchen "living room"',
    'home sonos groups join bedroom office',
  ],
  async run(ctx): Promise<RunResult> {
    const roomRef = ctx.args.room ? String(ctx.args.room) : undefined
    const targetRef = ctx.args.target ? String(ctx.args.target) : undefined
    if (!roomRef) return { ok: false, kind: 'user', message: 'room is required', code: 'missing_arg' }
    if (!targetRef) return { ok: false, kind: 'user', message: 'target is required', code: 'missing_arg' }

    const mgr = await discover(readSonosConfig(ctx.config))
    const room = resolveRoom(mgr.Devices, roomRef)
    if (room.kind !== 'ok') return resolveErr(roomRef, room, 'room')
    const target = pickCoordinator(mgr.Devices, targetRef)
    if (target.kind !== 'ok') return resolveErr(targetRef, target, 'target')

    if (room.device.Uuid === target.device.Uuid) {
      return { ok: false, kind: 'user', message: 'room and target resolve to the same speaker', code: 'bad_arg' }
    }
    // Already a member of the target's group → nothing to do.
    if (room.device.Coordinator?.Uuid === target.device.Uuid) {
      return { ok: true, data: { room: room.device.Name, target: target.device.Name, action: 'join', alreadyGrouped: true } }
    }

    // Joining a group = pointing this speaker's transport at the coordinator.
    await room.device.AVTransportService.SetAVTransportURI({
      InstanceID: 0,
      CurrentURI: `x-rincon:${target.device.Uuid}`,
      CurrentURIMetaData: '',
    })
    return { ok: true, data: { room: room.device.Name, target: target.device.Name, coordinatorUuid: target.device.Uuid, action: 'join' } }
  },
}

export const groupsLeave: CommandSpec = {
  path: ['groups', 'leave'],
  effect: 'write',
  description: 'Split a room out of its group into a standalone group of one',
  args: [{ name: 'room', kind: 'positional', description: 'Room to remove from its group', required: true }],
  examples: ['home sonos groups leave kitchen'],
  async run(ctx) {
    return withRoom(ctx, { pick: 'device', required: true }, async (d) => {
      await d.AVTransportService.BecomeCoordinatorOfStandaloneGroup({ InstanceID: 0 })
      return { ok: true, data: { room: d.Name, action: 'leave' } }
    })
  },
}

export const groupsParty: CommandSpec = {
  path: ['groups', 'party'],
  effect: 'write',
  description: 'Party mode: group every speaker under one coordinator so the whole house plays in sync',
  args: [{ name: 'room', kind: 'positional', description: 'Room to be the coordinator (defaults to an existing coordinator)', required: false }],
  examples: [
    'home sonos groups party',
    'home sonos groups party "living room"',
  ],
  async run(ctx): Promise<RunResult> {
    const mgr = await discover(readSonosConfig(ctx.config))
    const devices = mgr.Devices
    if (devices.length === 0) return { ok: false, kind: 'system', message: 'no devices discovered', code: 'no_devices' }

    const ref = ctx.args.room ? String(ctx.args.room) : undefined
    let anchor: SonosDevice
    if (ref) {
      const r = resolveRoom(devices, ref)
      if (r.kind !== 'ok') return resolveErr(ref, r, 'room')
      anchor = r.device
    } else {
      anchor = devices.find((d) => d.Coordinator?.Uuid === d.Uuid) ?? devices[0]!
    }

    const joined: string[] = []
    for (const d of devices) {
      if (d.Uuid === anchor.Uuid) continue
      if (d.Coordinator?.Uuid === anchor.Uuid) continue // already in the anchor's group
      await d.AVTransportService.SetAVTransportURI({ InstanceID: 0, CurrentURI: `x-rincon:${anchor.Uuid}`, CurrentURIMetaData: '' })
      joined.push(d.Name)
    }
    return { ok: true, data: { action: 'party', coordinator: anchor.Name, joined: joined.sort() } }
  },
}

export const groupsUngroup: CommandSpec = {
  path: ['groups', 'ungroup'],
  effect: 'write',
  description: 'Dissolve all groups — every speaker in a multi-room group becomes standalone',
  args: [],
  examples: ['home sonos groups ungroup'],
  async run(ctx): Promise<RunResult> {
    const mgr = await discover(readSonosConfig(ctx.config))
    const devices = mgr.Devices

    // Count members per group so we only split speakers that are actually grouped
    // — calling BecomeCoordinatorOfStandaloneGroup on a lone speaker is wasted work.
    const sizes = new Map<string, number>()
    for (const d of devices) {
      const k = d.GroupName ?? d.Name
      sizes.set(k, (sizes.get(k) ?? 0) + 1)
    }

    const split: string[] = []
    for (const d of devices) {
      const k = d.GroupName ?? d.Name
      if ((sizes.get(k) ?? 1) <= 1) continue
      await d.AVTransportService.BecomeCoordinatorOfStandaloneGroup({ InstanceID: 0 }).catch(() => {})
      split.push(d.Name)
    }
    return { ok: true, data: { action: 'ungroup', split: split.sort() } }
  },
}
