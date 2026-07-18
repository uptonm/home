import { MetaDataHelper } from '@svrooij/sonos'
import type { Track } from '@svrooij/sonos/lib/models'
import type SonosDevice from '@svrooij/sonos/lib/sonos-device'
import type { CommandSpec, RunResult } from '../../../core/types'
import { discover, enqueueAndPlay, readSonosConfig, withRoom } from '../client'

const BROWSE = { BrowseFlag: 'BrowseDirectChildren', Filter: '*', StartingIndex: 0, RequestedCount: 1000, SortCriteria: '' } as const

async function browseChildren(d: SonosDevice, objectId: string): Promise<Track[]> {
  const r = await d.ContentDirectoryService.Browse({ ObjectID: objectId, ...BROWSE })
  return Array.isArray(r.Result) ? r.Result : []
}

export type ResolvePlaylist =
  | { kind: 'ok'; playlist: Track }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; candidates: string[] }

/** Resolve a saved queue / Sonos playlist by title (exact, else unique substring). */
export function resolvePlaylist(items: Track[], name: string): ResolvePlaylist {
  const lower = name.toLowerCase()
  const exact = items.filter((t) => (t.Title ?? '').toLowerCase() === lower)
  if (exact.length === 1) return { kind: 'ok', playlist: exact[0]! }
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact.map((t) => t.Title ?? '').sort() }
  const sub = items.filter((t) => (t.Title ?? '').toLowerCase().includes(lower))
  if (sub.length === 1) return { kind: 'ok', playlist: sub[0]! }
  if (sub.length > 1) return { kind: 'ambiguous', candidates: sub.map((t) => t.Title ?? '').sort() }
  return { kind: 'not_found' }
}

export const playlistsList: CommandSpec = {
  path: ['playlists', 'list'],
  effect: 'read',
  description: 'List Sonos playlists (saved queues, SQ:)',
  args: [],
  examples: ['home sonos playlists list', 'home sonos playlists list --json'],
  async run(ctx) {
    const mgr = await discover(readSonosConfig(ctx.config))
    const device = mgr.Devices[0]
    if (!device) return { ok: false, kind: 'system', message: 'no Sonos devices discovered', code: 'no_devices' }
    const items = await browseChildren(device, 'SQ:')
    const data = items.map((t) => ({ title: t.Title, itemId: t.ItemId, uri: t.TrackUri }))
    return { ok: true, data }
  },
}

export const playlistsGet: CommandSpec = {
  path: ['playlists', 'get'],
  effect: 'read',
  description: 'Show the tracks in a Sonos playlist (by title)',
  args: [{ name: 'name', kind: 'positional', description: 'Playlist title (case-insensitive, exact or unique substring)', required: true }],
  examples: ['home sonos playlists get "Dinner"', 'home sonos playlists get Dinner --json'],
  async run(ctx): Promise<RunResult> {
    const name = ctx.args.name ? String(ctx.args.name) : undefined
    if (!name) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }
    const mgr = await discover(readSonosConfig(ctx.config))
    const device = mgr.Devices[0]
    if (!device) return { ok: false, kind: 'system', message: 'no Sonos devices discovered', code: 'no_devices' }

    const playlists = await browseChildren(device, 'SQ:')
    const sel = resolvePlaylist(playlists, name)
    if (sel.kind === 'not_found') return { ok: false, kind: 'user', message: `no playlist matching "${name}"`, code: 'not_found' }
    if (sel.kind === 'ambiguous') return { ok: false, kind: 'user', message: `playlist is ambiguous — candidates: ${sel.candidates.join(', ')}`, code: 'ambiguous' }

    const id = sel.playlist.ItemId
    if (!id) return { ok: false, kind: 'system', message: `playlist "${sel.playlist.Title}" has no id to browse`, code: 'no_id' }
    const tracks = await browseChildren(device, id)
    return {
      ok: true,
      data: {
        title: sel.playlist.Title,
        itemId: id,
        tracks: tracks.map((t) => ({ title: t.Title, artist: t.Artist, album: t.Album, uri: t.TrackUri, duration: t.Duration })),
      },
    }
  },
}

export const playlistsPlay: CommandSpec = {
  path: ['playlists', 'play'],
  effect: 'write',
  description: 'Replace the queue with a Sonos playlist (by title) and start playing',
  args: [
    { name: 'name', kind: 'positional', description: 'Playlist title (case-insensitive, exact or unique substring)', required: true },
    { name: 'room', kind: 'positional', description: 'Room to play in (defaults to the only group)', required: false },
  ],
  examples: ['home sonos playlists play "Dinner"', 'home sonos playlists play Dinner "living room"'],
  async run(ctx): Promise<RunResult> {
    const name = ctx.args.name ? String(ctx.args.name) : undefined
    if (!name) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }

    return withRoom(ctx, { pick: 'coordinator' }, async (d) => {
      const playlists = await browseChildren(d, 'SQ:')
      const sel = resolvePlaylist(playlists, name)
      if (sel.kind === 'not_found') return { ok: false, kind: 'user', message: `no playlist matching "${name}"`, code: 'not_found' }
      if (sel.kind === 'ambiguous') return { ok: false, kind: 'user', message: `playlist is ambiguous — candidates: ${sel.candidates.join(', ')}`, code: 'ambiguous' }

      const uri = sel.playlist.TrackUri
      if (!uri) return { ok: false, kind: 'system', message: `playlist "${sel.playlist.Title}" has no playable URI`, code: 'no_uri' }
      const guessed = MetaDataHelper.GuessMetaDataAndTrackUri(uri)
      const metadata = typeof guessed.metadata === 'string' ? guessed.metadata : MetaDataHelper.TrackToMetaData(guessed.metadata)

      await d.AVTransportService.RemoveAllTracksFromQueue({ InstanceID: 0 }).catch(() => {})
      await d.AVTransportService.SetAVTransportURI({ InstanceID: 0, CurrentURI: `x-rincon-queue:${d.Uuid}#0`, CurrentURIMetaData: '' })
      await enqueueAndPlay(d, guessed.trackUri, metadata)
      return { ok: true, data: { room: d.Name, played: sel.playlist.Title } }
    })
  },
}
