import { describe, expect, mock, test } from 'bun:test'
import { EMPTY_CTX, asDevice, data, errCode, realSonosClient } from './sonos-fakes'

interface Rec {
  setAv: Array<{ CurrentURI: string }>
  standalone: number
}

function makeDevice(name: string, uuid: string, group: string, coordUuid: string, vol = 0): { dev: ReturnType<typeof asDevice>; rec: Rec } {
  const rec: Rec = { setAv: [], standalone: 0 }
  const dev = asDevice({
    Name: name,
    Uuid: uuid,
    Host: `10.0.0.${uuid}`,
    GroupName: group,
    Coordinator: { Uuid: coordUuid },
    RenderingControlService: {
      GetVolume: async () => ({ CurrentVolume: vol }),
      GetMute: async () => ({ CurrentMute: false }),
    },
    AVTransportService: {
      GetTransportInfo: async () => ({ CurrentTransportState: 'PLAYING', CurrentTransportStatus: 'OK', CurrentSpeed: '1' }),
      SetAVTransportURI: async (i: { CurrentURI: string }) => { rec.setAv.push(i); return true },
      BecomeCoordinatorOfStandaloneGroup: async () => { rec.standalone++; return { DelegatedGroupCoordinatorID: '', NewGroupID: '' } },
    },
  })
  return { dev, rec }
}

/** Build a household; returns the device list (for `discover`) + a name→recorder map. */
function household(...specs: Array<[name: string, uuid: string, group: string, coord: string, vol?: number]>) {
  const recs: Record<string, Rec> = {}
  const byUuid: Record<string, ReturnType<typeof asDevice>> = {}
  const devices = specs.map(([name, uuid, group, coord, vol]) => {
    const { dev, rec } = makeDevice(name, uuid, group, coord, vol)
    recs[name] = rec
    byUuid[uuid] = dev
    return dev
  })
  // Mirror the SDK: `device.Coordinator` is the full coordinator device (itself
  // when standalone), not a bare {uuid}. pickCoordinator returns it directly.
  for (const d of devices) {
    const coordUuid = (d as unknown as { Coordinator: { Uuid: string } }).Coordinator.Uuid
    ;(d as unknown as { Coordinator: unknown }).Coordinator = byUuid[coordUuid] ?? d
  }
  return { devices, recs }
}

// Mutable: each command test assigns the household the mocked `discover` returns.
let current: ReturnType<typeof asDevice>[] = []
mock.module('../modules/sonos/client', () => ({
  ...realSonosClient,
  discover: async () => ({ Devices: current }),
}))

const { groupsGet, groupsJoin, groupsLeave, groupsParty, groupsUngroup, selectGroup } = await import('../modules/sonos/commands/groups')

// Static topology for the pure selectGroup tests (no discovery involved).
const TOPO = household(
  ['Kitchen', 'K', 'Kitchen + Dining Room', 'K', 30],
  ['Dining Room', 'D', 'Kitchen + Dining Room', 'K', 20],
  ['Living Room', 'L', 'Living Room', 'L', 15],
).devices

describe('selectGroup', () => {
  test('resolves any member to its whole group + coordinator', () => {
    const r = selectGroup(TOPO, 'dining')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.name).toBe('Kitchen + Dining Room')
      expect(r.coordinator.Name).toBe('Kitchen')
      expect(r.members.map((m) => m.Name).sort()).toEqual(['Dining Room', 'Kitchen'])
    }
  })

  test('standalone room is a group of one', () => {
    const r = selectGroup(TOPO, 'living')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.members).toHaveLength(1)
      expect(r.coordinator.Name).toBe('Living Room')
    }
  })

  test('unknown room is not_found', () => {
    expect(selectGroup(TOPO, 'garage').kind).toBe('not_found')
  })

  test('ambiguous room surfaces candidates', () => {
    const r = selectGroup(TOPO, 'room')
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.candidates).toEqual(['Dining Room', 'Living Room'])
  })
})

