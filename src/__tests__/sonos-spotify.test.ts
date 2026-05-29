import { describe, expect, test } from 'bun:test'
import { buildSpotifyTransportUri, isPlayableSpotifyUri, translateSpotifyInput } from '../modules/sonos/spotify'

describe('translateSpotifyInput', () => {
  test('passes through canonical spotify URIs', () => {
    expect(translateSpotifyInput('spotify:track:7qiZfU4dY1lWllzX7mPBI3')).toBe('spotify:track:7qiZfU4dY1lWllzX7mPBI3')
    expect(translateSpotifyInput('spotify:album:5r36AJ6VOJtp00oxSkBZ5h')).toBe('spotify:album:5r36AJ6VOJtp00oxSkBZ5h')
  })

  test('translates open.spotify.com share URLs (track/album/playlist)', () => {
    expect(translateSpotifyInput('https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3'))
      .toBe('spotify:track:7qiZfU4dY1lWllzX7mPBI3')
    expect(translateSpotifyInput('https://open.spotify.com/album/5r36AJ6VOJtp00oxSkBZ5h?si=abc'))
      .toBe('spotify:album:5r36AJ6VOJtp00oxSkBZ5h')
    expect(translateSpotifyInput('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'))
      .toBe('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')
  })

  test('handles intl-xx locale prefix in share URLs', () => {
    expect(translateSpotifyInput('https://open.spotify.com/intl-de/track/7qiZfU4dY1lWllzX7mPBI3'))
      .toBe('spotify:track:7qiZfU4dY1lWllzX7mPBI3')
  })

  test('maps artist share URL to canonical spotify:artist — the guard then rejects it cleanly', () => {
    expect(translateSpotifyInput('https://open.spotify.com/artist/4tZwfgrHOc3mvqYlEYSvVi'))
      .toBe('spotify:artist:4tZwfgrHOc3mvqYlEYSvVi')
  })

  test('returns non-Spotify input unchanged', () => {
    expect(translateSpotifyInput('https://ice1.somafm.com/groovesalad-128-mp3'))
      .toBe('https://ice1.somafm.com/groovesalad-128-mp3')
    expect(translateSpotifyInput('apple:song:1234')).toBe('apple:song:1234')
  })
})

describe('buildSpotifyTransportUri', () => {
  const acct = { sid: 12, sn: 7 }

  test('builds track URI (x-sonos-spotify scheme, no colon escaping)', () => {
    expect(buildSpotifyTransportUri('spotify:track:7oK9VyNzrYvRFo7nQEYkWN', acct))
      .toBe('x-sonos-spotify:spotify:track:7oK9VyNzrYvRFo7nQEYkWN?sid=12&flags=8224&sn=7')
  })

  test('builds album URI (cpcontainer with %3a-escaped id)', () => {
    expect(buildSpotifyTransportUri('spotify:album:5r36AJ6VOJtp00oxSkBZ5h', acct))
      .toBe('x-rincon-cpcontainer:1004206cspotify%3aalbum%3a5r36AJ6VOJtp00oxSkBZ5h?sid=12&flags=8300&sn=7')
  })

  test('builds playlist URI', () => {
    expect(buildSpotifyTransportUri('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', acct))
      .toBe('x-rincon-cpcontainer:1006206cspotify%3aplaylist%3a37i9dQZF1DXcBWIGoYBM5M?sid=12&flags=8300&sn=7')
  })

  test('builds artistTopTracks URI', () => {
    expect(buildSpotifyTransportUri('spotify:artistTopTracks:4tZwfgrHOc3mvqYlEYSvVi', acct))
      .toBe('x-rincon-cpcontainer:100e206cspotify%3aartistTopTracks%3a4tZwfgrHOc3mvqYlEYSvVi?sid=12&flags=8300&sn=7')
  })

  test('honors a different account (sid/sn)', () => {
    expect(buildSpotifyTransportUri('spotify:track:abc', { sid: 9, sn: 3 }))
      .toBe('x-sonos-spotify:spotify:track:abc?sid=9&flags=8224&sn=3')
  })

  test('returns null for non-Spotify input', () => {
    expect(buildSpotifyTransportUri('https://example.com/song.mp3', acct)).toBeNull()
  })

  test('returns null for unsupported spotify kind', () => {
    expect(buildSpotifyTransportUri('spotify:show:1234', acct)).toBeNull()
  })
})

describe('isPlayableSpotifyUri', () => {
  test('accepts spotify:track:<id>', () => {
    expect(isPlayableSpotifyUri('spotify:track:7oK9VyNzrYvRFo7nQEYkWN')).toBe(true)
  })

  test('rejects every container shape (album / artist / playlist / artistTopTracks / user / artistRadio)', () => {
    expect(isPlayableSpotifyUri('spotify:album:5r36AJ6VOJtp00oxSkBZ5h')).toBe(false)
    expect(isPlayableSpotifyUri('spotify:artist:7kNqXtgeIwFtelmRjWv205')).toBe(false)
    expect(isPlayableSpotifyUri('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')).toBe(false)
    expect(isPlayableSpotifyUri('spotify:artistTopTracks:7kNqXtgeIwFtelmRjWv205')).toBe(false)
    expect(isPlayableSpotifyUri('spotify:user:7kNqXtgeIwFtelmRjWv205')).toBe(false)
    expect(isPlayableSpotifyUri('spotify:artistRadio:7kNqXtgeIwFtelmRjWv205')).toBe(false)
  })

  test('rejects malformed Spotify track IDs (real IDs are 22 base62 chars)', () => {
    expect(isPlayableSpotifyUri('spotify:track:tooshort')).toBe(false)
    expect(isPlayableSpotifyUri('spotify:track:waytoolongtobeavalidspotifyid')).toBe(false)
    expect(isPlayableSpotifyUri('spotify:track:contains-dashes-not-base62')).toBe(false)
    expect(isPlayableSpotifyUri('spotify:track:')).toBe(false)
  })

  test('rejects non-Spotify input', () => {
    expect(isPlayableSpotifyUri('https://example.com/song.mp3')).toBe(false)
    expect(isPlayableSpotifyUri('apple:song:1234')).toBe(false)
    expect(isPlayableSpotifyUri('')).toBe(false)
  })
})
