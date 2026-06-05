import { describe, expect, mock, test } from 'bun:test'
import { EMPTY_CTX, asDevice, data, errCode } from './sonos-fakes'

function topoDevice(name: string, uuid: string, group: string, coordUuid: string, vol = 0): ReturnType<typeof asDevice> {
  return asDevice({
    Name: name,
    Uuid: uuid,
    Host: `10.0.0.${uuid.length}`,
    GroupName: group,
    Coordinator: { Uuid: coordUuid },
    RenderingControlService: {
      GetVolume: async () => ({ CurrentVolume: vol }),
      GetMute: async () => ({ CurrentMute: false }),
    },
    AVTransportService: {
      GetTransportInfo: async () => ({ CurrentTransportState: 'PLAYING', CurrentTransportStatus: 'OK', CurrentSpeed: '1' }),
    },
  })
}

// Household: Kitchen + Dining Room grouped (Kitchen coordinates); Living Room standalone.
const DEVICES = [
  topoDevice('Kitchen', 'K', 'Kitchen + Dining Room', 'K', 30),
  topoDevice('Dining Room', 'D', 'Kitchen + Dining Room', 'K', 20),
  topoDevice('Living Room', 'L', 'Living Room', 'L', 15),
]

const realClient = await import('../modules/sonos/client')
mock.module('../modules/sonos/client', () => ({
  ...realClient,
  discover: async () => ({ Devices: DEVICES }),
}))

const { groupsGet, selectGroup } = await import('../modules/sonos/commands/groups')

describe('selectGroup', () => {
  test('resolves any member to its whole group + coordinator', () => {
    const r = selectGroup(DEVICES, 'dining')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.name).toBe('Kitchen + Dining Room')
      expect(r.coordinator.Name).toBe('Kitchen')
      expect(r.members.map((m) => m.Name).sort()).toEqual(['Dining Room', 'Kitchen'])
    }
  })

  test('standalone room is a group of one', () => {
    const r = selectGroup(DEVICES, 'living')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.members).toHaveLength(1)
      expect(r.coordinator.Name).toBe('Living Room')
    }
  })

  test('unknown room is not_found', () => {
    expect(selectGroup(DEVICES, 'garage').kind).toBe('not_found')
  })

  test('ambiguous room surfaces candidates', () => {
    const r = selectGroup(DEVICES, 'room')
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.candidates).toEqual(['Dining Room', 'Living Room'])
  })
})

describe('groups get (command)', () => {
  test('rejects missing room', async () => {
    expect(errCode(await groupsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('shapes coordinator, transport state, and per-member volume/mute', async () => {
    const res = await groupsGet.run({ ...EMPTY_CTX, args: { room: 'kitchen' } })
    expect(res.ok).toBe(true)
    const d = data(res)
    expect(d.name).toBe('Kitchen + Dining Room')
    expect(d.coordinator).toBe('Kitchen')
    expect(d.state).toBe('PLAYING')
    const members = d.members as Array<{ name: string; volume: number; muted: boolean; isCoordinator: boolean }>
    expect(members.map((m) => m.name)).toEqual(['Dining Room', 'Kitchen']) // sorted
    expect(members.find((m) => m.name === 'Kitchen')).toMatchObject({ volume: 30, muted: false, isCoordinator: true })
    expect(members.find((m) => m.name === 'Dining Room')).toMatchObject({ volume: 20, isCoordinator: false })
  })

  test('not_found / ambiguous bubble up from selectGroup', async () => {
    expect(errCode(await groupsGet.run({ ...EMPTY_CTX, args: { room: 'garage' } }))).toBe('not_found')
    expect(errCode(await groupsGet.run({ ...EMPTY_CTX, args: { room: 'room' } }))).toBe('ambiguous')
  })
})
