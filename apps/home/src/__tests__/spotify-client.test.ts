import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  withResolvedTrack,
  authedRequestJson,
  buildAlbumTracksUrl,
  buildArtistTopTracksUrl,
  buildPlaylistTracksUrl,
  buildSearchUrl,
  extractSpotifyId,
  getAccessToken,
  normalizeSearchResponse,
  resetTokenCache,
  type AlbumMatch,
  type ArtistMatch,
  type PlaylistMatch,
  type SpotifyConfig,
} from '../modules/spotify/client'

describe('buildSearchUrl', () => {
  test('encodes query, types, limit, market into Spotify search URL', () => {
    const url = buildSearchUrl({ query: 'John Summit', types: ['artist', 'track'], limit: 5, market: 'US' })
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://api.spotify.com/v1/search')
    expect(u.searchParams.get('q')).toBe('John Summit')
    expect(u.searchParams.get('type')).toBe('artist,track')
    expect(u.searchParams.get('limit')).toBe('5')
    expect(u.searchParams.get('market')).toBe('US')
  })

  test('URL-encodes queries with special characters (apostrophes, quotes)', () => {
    const url = buildSearchUrl({ query: "Today's Top Hits", types: ['playlist'], limit: 1, market: 'US' })
    const u = new URL(url)
    expect(u.searchParams.get('q')).toBe("Today's Top Hits")
    expect(url).toContain('Today%27s+Top+Hits')
  })

  test('handles non-ASCII queries', () => {
    const url = buildSearchUrl({ query: 'Björk', types: ['artist'], limit: 1, market: 'US' })
    expect(new URL(url).searchParams.get('q')).toBe('Björk')
  })
})

describe('container resolver URL builders', () => {
  test('artist top-tracks URL pins market', () => {
    const url = buildArtistTopTracksUrl('7kNqXtgeIwFtelmRjWv205', 'US')
    expect(url).toBe('https://api.spotify.com/v1/artists/7kNqXtgeIwFtelmRjWv205/top-tracks?market=US')
  })

  test('album tracks URL limits to 1', () => {
    const url = buildAlbumTracksUrl('5r36AJ6VOJtp00oxSkBZ5h', 'US')
    const u = new URL(url)
    expect(u.pathname).toBe('/v1/albums/5r36AJ6VOJtp00oxSkBZ5h/tracks')
    expect(u.searchParams.get('limit')).toBe('1')
    expect(u.searchParams.get('market')).toBe('US')
  })

  test('playlist tracks URL limits to 1', () => {
    const url = buildPlaylistTracksUrl('37i9dQZF1DXcBWIGoYBM5M', 'US')
    const u = new URL(url)
    expect(u.pathname).toBe('/v1/playlists/37i9dQZF1DXcBWIGoYBM5M/tracks')
    expect(u.searchParams.get('limit')).toBe('1')
  })
})

describe('extractSpotifyId', () => {
  test('pulls the id from a spotify:track URI', () => {
    expect(extractSpotifyId('spotify:track:7oK9VyNzrYvRFo7nQEYkWN')).toBe('7oK9VyNzrYvRFo7nQEYkWN')
  })

  test('pulls the id from container-shape URIs', () => {
    expect(extractSpotifyId('spotify:album:5r36AJ6VOJtp00oxSkBZ5h')).toBe('5r36AJ6VOJtp00oxSkBZ5h')
    expect(extractSpotifyId('spotify:artist:7kNqXtgeIwFtelmRjWv205')).toBe('7kNqXtgeIwFtelmRjWv205')
    expect(extractSpotifyId('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')).toBe('37i9dQZF1DXcBWIGoYBM5M')
  })

  test('returns null for non-Spotify input', () => {
    expect(extractSpotifyId('https://example.com')).toBeNull()
    expect(extractSpotifyId('apple:song:1234')).toBeNull()
    expect(extractSpotifyId('')).toBeNull()
  })

  test('rejects malformed Spotify URIs (Spotify IDs are exactly 22 base62 chars)', () => {
    expect(extractSpotifyId('spotify:track:tooshort')).toBeNull()
    expect(extractSpotifyId('spotify:track:waytoolongtobeavalidspotifyid')).toBeNull()
    expect(extractSpotifyId('spotify:track:')).toBeNull()
    expect(extractSpotifyId('spotify:track:contains-dashes-not-base62')).toBeNull()
  })
})

