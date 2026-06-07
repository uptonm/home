import type { Track } from '@svrooij/sonos/lib/models'
import type { CommandSpec, RunResult } from '../../../core/types'
import { discover, readSonosConfig } from '../client'

/** Music-library category → ContentDirectory ObjectID root. */
const CATEGORIES: Record<string, string> = {
  artists: 'A:ARTIST',
  albumartists: 'A:ALBUMARTIST',
  albums: 'A:ALBUM',
  genres: 'A:GENRE',
  composers: 'A:COMPOSER',
  tracks: 'A:TRACKS',
  playlists: 'A:PLAYLISTS',
}

/** Resolve a category name to its ObjectID root; null if unknown. */
export function libraryCategoryId(category: string): string | null {
  return CATEGORIES[category.toLowerCase()] ?? null
}

const CATEGORY_LIST = Object.keys(CATEGORIES).join(', ')

function shapeRow(t: Track) {
  return { title: t.Title, artist: t.Artist, album: t.Album, itemId: t.ItemId, uri: t.TrackUri, upnpClass: t.UpnpClass }
}

export const libraryBrowse: CommandSpec = {
  path: ['library', 'browse'],
  description: `Browse the local music library by category (${CATEGORY_LIST}). Pass --id to drill into a container returned by a previous browse.`,
  args: [
    { name: 'category', kind: 'positional', description: `One of: ${CATEGORY_LIST}`, required: true },
    { name: 'id', kind: 'string', description: 'Browse this exact ObjectID instead of the category root (e.g. A:ALBUM/Some%20Album)' },
    { name: 'limit', kind: 'number', description: 'Max rows to return (default 100)' },
    { name: 'start', kind: 'number', description: 'Paging start offset (default 0)' },
  ],
  examples: [
    'home sonos library browse artists',
    'home sonos library browse albums --limit 50 --json',
  ],
  async run(ctx): Promise<RunResult> {
    const category = ctx.args.category ? String(ctx.args.category) : undefined
    if (!category) return { ok: false, kind: 'user', message: 'category is required', code: 'missing_arg' }
    const base = libraryCategoryId(category)
    if (!base) return { ok: false, kind: 'user', message: `unknown category "${category}" — use one of: ${CATEGORY_LIST}`, code: 'bad_arg' }
    const objectId = ctx.args.id ? String(ctx.args.id) : base
    const limit = ctx.args.limit !== undefined ? Math.max(1, Math.min(1000, Number(ctx.args.limit))) : 100
    const start = ctx.args.start !== undefined ? Math.max(0, Number(ctx.args.start)) : 0

    const mgr = await discover(readSonosConfig(ctx.config))
    const device = mgr.Devices[0]
    if (!device) return { ok: false, kind: 'system', message: 'no Sonos devices discovered', code: 'no_devices' }
    const r = await device.ContentDirectoryService.Browse({ ObjectID: objectId, BrowseFlag: 'BrowseDirectChildren', Filter: '*', StartingIndex: start, RequestedCount: limit, SortCriteria: '' })
    const items = Array.isArray(r.Result) ? r.Result : []
    return { ok: true, data: { objectId, total: r.TotalMatches, returned: r.NumberReturned, items: items.map(shapeRow) } }
  },
}

export const librarySearch: CommandSpec = {
  path: ['library', 'search'],
  description: `Search the local music library within a category (${CATEGORY_LIST})`,
  args: [
    { name: 'category', kind: 'positional', description: `One of: ${CATEGORY_LIST}`, required: true },
    { name: 'query', kind: 'positional', description: 'Search text', required: true },
    { name: 'limit', kind: 'number', description: 'Max rows to return (default 100)' },
  ],
  examples: [
    'home sonos library search artists "miles davis"',
    'home sonos library search albums kind --json',
  ],
  async run(ctx): Promise<RunResult> {
    const category = ctx.args.category ? String(ctx.args.category) : undefined
    const query = ctx.args.query ? String(ctx.args.query) : undefined
    if (!category) return { ok: false, kind: 'user', message: 'category is required', code: 'missing_arg' }
    if (!query) return { ok: false, kind: 'user', message: 'query is required', code: 'missing_arg' }
    const base = libraryCategoryId(category)
    if (!base) return { ok: false, kind: 'user', message: `unknown category "${category}" — use one of: ${CATEGORY_LIST}`, code: 'bad_arg' }
    const limit = ctx.args.limit !== undefined ? Math.max(1, Math.min(1000, Number(ctx.args.limit))) : 100

    const mgr = await discover(readSonosConfig(ctx.config))
    const device = mgr.Devices[0]
    if (!device) return { ok: false, kind: 'system', message: 'no Sonos devices discovered', code: 'no_devices' }
    // ContentDirectory does a contains-search when the term is appended to the
    // category ObjectID with a colon.
    const objectId = `${base}:${query}`
    const r = await device.ContentDirectoryService.Browse({ ObjectID: objectId, BrowseFlag: 'BrowseDirectChildren', Filter: '*', StartingIndex: 0, RequestedCount: limit, SortCriteria: '' })
    const items = Array.isArray(r.Result) ? r.Result : []
    return { ok: true, data: { objectId, query, total: r.TotalMatches, returned: r.NumberReturned, items: items.map(shapeRow) } }
  },
}
