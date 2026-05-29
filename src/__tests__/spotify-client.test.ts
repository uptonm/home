import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  authedRequestJson,
  buildSearchUrl,
  getAccessToken,
  normalizeSearchResponse,
  resetTokenCache,
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

describe('normalizeSearchResponse', () => {
  test('maps a full Spotify response into the normalized shape', () => {
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
      uri: 'spotify:track:track123',
      title: 'Light',
      artist: 'John Summit',
      album: 'Comfort In Chaos',
      releaseDate: '2024-08-09',
      durationMs: 218456,
      explicit: false,
    })
    expect(out.albums[0]).toEqual({
      uri: 'spotify:album:alb1',
      title: 'Comfort In Chaos',
      artist: 'John Summit',
      releaseDate: '2024-08-09',
      totalTracks: 14,
      albumType: 'album',
    })
    expect(out.artists[0]).toEqual({
      uri: 'spotify:artistTopTracks:a1',
      name: 'John Summit',
      genres: ['house', 'tech house'],
      popularity: 78,
      followers: 1234567,
    })
    expect(out.playlists[0]).toEqual({
      uri: 'spotify:playlist:pl1',
      title: 'John Summit Radio',
      owner: 'Spotify',
      totalTracks: 50,
      public: true,
    })
  })

  test('emits spotify:artistTopTracks: (not spotify:artist:) so the Sonos pipeline can play it directly', () => {
    const out = normalizeSearchResponse({ artists: { items: [{ id: 'xyz', name: 'X' }] } })
    expect(out.artists[0]!.uri).toBe('spotify:artistTopTracks:xyz')
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