describe('normalizeSearchResponse', () => {
  test('emits the kind field on every match and placeholder URIs for containers', () => {
    const raw = {
      tracks: {
        items: [
          {
            id: 'track123',
            name: 'Light',
            artists: [{ id: 'a1', name: 'John Summit' }],
            album: { id: 'alb1', name: 'Comfort In Chaos', release_date: '2024-08-09' },
            duration_ms: 218456,
            explicit: false,
          },
        ],
      },
      albums: {
        items: [
          {
            id: 'alb1',
            name: 'Comfort In Chaos',
            artists: [{ id: 'a1', name: 'John Summit' }],
            release_date: '2024-08-09',
            total_tracks: 14,
            album_type: 'album',
          },
        ],
      },
      artists: {
        items: [
          {
            id: 'a1',
            name: 'John Summit',
            genres: ['house', 'tech house'],
            popularity: 78,
            followers: { total: 1234567 },
          },
        ],
      },
      playlists: {
        items: [
          {
            id: 'pl1',
            name: 'John Summit Radio',
            owner: { display_name: 'Spotify', id: 'spotify' },
            tracks: { total: 50 },
            public: true,
          },
        ],
      },
    }
    const out = normalizeSearchResponse(raw)
    expect(out.tracks[0]).toEqual({
      kind: 'track',
      id: 'track123',
      uri: 'spotify:track:track123',
      title: 'Light',
      artist: 'John Summit',
      album: 'Comfort In Chaos',
      releaseDate: '2024-08-09',
      durationMs: 218456,
      explicit: false,
    })
    expect(out.albums[0]).toEqual({
      kind: 'album',
      id: 'alb1',
      uri: 'spotify:album:alb1',
      title: 'Comfort In Chaos',
      artist: 'John Summit',
      releaseDate: '2024-08-09',
      totalTracks: 14,
      albumType: 'album',
    })
    expect(out.artists[0]).toEqual({
      kind: 'artist',
      id: 'a1',
      uri: 'spotify:artist:a1',
      name: 'John Summit',
      genres: ['house', 'tech house'],
      popularity: 78,
      followers: 1234567,
    })
    expect(out.playlists[0]).toEqual({
      kind: 'playlist',
      id: 'pl1',
      uri: 'spotify:playlist:pl1',
      title: 'John Summit Radio',
      owner: 'Spotify',
      totalTracks: 50,
      public: true,
    })
  })

  test('emits canonical spotify:artist URIs — sonos owns its own URI shaping', () => {
    const out = normalizeSearchResponse({ artists: { items: [{ id: 'xyz', name: 'X' }] } })
    expect(out.artists[0]!.uri).toBe('spotify:artist:xyz')
    expect(out.artists[0]!.id).toBe('xyz')
  })

  test('joins multiple artist names with comma', () => {
    const out = normalizeSearchResponse({
      tracks: {
        items: [
          { id: 't', name: 'Collab', artists: [{ id: 'a', name: 'Artist A' }, { id: 'b', name: 'Artist B' }] },
        ],
      },
    })
    expect(out.tracks[0]!.artist).toBe('Artist A, Artist B')
  })

  test('filters out null and id-less items defensively', () => {
    const out = normalizeSearchResponse({
      tracks: { items: [null, { name: 'No ID' }, { id: 't1', name: 'Has ID' }] as never },
    })
    expect(out.tracks).toHaveLength(1)
    expect(out.tracks[0]!.uri).toBe('spotify:track:t1')
    expect(out.tracks[0]!.id).toBe('t1')
  })

  test('handles missing top-level sections without throwing', () => {
    const out = normalizeSearchResponse({})
    expect(out).toEqual({ tracks: [], albums: [], artists: [], playlists: [] })
  })

  test('tolerates missing optional fields on items', () => {
    const out = normalizeSearchResponse({
      tracks: { items: [{ id: 't', name: 'Bare' }] },
      albums: { items: [{ id: 'a' }] },
      artists: { items: [{ id: 'ar' }] },
      playlists: { items: [{ id: 'p' }] },
    })
    expect(out.tracks[0]!.artist).toBe('')
    expect(out.tracks[0]!.album).toBe('')
    expect(out.albums[0]!.title).toBe('')
    expect(out.artists[0]!.genres).toEqual([])
    expect(out.playlists[0]!.owner).toBe('')
  })
})

