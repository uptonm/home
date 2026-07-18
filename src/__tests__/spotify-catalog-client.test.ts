import { describe, expect, test } from 'bun:test'
import {
  normalizeAlbumPage,
  normalizeCategoryPage,
  normalizeNewReleases,
  normalizePlaylistTrackPage,
  normalizeTopTracks,
  normalizeTrackPage,
  shapeAlbum,
  shapeArtist,
  shapeCategory,
  shapePlaylist,
  shapeTrack,
} from '../modules/spotify/client'

// Pure response-shaping coverage. These functions are never overridden by the
// command files' `mock.module` (which only stub the async fetch methods and
// spread `...realClient`), so they stay real here regardless of test ordering.

describe('get-by-id shaping', () => {
  test('shapeTrack emits a playable spotify:track uri and joins artists', () => {
    expect(
      shapeTrack({
        id: 't1',
        name: 'Light',
        artists: [{ id: 'a', name: 'John Summit' }, { id: 'b', name: 'Hayla' }],
        album: { id: 'al', name: 'Comfort In Chaos', release_date: '2024-08-09' },
        duration_ms: 218456,
        explicit: false,
      }),
    ).toEqual({
      kind: 'track',
      id: 't1',
      uri: 'spotify:track:t1',
      title: 'Light',
      artist: 'John Summit, Hayla',
      album: 'Comfort In Chaos',
      releaseDate: '2024-08-09',
      durationMs: 218456,
      explicit: false,
    })
  })

  test('shapeTrack tolerates an album-track row with no album field', () => {
    const out = shapeTrack({ id: 't', name: 'Bare', artists: [{ id: 'a', name: 'X' }] })
    expect(out.album).toBe('')
    expect(out.uri).toBe('spotify:track:t')
    expect(out.id).toBe('t')
  })

  test('shapeAlbum and shapeCategory shape their entities', () => {
    expect(shapeAlbum({ id: 'al', name: 'A', artists: [{ id: 'a', name: 'X' }], total_tracks: 12 })).toMatchObject({
      kind: 'album',
      id: 'al',
      uri: 'spotify:album:al',
      totalTracks: 12,
    })
    expect(shapeCategory({ id: 'toplists', name: 'Top Lists' })).toEqual({ kind: 'category', id: 'toplists', name: 'Top Lists' })
  })

  test('shapeArtist echoes id alongside genres/popularity/followers', () => {
    expect(
      shapeArtist({ id: 'a1', name: 'John Summit', genres: ['house', 'tech house'], popularity: 78, followers: { total: 1234567 } }),
    ).toEqual({
      kind: 'artist',
      id: 'a1',
      uri: 'spotify:artist:a1',
      name: 'John Summit',
      genres: ['house', 'tech house'],
      popularity: 78,
      followers: 1234567,
    })
  })

  test('shapePlaylist echoes id alongside owner/track-count/visibility', () => {
    expect(
      shapePlaylist({ id: 'pl1', name: "Today's Top Hits", owner: { display_name: 'Spotify', id: 'spotify' }, tracks: { total: 50 }, public: true }),
    ).toEqual({
      kind: 'playlist',
      id: 'pl1',
      uri: 'spotify:playlist:pl1',
      title: "Today's Top Hits",
      owner: 'Spotify',
      totalTracks: 50,
      public: true,
    })
  })

  test('shape* fns fall back to an empty-string id instead of `undefined` when the raw row has none', () => {
    expect(shapeTrack({ name: 'No ID' }).id).toBe('')
    expect(shapeAlbum({ name: 'No ID' }).id).toBe('')
    expect(shapeArtist({ name: 'No ID' }).id).toBe('')
    expect(shapePlaylist({ name: 'No ID' }).id).toBe('')
  })
})

describe('children normalizers', () => {
  test('album tracks → playable URIs + paging metadata, drops null rows', () => {
    const out = normalizeTrackPage({ items: [{ id: 't1', name: 'One', artists: [{ id: 'a', name: 'X' }] }, null], total: 14, limit: 50, offset: 0 })
    expect(out.items).toHaveLength(1)
    expect(out.items[0]!.uri).toBe('spotify:track:t1')
    expect(out.total).toBe(14)
    expect(out.limit).toBe(50)
  })

  test('artist albums → album URIs + paging', () => {
    const out = normalizeAlbumPage({ items: [{ id: 'al1', name: 'A', artists: [{ id: 'a', name: 'X' }] }, null], total: 5, limit: 10, offset: 0 })
    expect(out.items).toHaveLength(1)
    expect(out.items[0]!.uri).toBe('spotify:album:al1')
    expect(out.total).toBe(5)
  })

  test('playlist tracks unwrap {track} and drop null / id-less / removed rows', () => {
    const out = normalizePlaylistTrackPage({
      items: [
        { track: { id: 'p1', name: 'A', artists: [{ id: 'a', name: 'X' }] } },
        { track: null },
        { track: { name: 'no id' } },
        null,
      ],
      total: 3,
      limit: 20,
      offset: 0,
    })
    expect(out.items).toHaveLength(1)
    expect(out.items[0]!.uri).toBe('spotify:track:p1')
  })

  test('artist top-tracks read the flat {tracks:[...]} envelope (not paged)', () => {
    const out = normalizeTopTracks({ tracks: [{ id: 'top1', name: 'Hit', artists: [{ id: 'a', name: 'X' }], album: { id: 'al', name: 'Album' } }, null] })
    expect(out.items).toHaveLength(1)
    expect(out.items[0]!.uri).toBe('spotify:track:top1')
    expect(out.total).toBeUndefined()
  })
})

describe('browse normalizers', () => {
  test('new-releases unwraps {albums:{items}} into album URIs + paging', () => {
    const out = normalizeNewReleases({ albums: { items: [{ id: 'alb1', name: 'New One', artists: [{ id: 'a', name: 'X' }] }, null], total: 100, limit: 20, offset: 0 } })
    expect(out.items).toHaveLength(1)
    expect(out.items[0]!.uri).toBe('spotify:album:alb1')
    expect(out.total).toBe(100)
  })

  test('categories unwraps {categories:{items}} and drops id-less rows', () => {
    const out = normalizeCategoryPage({ categories: { items: [{ id: 'toplists', name: 'Top Lists' }, null, { name: 'no id' }], total: 1, limit: 20, offset: 0 } })
    expect(out.items).toHaveLength(1)
    expect(out.items[0]).toEqual({ kind: 'category', id: 'toplists', name: 'Top Lists' })
  })

  test('normalizers tolerate empty / missing envelopes', () => {
    expect(normalizeNewReleases({}).items).toEqual([])
    expect(normalizeCategoryPage({}).items).toEqual([])
    expect(normalizeTrackPage({}).items).toEqual([])
  })
})
