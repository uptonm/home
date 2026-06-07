import { describe, expect, mock, test } from 'bun:test'
import { EMPTY_CTX, asDevice, data, errCode } from './sonos-fakes'

interface BrowseResp { Result: unknown[]; NumberReturned: number; TotalMatches: number; UpdateID: number }
function resp(items: unknown[]): BrowseResp {
  return { Result: items, NumberReturned: items.length, TotalMatches: items.length, UpdateID: 0 }
}

interface Calls {
  browse: Array<{ ObjectID: string; RequestedCount: number; StartingIndex: number }>
  removeRange: Array<{ StartingIndex: number; NumberOfTracks: number }>
  saveQueue: Array<{ Title: string }>
  patch: Array<{ ID: number; Enabled?: boolean }>
  setAv: Array<{ CurrentURI: string }>
  play: number
  removeAll: number
}

function makeDevice(opts: {
  name?: string
  uuid?: string
  browse?: (objectId: string) => BrowseResp
  alarms?: unknown[]
  services?: unknown[]
} = {}) {
  const calls: Calls = { browse: [], removeRange: [], saveQueue: [], patch: [], setAv: [], play: 0, removeAll: 0 }
  const dev = asDevice({
    Name: opts.name ?? 'Kitchen',
    Uuid: opts.uuid ?? 'K',
    Host: '10.0.0.1',
    ContentDirectoryService: {
      Browse: async (i: { ObjectID: string; RequestedCount: number; StartingIndex: number }) => {
        calls.browse.push({ ObjectID: i.ObjectID, RequestedCount: i.RequestedCount, StartingIndex: i.StartingIndex })
        return opts.browse ? opts.browse(i.ObjectID) : resp([])
      },
    },
    AVTransportService: {
      RemoveTrackRangeFromQueue: async (i: { StartingIndex: number; NumberOfTracks: number }) => { calls.removeRange.push({ StartingIndex: i.StartingIndex, NumberOfTracks: i.NumberOfTracks }); return { NewUpdateID: 1 } },
      SaveQueue: async (i: { Title: string }) => { calls.saveQueue.push({ Title: i.Title }); return { AssignedObjectID: 'SQ:9' } },
      RemoveAllTracksFromQueue: async () => { calls.removeAll++; return true },
      SetAVTransportURI: async (i: { CurrentURI: string }) => { calls.setAv.push({ CurrentURI: i.CurrentURI }); return true },
      AddURIToQueue: async () => { calls.play++; return { FirstTrackNumberEnqueued: 0, NumTracksAdded: 1, NewQueueLength: 1 } },
      Seek: async () => true,
    },
    AlarmClockService: {
      ListAndParseAlarms: async () => opts.alarms ?? [],
      PatchAlarm: async (i: { ID: number; Enabled?: boolean }) => { calls.patch.push({ ID: i.ID, Enabled: i.Enabled }); return true },
    },
    MusicServicesService: {
      ListAndParseAvailableServices: async () => opts.services ?? [],
    },
    Play: async () => { calls.play++; return true },
  })
  return { dev, calls }
}

let house: ReturnType<typeof asDevice>[] = []
let coordinator: ReturnType<typeof asDevice> | null = null
const realClient = await import('../modules/sonos/client')
mock.module('../modules/sonos/client', () => ({
  ...realClient,
  discover: async () => ({ Devices: house }),
  withRoom: async (_c: unknown, _o: unknown, fn: (d: ReturnType<typeof asDevice>) => unknown) => fn(coordinator ?? house[0]!),
}))

const { playlistsList, playlistsGet, playlistsPlay, resolvePlaylist } = await import('../modules/sonos/commands/playlists')
const { libraryBrowse, librarySearch, libraryCategoryId } = await import('../modules/sonos/commands/library')
const { musicServicesList } = await import('../modules/sonos/commands/music-services')
const { alarmsList, alarmsGet, alarmsEnable, alarmsDisable, shapeAlarm } = await import('../modules/sonos/commands/alarms')
const { queueRemove, queueSave } = await import('../modules/sonos/commands/queue')
const { lineIn, lineInUri } = await import('../modules/sonos/commands/line-in')

const PLAYLISTS = [
  { Title: 'Dinner', ItemId: 'SQ:3', TrackUri: 'file:///jffs/settings/savedqueues.rsq#3' },
  { Title: 'Party', ItemId: 'SQ:4', TrackUri: 'file:///jffs/settings/savedqueues.rsq#4' },
]