describe('authedRequestJson 401 recovery', () => {
  const cfg: SpotifyConfig = { clientId: 'cid', clientSecret: 'csec' }
  const originalFetch = globalThis.fetch
  let fetchCalls: { url: string; init?: RequestInit }[]
  let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>

  beforeEach(() => {
    resetTokenCache()
    fetchCalls = []
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init })
      return fetchImpl(String(url), init)
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    resetTokenCache()
  })

  test('drops the cached token and retries once on 401', async () => {
    let tokenCalls = 0
    let searchCalls = 0
    fetchImpl = async (url) => {
      if (url.startsWith('https://accounts.spotify.com/api/token')) {
        tokenCalls++
        const value = tokenCalls === 1 ? 'stale-token' : 'fresh-token'
        return new Response(JSON.stringify({ access_token: value, token_type: 'Bearer', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      searchCalls++
      if (searchCalls === 1) return new Response('unauthorized', { status: 401 })
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const result = await authedRequestJson<{ ok: boolean }>(cfg, 'https://api.spotify.com/v1/search?q=test&type=track&limit=1&market=US')
    expect(result).toEqual({ ok: true })
    expect(tokenCalls).toBe(2)
    expect(searchCalls).toBe(2)
    expect(fetchCalls[1]!.init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer stale-token' }))
    expect(fetchCalls[3]!.init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer fresh-token' }))
  })

  test('does not retry on non-401 failures', async () => {
    let searchCalls = 0
    fetchImpl = async (url) => {
      if (url.startsWith('https://accounts.spotify.com/api/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      searchCalls++
      return new Response('forbidden', { status: 403 })
    }

    await expect(authedRequestJson(cfg, 'https://api.spotify.com/v1/search?q=test&type=track&limit=1&market=US')).rejects.toThrow(/403/)
    expect(searchCalls).toBe(1)
  })

  test('reuses the cached token on success — no extra token fetch', async () => {
    let tokenCalls = 0
    fetchImpl = async (url) => {
      if (url.startsWith('https://accounts.spotify.com/api/token')) {
        tokenCalls++
        return new Response(JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    await authedRequestJson(cfg, 'https://api.spotify.com/v1/search?q=test&type=track&limit=1&market=US')
    await authedRequestJson(cfg, 'https://api.spotify.com/v1/search?q=test2&type=track&limit=1&market=US')
    expect(tokenCalls).toBe(1)
  })
})

describe('getAccessToken', () => {
  const cfg: SpotifyConfig = { clientId: 'cid', clientSecret: 'csec' }
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    resetTokenCache()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    resetTokenCache()
  })

  test('throws SystemError when clientId or clientSecret is missing', async () => {
    await expect(getAccessToken({ clientId: '', clientSecret: 'csec' })).rejects.toThrow(/not configured/)
    await expect(getAccessToken({ clientId: 'cid', clientSecret: '' })).rejects.toThrow(/not configured/)
  })

  test('sends client-credentials grant with HTTP Basic auth', async () => {
    let init: RequestInit | undefined
    globalThis.fetch = (async (_url: string, i?: RequestInit) => {
      init = i
      return new Response(JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    await getAccessToken(cfg)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('grant_type=client_credentials')
    expect((init?.headers as Record<string, string>)?.Authorization).toBe(`Basic ${Buffer.from('cid:csec').toString('base64')}`)
  })
})

describe('withResolvedTrack', () => {
  const album: AlbumMatch = {
    kind: 'album',
    id: 'alb1',
    uri: 'spotify:album:alb1',
    title: 'Comfort In Chaos',
    artist: 'John Summit',
  }
  const artist: ArtistMatch = {
    kind: 'artist',
    id: 'a1',
    uri: 'spotify:artist:a1',
    name: 'John Summit',
    genres: ['house'],
  }
  const playlist: PlaylistMatch = {
    kind: 'playlist',
    id: 'pl1',
    uri: 'spotify:playlist:pl1',
    title: "Today's Top Hits",
    owner: 'Spotify',
  }

  test('rewrites uri to spotify:track:<id> and adds trackTitle on success, but keeps the container id intact', () => {
    expect(withResolvedTrack(album, { id: 'track1', title: 'Where You Are' })).toEqual({
      ...album,
      uri: 'spotify:track:track1',
      trackTitle: 'Where You Are',
    })
    expect(withResolvedTrack(album, { id: 'track1', title: 'Where You Are' }).id).toBe('alb1')
    expect(withResolvedTrack(artist, { id: 'tA', title: 'Light' })).toEqual({
      ...artist,
      uri: 'spotify:track:tA',
      trackTitle: 'Light',
    })
    expect(withResolvedTrack(playlist, { id: 'tP', title: 'Espresso' })).toEqual({
      ...playlist,
      uri: 'spotify:track:tP',
      trackTitle: 'Espresso',
    })
  })

  test('leaves match unchanged when result is null (empty container)', () => {
    expect(withResolvedTrack(album, null)).toEqual(album)
    expect(withResolvedTrack(artist, null)).toEqual(artist)
    expect(withResolvedTrack(playlist, null)).toEqual(playlist)
  })

  test('keeps placeholder uri but attaches resolverError on ResolverFailure', () => {
    const fail = { code: 'spotify_rate_limited' as const, message: 'oh no' }
    expect(withResolvedTrack(album, fail)).toEqual({ ...album, resolverError: fail })
    expect(withResolvedTrack(artist, fail)).toEqual({ ...artist, resolverError: fail })
    expect(withResolvedTrack(playlist, fail)).toEqual({ ...playlist, resolverError: fail })
  })
})

describe('mapWithConcurrency', () => {
  test('never has more than `concurrency` tasks in flight', async () => {
    const { mapWithConcurrency } = require('../modules/spotify/client') as typeof import('../modules/spotify/client')
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 12 }, (_, i) => i)
    await mapWithConcurrency(items, 3, async (i) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 10))
      inFlight--
      return i * 2
    })
    expect(peak).toBe(3)
  })

  test('preserves input order in the output', async () => {
    const { mapWithConcurrency } = require('../modules/spotify/client') as typeof import('../modules/spotify/client')
    const items = ['a', 'b', 'c', 'd', 'e']
    const out = await mapWithConcurrency(items, 2, async (s) => {
      await new Promise((r) => setTimeout(r, Math.random() * 5))
      return s.toUpperCase()
    })
    expect(out).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  test('handles an empty input list without spinning up workers', async () => {
    const { mapWithConcurrency } = require('../modules/spotify/client') as typeof import('../modules/spotify/client')
    const out = await mapWithConcurrency<number, number>([], 5, async (n) => n)
    expect(out).toEqual([])
  })
})

describe('classifyResolverError', () => {
  test('maps known SystemError codes onto ResolverFailure shapes', () => {
    const { classifyResolverError } = require('../modules/spotify/client') as typeof import('../modules/spotify/client')
    const { SystemError } = require('../core/errors') as typeof import('../core/errors')

    expect(classifyResolverError(new SystemError('x', 'http_401')).code).toBe('spotify_auth_failed')
    expect(classifyResolverError(new SystemError('x', 'http_403')).code).toBe('spotify_auth_failed')
    expect(classifyResolverError(new SystemError('x', 'http_429')).code).toBe('spotify_rate_limited')
    expect(classifyResolverError(new SystemError('x', 'http_404')).code).toBe('container_not_found')
    expect(classifyResolverError(new SystemError('x', 'http_500')).code).toBe('spotify_unavailable')
    expect(classifyResolverError(new SystemError('x', 'http_503')).code).toBe('spotify_unavailable')
    expect(classifyResolverError(new SystemError('x', 'something_else')).code).toBe('spotify_resolver_failed')
  })

  test('falls back to spotify_resolver_failed for non-SystemError throws', () => {
    const { classifyResolverError } = require('../modules/spotify/client') as typeof import('../modules/spotify/client')
    expect(classifyResolverError(new Error('boom')).code).toBe('spotify_resolver_failed')
    expect(classifyResolverError('weird').code).toBe('spotify_resolver_failed')
  })
})
