import type { CommandSpec } from '../../../core/types'
import { getCategory, listCategories, listNewReleases, readSpotifyConfig } from '../client'
import { parseLimit, parseMarket, parseOffset } from './shared'

// Tier 3 — browse. Only the still-available browse endpoints: new-releases and
// categories. Featured-playlists and a category's playlists are deliberately
// excluded — Spotify restricted them to legacy apps as of 2024-11-27, so a
// fresh clientId gets 403/404.

const limitArg = { name: 'limit', kind: 'number' as const, description: 'Page size (1-50, default 20)' }
const offsetArg = { name: 'offset', kind: 'number' as const, description: 'Page offset (default 0)' }
const marketArg = { name: 'market', kind: 'string' as const, description: 'ISO 3166-1 alpha-2 country code (default US)' }

export const newReleases: CommandSpec = {
  path: ['new-releases'],
  description: 'List newly released albums. Each row is a canonical spotify:album URI.',
  args: [marketArg, limitArg, offsetArg],
  examples: [
    'home spotify new-releases --json',
    'home spotify new-releases --market GB --limit 10 --json | jq \'.items[].title\'',
  ],
  async run(ctx) {
    const market = parseMarket(ctx.args.market)
    if ('error' in market) return market.error
    const limit = parseLimit(ctx.args.limit)
    if ('error' in limit) return limit.error
    const offset = parseOffset(ctx.args.offset)
    if ('error' in offset) return offset.error
    const data = await listNewReleases(readSpotifyConfig(ctx.config), {
      market: market.market,
      limit: limit.limit,
      offset: offset.offset,
    })
    return { ok: true, data }
  },
}

export const categoriesList: CommandSpec = {
  path: ['categories', 'list'],
  description: 'List Spotify browse categories (paged).',
  args: [marketArg, limitArg, offsetArg],
  examples: ['home spotify categories list --market US --limit 50 --json'],
  async run(ctx) {
    const market = parseMarket(ctx.args.market)
    if ('error' in market) return market.error
    const limit = parseLimit(ctx.args.limit)
    if ('error' in limit) return limit.error
    const offset = parseOffset(ctx.args.offset)
    if ('error' in offset) return offset.error
    const data = await listCategories(readSpotifyConfig(ctx.config), {
      market: market.market,
      limit: limit.limit,
      offset: offset.offset,
    })
    return { ok: true, data }
  },
}

export const categoriesGet: CommandSpec = {
  path: ['categories', 'get'],
  description: 'Fetch one browse category by id (e.g. "toplists", "pop").',
  args: [{ name: 'id', kind: 'positional', description: 'Spotify category id', required: true }],
  examples: ['home spotify categories get toplists --json'],
  async run(ctx) {
    // Category ids are short slugs ("pop", "toplists"), not 22-char Spotify
    // ids, so they bypass the ref resolver and pass straight through.
    const id = String(ctx.args.id ?? '').trim()
    if (!id) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }
    const data = await getCategory(readSpotifyConfig(ctx.config), id)
    return { ok: true, data }
  },
}
