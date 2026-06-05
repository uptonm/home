import { describe, expect, mock, test } from 'bun:test'
import { EMPTY_CTX, asDevice, data, errCode } from './sonos-fakes'

const realClient = await import('../modules/sonos/client')
let injected: ReturnType<typeof asDevice> | null = null
mock.module('../modules/sonos/client', () => ({
  ...realClient,
  // withRoom normally discovers + resolves a room; here we hand the command the
  // device we want to assert against. enqueueAndPlay stays the real impl so the
  // container path exercises the real AddURIToQueue→Seek→Play recipe.
  withRoom: async (_ctx: unknown, _opts: unknown, fn: (d: ReturnType<typeof asDevice>) => unknown) => fn(injected!),
}))

const { favoritesPlay, resolveFavorite, favoriteIsContainer } = await import('../modules/sonos/commands/favorites')

const FAVS = [
  { Title: 'Morning Jazz', TrackUri: 'x-rincon-cpcontainer:1006206cspotify%3aplaylist%3aabc', UpnpClass: 'object.container.playlistContainer' },
  { Title: 'KEXP', TrackUri: 'x-sonosapi-stream:s12345?sid=254', UpnpClass: 'object.item.audioItem.audioBroadcast' },
  { Title: 'KEXP Live', TrackUri: 'x-sonosapi-stream:s99999?sid=254', UpnpClass: 'object.item.audioItem.audioBroadcast' },
  { Title: 'no uri here', UpnpClass: 'object.item.audioItem.audioBroadcast' },
]

function makeFavDevice(favResult: unknown[]) {
  const calls = {
    setAv: [] as Array<{ CurrentURI: string }>,
    addQueue: [] as Array<{ EnqueuedURI: string }>,
    removeAll: 0,
    play: 0,
    seek: [] as Array<{ Unit: string; Target: string }>,
  }
  const dev = asDevice({
    Name: 'Kitchen',
    Uuid: 'RINCON_KITCHEN',
    GetFavorites: async () => ({ Result: favResult, NumberReturned: favResult.length, TotalMatches: favResult.length, UpdateID: 0 }),
    AVTransportService: {
      RemoveAllTracksFromQueue: async () => { calls.removeAll++; return true },
      SetAVTransportURI: async (i: { CurrentURI: string }) => { calls.setAv.push(i); return true },
      AddURIToQueue: async (i: { EnqueuedURI: string }) => { calls.addQueue.push(i); return { FirstTrackNumberEnqueued: 1, NumTracksAdded: 1, NewQueueLength: 1 } },
      Seek: async (i: { Unit: string; Target: string }) => { calls.seek.push(i); return true },
    },
    Play: async () => { calls.play++; return true },
  })
  return { dev, calls }
}

describe('resolveFavorite', () => {
  test('exact title (case-insensitive) beats a longer substring match', () => {
    const r = resolveFavorite(FAVS, 'kexp')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.favorite.Title).toBe('KEXP')
  })

  test('unique substring resolves', () => {
    const r = resolveFavorite(FAVS, 'jazz')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.favorite.Title).toBe('Morning Jazz')
  })

  test('substring matching multiple is ambiguous', () => {
    const r = resolveFavorite(FAVS, 'kex')
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.candidates).toEqual(['KEXP', 'KEXP Live'])
  })

  test('no match is not_found', () => {
    expect(resolveFavorite(FAVS, 'nope').kind).toBe('not_found')
  })

  test('duplicate exact titles are ambiguous', () => {
    const dup = [{ Title: 'Dup' }, { Title: 'Dup' }]
    expect(resolveFavorite(dup, 'dup').kind).toBe('ambiguous')
  })
})

describe('favoriteIsContainer', () => {
  test('container by upnp class', () => {
    expect(favoriteIsContainer({ UpnpClass: 'object.container.album.musicAlbum' })).toBe(true)
    expect(favoriteIsContainer({ UpnpClass: 'object.container.playlistContainer' })).toBe(true)
  })
  test('container by uri scheme when class is absent', () => {
    expect(favoriteIsContainer({ TrackUri: 'x-rincon-cpcontainer:1004206cabc' })).toBe(true)
    expect(favoriteIsContainer({ TrackUri: 'file:///jffs/settings/savedqueues.rsq#5' })).toBe(true)
  })
  test('radio broadcast / single item is not a container', () => {
    expect(favoriteIsContainer({ UpnpClass: 'object.item.audioItem.audioBroadcast', TrackUri: 'x-sonosapi-stream:s1?sid=254' })).toBe(false)
    expect(favoriteIsContainer({})).toBe(false)
  })
})

describe('favorites play (command)', () => {
  test('rejects missing name before any discovery', async () => {
    expect(errCode(await favoritesPlay.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('container favorite replaces the queue and enqueues', async () => {
    const { dev, calls } = makeFavDevice(FAVS)
    injected = dev
    const res = await favoritesPlay.run({ ...EMPTY_CTX, args: { name: 'Morning Jazz' } })
    expect(res.ok).toBe(true)
    expect(data(res).kind).toBe('container')
    expect(calls.removeAll).toBe(1)
    // transport pointed at the local queue, then the favorite enqueued + played
    expect(calls.setAv[0]?.CurrentURI).toBe('x-rincon-queue:RINCON_KITCHEN#0')
    expect(calls.addQueue[0]?.EnqueuedURI).toBe('x-rincon-cpcontainer:1006206cspotify%3aplaylist%3aabc')
    expect(calls.play).toBe(1)
  })

  test('radio favorite is set directly on the transport (no queue)', async () => {
    const { dev, calls } = makeFavDevice(FAVS)
    injected = dev
    const res = await favoritesPlay.run({ ...EMPTY_CTX, args: { name: 'KEXP' } })
    expect(res.ok).toBe(true)
    expect(data(res).kind).toBe('item')
    expect(calls.removeAll).toBe(0)
    expect(calls.addQueue).toHaveLength(0)
    expect(calls.setAv[0]?.CurrentURI).toBe('x-sonosapi-stream:s12345?sid=254')
    expect(calls.play).toBe(1)
  })

  test('unknown favorite is not_found', async () => {
    injected = makeFavDevice(FAVS).dev
    expect(errCode(await favoritesPlay.run({ ...EMPTY_CTX, args: { name: 'does not exist' } }))).toBe('not_found')
  })

  test('favorite without a playable uri errors', async () => {
    injected = makeFavDevice(FAVS).dev
    expect(errCode(await favoritesPlay.run({ ...EMPTY_CTX, args: { name: 'no uri here' } }))).toBe('no_uri')
  })
})