describe('groups get (command)', () => {
  test('rejects missing room', async () => {
    current = TOPO
    expect(errCode(await groupsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('shapes coordinator, transport state, and per-member volume/mute', async () => {
    current = TOPO
    const res = await groupsGet.run({ ...EMPTY_CTX, args: { room: 'kitchen' } })
    expect(res.ok).toBe(true)
    const d = data(res)
    expect(d.name).toBe('Kitchen + Dining Room')
    expect(d.coordinator).toBe('Kitchen')
    expect(d.state).toBe('PLAYING')
    const members = d.members as Array<{ name: string; volume: number; muted: boolean; isCoordinator: boolean }>
    expect(members.map((m) => m.name)).toEqual(['Dining Room', 'Kitchen'])
    expect(members.find((m) => m.name === 'Kitchen')).toMatchObject({ volume: 30, muted: false, isCoordinator: true })
    expect(members.find((m) => m.name === 'Dining Room')).toMatchObject({ volume: 20, isCoordinator: false })
  })

  test('not_found / ambiguous bubble up from selectGroup', async () => {
    current = TOPO
    expect(errCode(await groupsGet.run({ ...EMPTY_CTX, args: { room: 'garage' } }))).toBe('not_found')
    expect(errCode(await groupsGet.run({ ...EMPTY_CTX, args: { room: 'room' } }))).toBe('ambiguous')
  })
})

describe('groups join (command)', () => {
  test('points the joiner transport at the target coordinator', async () => {
    const h = household(['Kitchen', 'K', 'Kitchen', 'K'], ['Living Room', 'L', 'Living Room', 'L'])
    current = h.devices
    const res = await groupsJoin.run({ ...EMPTY_CTX, args: { room: 'kitchen', target: 'living' } })
    expect(res.ok).toBe(true)
    expect(data(res)).toMatchObject({ room: 'Kitchen', target: 'Living Room', coordinatorUuid: 'L', action: 'join' })
    expect(h.recs.Kitchen!.setAv[0]?.CurrentURI).toBe('x-rincon:L')
    expect(h.recs['Living Room']!.setAv).toHaveLength(0)
  })

  test('no-op when already in the target group', async () => {
    const h = household(['Kitchen', 'K', 'LR+K', 'L'], ['Living Room', 'L', 'LR+K', 'L'])
    current = h.devices
    const res = await groupsJoin.run({ ...EMPTY_CTX, args: { room: 'kitchen', target: 'living' } })
    expect(res.ok).toBe(true)
    expect(data(res).alreadyGrouped).toBe(true)
    expect(h.recs.Kitchen!.setAv).toHaveLength(0)
  })

  test('rejects joining a speaker to itself', async () => {
    current = household(['Kitchen', 'K', 'Kitchen', 'K']).devices
    expect(errCode(await groupsJoin.run({ ...EMPTY_CTX, args: { room: 'kitchen', target: 'kitchen' } }))).toBe('bad_arg')
  })

  test('missing args and unknown rooms error', async () => {
    current = household(['Kitchen', 'K', 'Kitchen', 'K']).devices
    expect(errCode(await groupsJoin.run({ ...EMPTY_CTX, args: { room: 'kitchen' } }))).toBe('missing_arg')
    expect(errCode(await groupsJoin.run({ ...EMPTY_CTX, args: { room: 'nope', target: 'kitchen' } }))).toBe('not_found')
  })
})

describe('groups leave (command)', () => {
  test('makes the room a standalone coordinator', async () => {
    const h = household(['Kitchen', 'K', 'LR+K', 'L'], ['Living Room', 'L', 'LR+K', 'L'])
    current = h.devices
    const res = await groupsLeave.run({ ...EMPTY_CTX, args: { room: 'kitchen' } })
    expect(res.ok).toBe(true)
    expect(data(res)).toMatchObject({ room: 'Kitchen', action: 'leave' })
    expect(h.recs.Kitchen!.standalone).toBe(1)
  })
})

describe('groups party (command)', () => {
  test('joins every other speaker to the chosen coordinator', async () => {
    const h = household(['Kitchen', 'K', 'Kitchen', 'K'], ['Living Room', 'L', 'Living Room', 'L'], ['Bedroom', 'B', 'Bedroom', 'B'])
    current = h.devices
    const res = await groupsParty.run({ ...EMPTY_CTX, args: { room: 'living' } })
    expect(res.ok).toBe(true)
    expect(data(res)).toMatchObject({ action: 'party', coordinator: 'Living Room', joined: ['Bedroom', 'Kitchen'] })
    expect(h.recs.Kitchen!.setAv[0]?.CurrentURI).toBe('x-rincon:L')
    expect(h.recs.Bedroom!.setAv[0]?.CurrentURI).toBe('x-rincon:L')
    expect(h.recs['Living Room']!.setAv).toHaveLength(0)
  })

  test('defaults the anchor to an existing coordinator and skips members already in its group', async () => {
    const h = household(['Kitchen', 'K', 'K+Bed', 'K'], ['Bedroom', 'B', 'K+Bed', 'K'], ['Living Room', 'L', 'Living Room', 'L'])
    current = h.devices
    const res = await groupsParty.run({ ...EMPTY_CTX, args: {} })
    expect(res.ok).toBe(true)
    // anchor = first coordinator = Kitchen; Bedroom already in K's group → only Living moves
    expect(data(res)).toMatchObject({ coordinator: 'Kitchen', joined: ['Living Room'] })
    expect(h.recs.Bedroom!.setAv).toHaveLength(0)
    expect(h.recs['Living Room']!.setAv[0]?.CurrentURI).toBe('x-rincon:K')
  })
})

describe('groups ungroup (command)', () => {
  test('splits only speakers in multi-member groups', async () => {
    const h = household(['Kitchen', 'K', 'K+Bed', 'K'], ['Bedroom', 'B', 'K+Bed', 'K'], ['Living Room', 'L', 'Living Room', 'L'])
    current = h.devices
    const res = await groupsUngroup.run({ ...EMPTY_CTX, args: {} })
    expect(res.ok).toBe(true)
    expect(data(res).split).toEqual(['Bedroom', 'Kitchen'])
    expect(h.recs.Kitchen!.standalone).toBe(1)
    expect(h.recs.Bedroom!.standalone).toBe(1)
    expect(h.recs['Living Room']!.standalone).toBe(0) // already standalone
  })
})
