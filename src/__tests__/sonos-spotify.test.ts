import { describe, expect, test } from 'bun:test'
import { rewriteSpotifySession, translateSpotifyInput } from '../modules/sonos/spotify'

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

  test('maps artist share URL to artistTopTracks (library convention)', () => {
    expect(translateSpotifyInput('https://open.spotify.com/artist/4tZwfgrHOc3mvqYlEYSvVi'))
      .toBe('spotify:artistTopTracks:4tZwfgrHOc3mvqYlEYSvVi')
  })

  test('returns non-Spotify input unchanged', () => {
    expect(translateSpotifyInput('https://ice1.somafm.com/groovesalad-128-mp3'))
      .toBe('https://ice1.somafm.com/groovesalad-128-mp3')
    expect(translateSpotifyInput('apple:song:1234')).toBe('apple:song:1234')
  })
})

describe('rewriteSpotifySession', () => {
  test('replaces sn= with the new value in cpcontainer URIs', () => {
    const input = 'x-rincon-cpcontainer:1004206cspotify%3aalbum%3a5r36AJ6VOJtp00oxSkBZ5h?sid=9&flags=8300&sn=7'
    expect(rewriteSpotifySession(input, 3)).toBe(
      'x-rincon-cpcontainer:1004206cspotify%3aalbum%3a5r36AJ6VOJtp00oxSkBZ5h?sid=9&flags=8300&sn=3',
    )
  })

  test('replaces sn= when it appears first in the query (& form)', () => {
    const input = 'x-sonos-spotify:spotify%3atrack%3a7qiZfU4dY1lWllzX7mPBI3?sid=9&amp;flags=8224&amp;sn=7'
    expect(rewriteSpotifySession(input, 12)).toBe(
      'x-sonos-spotify:spotify%3atrack%3a7qiZfU4dY1lWllzX7mPBI3?sid=9&amp;flags=8224&amp;sn=12',
    )
  })

  test('leaves URI alone when there is no sn= parameter', () => {
    expect(rewriteSpotifySession('https://example.com', 5)).toBe('https://example.com')
  })
})
