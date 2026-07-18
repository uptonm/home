import { describe, expect, mock, test } from 'bun:test'
import {
  buildAlbumGetUrl,
  buildArtistGetUrl,
  buildPlaylistGetUrl,
  buildTrackGetUrl,
  extractSpotifyRef,
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

describe('extractSpotifyRef', () => {
  const ID = '7oK9VyNzrYvRFo7nQEYkWN'

  test('accepts a bare 22-char id', () => {
    expect(extractSpotifyRef(ID)).toBe(ID)
    expect(extractSpotifyRef(`  ${ID}  `)).toBe(ID)
  })

  test('accepts a spotify:<type>:<id> URI for every type', () => {
    expect(extractSpotifyRef(`spotify:track:${ID}`)).toBe(ID)
    expect(extractSpotifyRef('spotify:album:5r36AJ6VOJtp00oxSkBZ5h')).toBe('5r36AJ6VOJtp00oxSkBZ5h')
    expect(extractSpotifyRef('spotify:artist:7kNqXtgeIwFtelmRjWv205')).toBe('7kNqXtgeIwFtelmRjWv205')
    expect(extractSpotifyRef('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')).toBe('37i9dQZF1DXcBWIGoYBM5M')
  })

  test('accepts an open.spotify.com share URL (with si query and intl prefix)', () => {
    expect(extractSpotifyRef(`https://open.spotify.com/track/${ID}`)).toBe(ID)
    expect(extractSpotifyRef(`https://open.spotify.com/album/5r36AJ6VOJtp00oxSkBZ5h?si=abc123`)).toBe('5r36AJ6VOJtp00oxSkBZ5h')
    expect(extractSpotifyRef(`https://open.spotify.com/intl-de/track/${ID}`)).toBe(ID)
  })

  test('rejects malformed input', () => {
    expect(extractSpotifyRef('tooshort')).toBeNull()
    expect(extractSpotifyRef('https://example.com/track/abc')).toBeNull()
    expect(extractSpotifyRef('apple:song:1234')).toBeNull()
    expect(extractSpotifyRef('')).toBeNull()
  })
})

describe('get-by-id URL builders', () => {
  test('build the canonical /v1 get-by-id endpoints and encode the id', () => {
    expect(buildTrackGetUrl('abc')).toBe('https://api.spotify.com/v1/tracks/abc')
    expect(buildAlbumGetUrl('abc')).toBe('https://api.spotify.com/v1/albums/abc')
    expect(buildArtistGetUrl('abc')).toBe('https://api.spotify.com/v1/artists/abc')
    expect(buildPlaylistGetUrl('a b')).toBe('https://api.spotify.com/v1/playlists/a%20b')
  })
})

const realClient = await import('../modules/spotify/client')

mock.module('../modules/spotify/client', () => ({
  ...realClient,
  getTrack: async (_cfg: unknown, id: string) => ({ kind: 'track', uri: `spotify:track:${id}`, title: 'Light', artist: 'John Summit', album: 'Comfort In Chaos' }),
  getAlbum: async (_cfg: unknown, id: string) => ({ kind: 'album', uri: `spotify:album:${id}`, title: 'Comfort In Chaos', artist: 'John Summit' }),
  getArtist: async (_cfg: unknown, id: string) => ({ kind: 'artist', uri: `spotify:artist:${id}`, name: 'John Summit', genres: ['house'] }),
  getPlaylist: async (_cfg: unknown, id: string) => ({ kind: 'playlist', uri: `spotify:playlist:${id}`, title: "Today's Top Hits", owner: 'Spotify' }),
}))

const { trackGet, albumGet, artistGet, playlistGet } = await import('../modules/spotify/commands/get')

describe('spotify track/album/artist/playlist get', () => {
  test('track get resolves a URI ref and emits a playable spotify:track uri', async () => {
    const res = await trackGet.run({ ...EMPTY_CTX, args: { ref: 'spotify:track:7oK9VyNzrYvRFo7nQEYkWN' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { uri: string } }).data.uri).toBe('spotify:track:7oK9VyNzrYvRFo7nQEYkWN')
  })

  test('get resolves a bare id and a share URL to the same id', async () => {
    const bare = await albumGet.run({ ...EMPTY_CTX, args: { ref: '5r36AJ6VOJtp00oxSkBZ5h' } })
    const url = await albumGet.run({ ...EMPTY_CTX, args: { ref: 'https://open.spotify.com/album/5r36AJ6VOJtp00oxSkBZ5h?si=x' } })
    expect((bare as { data: { uri: string } }).data.uri).toBe('spotify:album:5r36AJ6VOJtp00oxSkBZ5h')
    expect((url as { data: { uri: string } }).data.uri).toBe('spotify:album:5r36AJ6VOJtp00oxSkBZ5h')
  })

  test('artist and playlist get return shaped data', async () => {
    const a = await artistGet.run({ ...EMPTY_CTX, args: { ref: 'spotify:artist:7kNqXtgeIwFtelmRjWv205' } })
    expect((a as { data: { kind: string } }).data.kind).toBe('artist')
    const p = await playlistGet.run({ ...EMPTY_CTX, args: { ref: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' } })
    expect((p as { data: { kind: string } }).data.kind).toBe('playlist')
  })

  test('missing ref → missing_arg', async () => {
    expect(errCode(await trackGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('malformed ref → bad_ref', async () => {
    expect(errCode(await trackGet.run({ ...EMPTY_CTX, args: { ref: 'not-a-spotify-id' } }))).toBe('bad_ref')
  })

  test('command specs declare the expected two-segment paths', () => {
    expect(trackGet.path).toEqual(['track', 'get'])
    expect(albumGet.path).toEqual(['album', 'get'])
    expect(artistGet.path).toEqual(['artist', 'get'])
    expect(playlistGet.path).toEqual(['playlist', 'get'])
    expect(trackGet.args[0]?.required).toBe(true)
  })
})