describe('resolvePlaylist', () => {
  test('unique substring resolves; ambiguous and missing handled', () => {
    expect(resolvePlaylist(PLAYLISTS, 'dinner').kind).toBe('ok')
    expect(resolvePlaylist(PLAYLISTS, 'nope').kind).toBe('not_found')
    expect(resolvePlaylist([{ Title: 'A' }, { Title: 'AB' }], 'a').kind).toBe('ok') // exact 'A'
    expect(resolvePlaylist([{ Title: 'AB' }, { Title: 'AC' }], 'a').kind).toBe('ambiguous')
  })
})

describe('playlists list / get / play', () => {
  test('list shapes SQ: browse', async () => {
    house = [makeDevice({ browse: (id) => (id === 'SQ:' ? resp(PLAYLISTS) : resp([])) }).dev]
    const res = await playlistsList.run({ ...EMPTY_CTX, args: {} })
    expect(data<unknown[]>(res)).toHaveLength(2)
    expect(data<Array<{ title: string }>>(res)[0]).toMatchObject({ title: 'Dinner', itemId: 'SQ:3' })
  })

  test('get browses the resolved playlist\'s children', async () => {
    const tracks = [{ Title: 'Song A', Artist: 'X' }]
    const { dev, calls } = makeDevice({ browse: (id) => (id === 'SQ:' ? resp(PLAYLISTS) : id === 'SQ:3' ? resp(tracks) : resp([])) })
    house = [dev]
    const res = await playlistsGet.run({ ...EMPTY_CTX, args: { name: 'Dinner' } })
    expect(res.ok).toBe(true)
    expect(data(res).itemId).toBe('SQ:3')
    expect(calls.browse.map((b) => b.ObjectID)).toEqual(['SQ:', 'SQ:3'])
  })

  test('play replaces the queue and enqueues the playlist', async () => {
    const { dev, calls } = makeDevice({ browse: (id) => (id === 'SQ:' ? resp(PLAYLISTS) : resp([])) })
    house = [dev]
    coordinator = dev
    const res = await playlistsPlay.run({ ...EMPTY_CTX, args: { name: 'Party' } })
    expect(res.ok).toBe(true)
    expect(data(res).played).toBe('Party')
    expect(calls.removeAll).toBe(1)
    expect(calls.setAv[0]?.CurrentURI).toBe('x-rincon-queue:K#0')
    coordinator = null
  })

  test('get rejects unknown playlist', async () => {
    house = [makeDevice({ browse: (id) => (id === 'SQ:' ? resp(PLAYLISTS) : resp([])) }).dev]
    expect(errCode(await playlistsGet.run({ ...EMPTY_CTX, args: { name: 'ghost' } }))).toBe('not_found')
  })
})

describe('library', () => {
  test('libraryCategoryId maps known categories', () => {
    expect(libraryCategoryId('artists')).toBe('A:ARTIST')
    expect(libraryCategoryId('ALBUMS')).toBe('A:ALBUM')
    expect(libraryCategoryId('bogus')).toBeNull()
  })

  test('browse maps category to ObjectID and honors limit', async () => {
    const { dev, calls } = makeDevice({ browse: () => resp([{ Title: 'Miles Davis', ItemId: 'A:ARTIST/Miles' }]) })
    house = [dev]
    const res = await libraryBrowse.run({ ...EMPTY_CTX, args: { category: 'artists', limit: 10 } })
    expect(res.ok).toBe(true)
    expect(calls.browse[0]).toMatchObject({ ObjectID: 'A:ARTIST', RequestedCount: 10 })
  })

  test('browse rejects unknown category', async () => {
    house = [makeDevice().dev]
    expect(errCode(await libraryBrowse.run({ ...EMPTY_CTX, args: { category: 'songs' } }))).toBe('bad_arg')
  })

  test('search appends the query to the category ObjectID', async () => {
    const { dev, calls } = makeDevice({ browse: () => resp([]) })
    house = [dev]
    await librarySearch.run({ ...EMPTY_CTX, args: { category: 'albums', query: 'kind of blue' } })
    expect(calls.browse[0]?.ObjectID).toBe('A:ALBUM:kind of blue')
  })

  test('search requires a query', async () => {
    house = [makeDevice().dev]
    expect(errCode(await librarySearch.run({ ...EMPTY_CTX, args: { category: 'albums' } }))).toBe('missing_arg')
  })
})

describe('music-services list', () => {
  test('shapes and sorts services by name', async () => {
    house = [makeDevice({ services: [
      { Id: 9, Name: 'Tidal', Policy: { Auth: 'DeviceLink' }, SecureUri: 'https://t' },
      { Id: 2, Name: 'Apple Music', Policy: { Auth: 'AppLink' }, Uri: 'http://a' },
    ] }).dev]
    const res = await musicServicesList.run({ ...EMPTY_CTX, args: {} })
    const d = data<Array<{ id: number; name: string }>>(res)
    expect(d.map((s) => s.name)).toEqual(['Apple Music', 'Tidal'])
    expect(d[0]).toMatchObject({ id: 2, auth: 'AppLink' })
  })
})

