import { describe, expect, test } from 'bun:test'
import { buildSearchUrl, normalizeSearchResponse } from '../modules/spotify/client'

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
