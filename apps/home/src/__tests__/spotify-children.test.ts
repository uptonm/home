import { describe, expect, mock, test } from 'bun:test'
import {
  buildAlbumTracksListUrl,
  buildArtistAlbumsUrl,
  buildPlaylistTracksListUrl,
} from '../modules/spotify/client'

const EMPTY_CTX = {
  config: { clientId: 'cid', clientSecret: 'csec' },
  json: false,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {},
}

function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

describe('children URL builders', () => {
  test('album/artist/playlist children encode id and thread market/limit/offset', () => {
    const album = new URL(buildAlbumTracksListUrl('alb1', { market: 'US', limit: 50, offset: 0 }))
    expect(album.pathname).toBe('/v1/albums/alb1/tracks')
    expect(album.searchParams.get('market')).toBe('US')
    expect(album.searchParams.get('limit')).toBe('50')
    // offset 0 is omitted to keep the URL clean
    expect(album.searchParams.get('offset')).toBeNull()

    const artist = new URL(buildArtistAlbumsUrl('a1', { market: 'GB', limit: 10, offset: 20 }))
    expect(artist.pathname).toBe('/v1/artists/a1/albums')
    expect(artist.searchParams.get('offset')).toBe('20')

    const playlist = new URL(buildPlaylistTracksListUrl('pl1', { limit: 5 }))
    expect(playlist.pathname).toBe('/v1/playlists/pl1/tracks')
    expect(playlist.searchParams.get('market')).toBeNull()
  })
})

const realClient = await import('../modules/spotify/client')

mock.module('../modules/spotify/client', () => ({
  ...realClient,
  getAlbumTracks: async (_cfg: unknown, id: string, opts: { limit?: number; offset?: number }) => ({
    items: [{ kind: 'track', uri: `spotify:track:${id}t`, title: 'T', artist: 'X', album: '' }],
    total: 14,
    limit: opts.limit,
    offset: opts.offset,
  }),
  getArtistAlbums: async (_cfg: unknown, id: string) => ({ items: [{ kind: 'album', uri: `spotify:album:${id}a`, title: 'A', artist: 'X' }], total: 5 }),
  getArtistTopTracks: async (_cfg: unknown, id: string, market: string) => ({ items: [{ kind: 'track', uri: `spotify:track:${id}top`, title: market, artist: 'X', album: '' }] }),
  getPlaylistTracks: async (_cfg: unknown, id: string) => ({ items: [{ kind: 'track', uri: `spotify:track:${id}p`, title: 'P', artist: 'X', album: '' }], total: 50 }),
}))

const { albumTracks, artistAlbums, artistTopTracks, playlistTracks } = await import('../modules/spotify/commands/children')

describe('spotify children commands', () => {
  test('album tracks passes a clamped limit through to the client', async () => {
    const res = await albumTracks.run({ ...EMPTY_CTX, args: { ref: 'spotify:album:5r36AJ6VOJtp00oxSkBZ5h', limit: 999 } })
    expect(res.ok).toBe(true)
    // 999 is clamped to the Spotify page max of 50
    expect((res as { data: { limit: number } }).data.limit).toBe(50)
  })

  test('artist top-tracks forwards the market', async () => {
    const res = await artistTopTracks.run({ ...EMPTY_CTX, args: { ref: 'spotify:artist:7kNqXtgeIwFtelmRjWv205', market: 'gb' } })
    expect((res as { data: { items: { title: string }[] } }).data.items[0]!.title).toBe('GB')
  })

  test('artist albums and playlist tracks return shaped listings', async () => {
    const aa = await artistAlbums.run({ ...EMPTY_CTX, args: { ref: 'spotify:artist:7kNqXtgeIwFtelmRjWv205' } })
    expect((aa as { data: { items: unknown[] } }).data.items).toHaveLength(1)
    const pt = await playlistTracks.run({ ...EMPTY_CTX, args: { ref: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' } })
    expect((pt as { data: { total: number } }).data.total).toBe(50)
  })

  test('malformed ref → bad_ref; bad market → bad_arg; bad limit → bad_arg', async () => {
    expect(errCode(await albumTracks.run({ ...EMPTY_CTX, args: { ref: 'nope' } }))).toBe('bad_ref')
    expect(errCode(await albumTracks.run({ ...EMPTY_CTX, args: { ref: 'spotify:album:5r36AJ6VOJtp00oxSkBZ5h', market: 'USA' } }))).toBe('bad_arg')
    expect(errCode(await albumTracks.run({ ...EMPTY_CTX, args: { ref: 'spotify:album:5r36AJ6VOJtp00oxSkBZ5h', limit: 0 } }))).toBe('bad_arg')
  })

  test('command specs declare the expected paths', () => {
    expect(albumTracks.path).toEqual(['album', 'tracks'])
    expect(artistAlbums.path).toEqual(['artist', 'albums'])
    expect(artistTopTracks.path).toEqual(['artist', 'top-tracks'])
    expect(playlistTracks.path).toEqual(['playlist', 'tracks'])
  })
})