const ALARMS = [
  { ID: 7, StartLocalTime: '07:00:00', Duration: '01:00:00', Recurrence: 'DAILY', Enabled: true, RoomUUID: 'K', ProgramURI: '', ProgramMetaData: '', PlayMode: 'NORMAL', Volume: 25, IncludeLinkedZones: false },
]

describe('alarms', () => {
  test('shapeAlarm flattens the SDK shape', () => {
    expect(shapeAlarm(ALARMS[0]! as never)).toMatchObject({ id: 7, startTime: '07:00:00', enabled: true, volume: 25 })
  })
  test('list and get', async () => {
    house = [makeDevice({ alarms: ALARMS }).dev]
    expect(data<unknown[]>(await alarmsList.run({ ...EMPTY_CTX, args: {} }))).toHaveLength(1)
    expect(data(await alarmsGet.run({ ...EMPTY_CTX, args: { id: 7 } })).id).toBe(7)
    expect(errCode(await alarmsGet.run({ ...EMPTY_CTX, args: { id: 99 } }))).toBe('not_found')
  })
  test('enable / disable patch the Enabled flag', async () => {
    const { dev, calls } = makeDevice({ alarms: ALARMS })
    house = [dev]
    await alarmsEnable.run({ ...EMPTY_CTX, args: { id: 7 } })
    await alarmsDisable.run({ ...EMPTY_CTX, args: { id: 7 } })
    expect(calls.patch).toEqual([{ ID: 7, Enabled: true }, { ID: 7, Enabled: false }])
  })
  test('enable rejects unknown id', async () => {
    house = [makeDevice({ alarms: ALARMS }).dev]
    expect(errCode(await alarmsEnable.run({ ...EMPTY_CTX, args: { id: 5 } }))).toBe('not_found')
  })
})

describe('queue remove / save', () => {
  test('remove deletes a 1-based position', async () => {
    const { dev, calls } = makeDevice()
    coordinator = dev
    house = [dev]
    await queueRemove.run({ ...EMPTY_CTX, args: { room: 'kitchen', pos: 3 } })
    expect(calls.removeRange).toEqual([{ StartingIndex: 3, NumberOfTracks: 1 }])
    coordinator = null
  })
  test('remove rejects a bad position', async () => {
    coordinator = makeDevice().dev
    expect(errCode(await queueRemove.run({ ...EMPTY_CTX, args: { room: 'kitchen', pos: 0 } }))).toBe('bad_arg')
    coordinator = null
  })
  test('save persists the queue as a playlist', async () => {
    const { dev, calls } = makeDevice()
    coordinator = dev
    const res = await queueSave.run({ ...EMPTY_CTX, args: { room: 'kitchen', name: 'Friday' } })
    expect(calls.saveQueue).toEqual([{ Title: 'Friday' }])
    expect(data(res).objectId).toBe('SQ:9')
    coordinator = null
  })
})

describe('line-in', () => {
  test('lineInUri builds the right scheme', () => {
    expect(lineInUri('RINCON_X', false)).toBe('x-rincon-stream:RINCON_X')
    expect(lineInUri('RINCON_X', true)).toBe('x-sonos-htastream:RINCON_X:spdif')
  })
  test('streams a source room\'s line-in onto the target room', async () => {
    const target = makeDevice({ name: 'Kitchen', uuid: 'K' })
    const source = makeDevice({ name: 'Play 5', uuid: 'P5' })
    house = [target.dev, source.dev]
    const res = await lineIn.run({ ...EMPTY_CTX, args: { room: 'kitchen', source: 'play 5' } })
    expect(res.ok).toBe(true)
    expect(data(res)).toMatchObject({ room: 'Kitchen', source: 'Play 5', input: 'line-in' })
    expect(target.calls.setAv[0]?.CurrentURI).toBe('x-rincon-stream:P5')
    expect(target.calls.play).toBe(1)
  })
  test('defaults the source to the room itself, --tv uses htastream', async () => {
    const target = makeDevice({ name: 'Beam', uuid: 'B' })
    house = [target.dev]
    await lineIn.run({ ...EMPTY_CTX, args: { room: 'beam', tv: true } })
    expect(target.calls.setAv[0]?.CurrentURI).toBe('x-sonos-htastream:B:spdif')
  })
})
