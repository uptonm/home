import type { CommandSpec } from '../../../core/types'
import { getAlbumTracks, getArtistAlbums, getArtistTopTracks, getPlaylistTracks, readSpotifyConfig } from '../client'
import { parseLimit, parseMarket, parseOffset, resolveRef } from './shared'

// Tier 2 — children listings. These promote the search resolver's internal
// "first track" peeks into full first-class listings: each track row carries a
// directly-playable `spotify:track:<id>` uri, each album row its canonical
// `spotify:album:<id>`.

const refArg = {
  name: 'ref',
  kind: 'positional' as const,
  description: 'Spotify id, spotify:<type>:<id> URI, or open.spotify.com URL',
  required: true,
}
const limitArg = { name: 'limit', kind: 'number' as const, description: 'Page size (1-50, default 20)' }
const offsetArg = { name: 'offset', kind: 'number' as const, description: 'Page offset (default 0)' }
const marketArg = { name: 'market', kind: 'string' as const, description: 'ISO 3166-1 alpha-2 country code (default US)' }

export const albumTracks: CommandSpec = {
  path: ['album', 'tracks'],
  effect: 'read',
  description: 'List an album\'s tracks (paged). Each row is a Sonos-playable spotify:track URI.',
  args: [refArg, limitArg, offsetArg, marketArg],
  examples: [
    'home spotify album tracks spotify:album:5r36AJ6VOJtp00oxSkBZ5h --json',
    'home spotify album tracks 5r36AJ6VOJtp00oxSkBZ5h --limit 50 --json | jq \'.items[].uri\'',
  ],
  async run(ctx) {
    const ref = resolveRef(ctx.args.ref, 'album')
    if ('error' in ref) return ref.error
    const market = parseMarket(ctx.args.market)
    if ('error' in market) return market.error
    const limit = parseLimit(ctx.args.limit)
    if ('error' in limit) return limit.error
    const offset = parseOffset(ctx.args.offset)
    if ('error' in offset) return offset.error
    const data = await getAlbumTracks(readSpotifyConfig(ctx.config), ref.id, {
      market: market.market,
      limit: limit.limit,
      offset: offset.offset,
    })
    return { ok: true, data }
  },
}

export const artistAlbums: CommandSpec = {
  path: ['artist', 'albums'],
  effect: 'read',
  description: "List an artist's albums (paged). Each row is a canonical spotify:album URI.",
  args: [refArg, limitArg, offsetArg, marketArg],
  examples: ['home spotify artist albums spotify:artist:7kNqXtgeIwFtelmRjWv205 --limit 10 --json'],
  async run(ctx) {
    const ref = resolveRef(ctx.args.ref, 'artist')
    if ('error' in ref) return ref.error
    const market = parseMarket(ctx.args.market)
    if ('error' in market) return market.error
    const limit = parseLimit(ctx.args.limit)
    if ('error' in limit) return limit.error
    const offset = parseOffset(ctx.args.offset)
    if ('error' in offset) return offset.error
    const data = await getArtistAlbums(readSpotifyConfig(ctx.config), ref.id, {
      market: market.market,
      limit: limit.limit,
      offset: offset.offset,
    })
    return { ok: true, data }
  },
}

export const artistTopTracks: CommandSpec = {
  path: ['artist', 'top-tracks'],
  effect: 'read',
  description: "List an artist's top tracks for a market. Each row is a Sonos-playable spotify:track URI.",
  args: [refArg, marketArg],
  examples: ['home spotify artist top-tracks spotify:artist:7kNqXtgeIwFtelmRjWv205 --market US --json'],
  async run(ctx) {
    const ref = resolveRef(ctx.args.ref, 'artist')
    if ('error' in ref) return ref.error
    const market = parseMarket(ctx.args.market)
    if ('error' in market) return market.error
    const data = await getArtistTopTracks(readSpotifyConfig(ctx.config), ref.id, market.market)
    return { ok: true, data }
  },
}

export const playlistTracks: CommandSpec = {
  path: ['playlist', 'tracks'],
  effect: 'read',
  description: "List a playlist's tracks (paged). Each row is a Sonos-playable spotify:track URI.",
  args: [refArg, limitArg, offsetArg, marketArg],
  examples: ['home spotify playlist tracks spotify:playlist:37i9dQZF1DXcBWIGoYBM5M --limit 50 --json'],
  async run(ctx) {
    const ref = resolveRef(ctx.args.ref, 'playlist')
    if ('error' in ref) return ref.error
    const market = parseMarket(ctx.args.market)
    if ('error' in market) return market.error
    const limit = parseLimit(ctx.args.limit)
    if ('error' in limit) return limit.error
    const offset = parseOffset(ctx.args.offset)
    if ('error' in offset) return offset.error
    const data = await getPlaylistTracks(readSpotifyConfig(ctx.config), ref.id, {
      market: market.market,
      limit: limit.limit,
      offset: offset.offset,
    })
    return { ok: true, data }
  },
}
