import type { CommandSpec } from '../../../core/types'
import {
  SPOTIFY_SEARCH_TYPES,
  readSpotifyConfig,
  search,
  type SpotifySearchType,
} from '../client'

const DEFAULT_TYPES: SpotifySearchType[] = ['track', 'album', 'artist', 'playlist']
const DEFAULT_LIMIT = 5
// Spotify Client Credentials budget is ~180 req/min. The downstream resolver
// (feat/spotify-resolve-tracks) issues up to one extra parallel request per
// container match returned here; capping at 20 keeps worst-case parallelism
// at 60 requests/search (well under the budget) even at --limit 20 with all
// three container types.
const MAX_LIMIT = 20
const DEFAULT_MARKET = 'US'

function parseTypes(input: string | undefined): { types: SpotifySearchType[]; error?: string } {
  if (!input) return { types: DEFAULT_TYPES }
  const requested = input
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (requested.length === 0) return { types: DEFAULT_TYPES }
  const invalid = requested.filter((t) => !(SPOTIFY_SEARCH_TYPES as readonly string[]).includes(t))
  if (invalid.length > 0) {
    return {
      types: [],
      error: `invalid --type value(s): ${invalid.join(', ')} — allowed: ${SPOTIFY_SEARCH_TYPES.join(', ')}`,
    }
  }
  return { types: requested as SpotifySearchType[] }
}

export const searchCmd: CommandSpec = {
  path: ['search'],
  description: 'Search Spotify catalog (tracks, albums, artists, playlists). Returns Sonos-playable URIs.',
  args: [
    { name: 'query', kind: 'positional', description: 'Freeform Spotify search query', required: true },
    {
      name: 'type',
      kind: 'string',
      description: `Comma-separated subset of: ${SPOTIFY_SEARCH_TYPES.join(', ')} (default: all)`,
    },
    { name: 'limit', kind: 'number', description: 'Per-type result cap (1-20, default 5)' },
    { name: 'market', kind: 'string', description: 'ISO 3166-1 alpha-2 country code (default US)' },
  ],
  examples: [
    'home spotify search "John Summit" --type artist --limit 3 --json',
    'home spotify search "OK Computer" --type album --json',
    'home spotify search "Today\'s Top Hits" --type playlist --json | jq \'.playlists[0].uri\'',
  ],
  async run(ctx) {
    const query = String(ctx.args.query ?? '').trim()
    if (!query) return { ok: false, kind: 'user', message: 'query is required', code: 'missing_arg' }

    const typeParse = parseTypes(ctx.args.type !== undefined ? String(ctx.args.type) : undefined)
    if (typeParse.error) return { ok: false, kind: 'user', message: typeParse.error, code: 'bad_arg' }

    const limitRaw = ctx.args.limit !== undefined ? Number(ctx.args.limit) : DEFAULT_LIMIT
    if (!Number.isFinite(limitRaw) || limitRaw < 1) {
      return { ok: false, kind: 'user', message: 'limit must be a positive number', code: 'bad_arg' }
    }
    const limit = Math.min(Math.floor(limitRaw), MAX_LIMIT)

    const market = ctx.args.market !== undefined ? String(ctx.args.market).toUpperCase() : DEFAULT_MARKET
    if (!/^[A-Z]{2}$/.test(market)) {
      return { ok: false, kind: 'user', message: 'market must be a 2-letter country code', code: 'bad_arg' }
    }

    const cfg = readSpotifyConfig(ctx.config)
    const data = await search(cfg, { query, types: typeParse.types, limit, market })
    return { ok: true, data }
  },
}
