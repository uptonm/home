import type { CommandSpec } from '../../../core/types'
import { getAlbum, getArtist, getPlaylist, getTrack, readSpotifyConfig } from '../client'
import { resolveRef } from './shared'

// Tier 1 — get-by-id. Each promotes the search module's "find many" into
// "fetch one" on the same client-credentials token. The `<ref>` accepts a bare
// id, a `spotify:<type>:<id>` URI, or an open.spotify.com share URL.

const refArg = {
  name: 'ref',
  kind: 'positional' as const,
  description: 'Spotify id, spotify:<type>:<id> URI, or open.spotify.com URL',
  required: true,
}

export const trackGet: CommandSpec = {
  path: ['track', 'get'],
  description: 'Fetch one track by id/URI/URL. Returns a Sonos-playable spotify:track URI.',
  args: [refArg],
  examples: [
    'home spotify track get spotify:track:7oK9VyNzrYvRFo7nQEYkWN --json',
    'home spotify track get https://open.spotify.com/track/7oK9VyNzrYvRFo7nQEYkWN --json',
  ],
  async run(ctx) {
    const ref = resolveRef(ctx.args.ref, 'track')
    if ('error' in ref) return ref.error
    const data = await getTrack(readSpotifyConfig(ctx.config), ref.id)
    return { ok: true, data }
  },
}

export const albumGet: CommandSpec = {
  path: ['album', 'get'],
  description: 'Fetch one album by id/URI/URL (metadata + canonical spotify:album URI).',
  args: [refArg],
  examples: ['home spotify album get spotify:album:5r36AJ6VOJtp00oxSkBZ5h --json'],
  async run(ctx) {
    const ref = resolveRef(ctx.args.ref, 'album')
    if ('error' in ref) return ref.error
    const data = await getAlbum(readSpotifyConfig(ctx.config), ref.id)
    return { ok: true, data }
  },
}

export const artistGet: CommandSpec = {
  path: ['artist', 'get'],
  description: 'Fetch one artist by id/URI/URL (genres, popularity, followers).',
  args: [refArg],
  examples: ['home spotify artist get spotify:artist:7kNqXtgeIwFtelmRjWv205 --json'],
  async run(ctx) {
    const ref = resolveRef(ctx.args.ref, 'artist')
    if ('error' in ref) return ref.error
    const data = await getArtist(readSpotifyConfig(ctx.config), ref.id)
    return { ok: true, data }
  },
}

export const playlistGet: CommandSpec = {
  path: ['playlist', 'get'],
  description: 'Fetch one playlist by id/URI/URL (owner, track count).',
  args: [refArg],
  examples: ['home spotify playlist get spotify:playlist:37i9dQZF1DXcBWIGoYBM5M --json'],
  async run(ctx) {
    const ref = resolveRef(ctx.args.ref, 'playlist')
    if ('error' in ref) return ref.error
    const data = await getPlaylist(readSpotifyConfig(ctx.config), ref.id)
    return { ok: true, data }
  },
}
