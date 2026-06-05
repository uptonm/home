import { MetaDataHelper } from '@svrooij/sonos'
import type { Track } from '@svrooij/sonos/lib/models'
import type { CommandSpec, RunResult } from '../../../core/types'
import { enqueueAndPlay, withRoom } from '../client'

export type ResolveFavorite =
  | { kind: 'ok'; favorite: Track }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; candidates: string[] }

/**
 * Resolve a favorite by title: case-insensitive exact match, else a unique
 * substring. Mirrors `resolveRoom`'s shape (exact wins; >1 match is ambiguous)
 * so the CLI's room/favorite selection behaves identically. Pure → unit-tested.
 */
export function resolveFavorite(items: Track[], name: string): ResolveFavorite {
  const lower = name.toLowerCase()
  const exact = items.filter((t) => (t.Title ?? '').toLowerCase() === lower)
  if (exact.length === 1) return { kind: 'ok', favorite: exact[0]! }
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact.map((t) => t.Title ?? '').sort() }
  const sub = items.filter((t) => (t.Title ?? '').toLowerCase().includes(lower))
  if (sub.length === 1) return { kind: 'ok', favorite: sub[0]! }
  if (sub.length > 1) return { kind: 'ambiguous', candidates: sub.map((t) => t.Title ?? '').sort() }
  return { kind: 'not_found' }
}

/**
 * A container favorite (album, playlist, saved queue, music-service station
 * container) must be loaded through the queue; a single item / radio broadcast
 * is set straight onto the transport. Decided from the UPnP class first, with a
 * URI-scheme fallback for items the parser left unclassed.
 */
export function favoriteIsContainer(track: Pick<Track, 'UpnpClass' | 'TrackUri'>): boolean {
  if ((track.UpnpClass ?? '').includes('object.container')) return true
  const uri = track.TrackUri ?? ''
  return (
    uri.startsWith('x-rincon-cpcontainer:') ||
    uri.startsWith('x-rincon-playlist:') ||
    uri.includes('savedqueues.rsq#')
  )
}

export const favoritesPlay: CommandSpec = {
  path: ['favorites', 'play'],
  description: 'Play a Sonos favorite (My Sonos) by title. Containers (albums/playlists/stations) replace the queue; radio/streams are set directly. List titles with `home sonos favorites list`.',
  args: [
    { name: 'name', kind: 'positional', description: 'Favorite title (case-insensitive, exact or unique substring)', required: true },
    { name: 'room', kind: 'positional', description: 'Room to play in (defaults to the only group)', required: false },
  ],
  examples: [
    'home sonos favorites play "Morning Jazz"',
    'home sonos favorites play "KEXP" "living room"',
  ],
  async run(ctx): Promise<RunResult> {
    const name = ctx.args.name ? String(ctx.args.name) : undefined
    if (!name) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }

    return withRoom(ctx, { pick: 'coordinator' }, async (d) => {
      const favs = await d.GetFavorites()
      const items = Array.isArray(favs.Result) ? favs.Result : []
      const sel = resolveFavorite(items, name)
      if (sel.kind === 'not_found') {
        return { ok: false, kind: 'user', message: `no favorite matching "${name}"`, code: 'not_found' }
      }
      if (sel.kind === 'ambiguous') {
        return { ok: false, kind: 'user', message: `favorite is ambiguous — candidates: ${sel.candidates.join(', ')}`, code: 'ambiguous' }
      }

      const fav = sel.favorite
      const uri = fav.TrackUri
      if (!uri) {
        return { ok: false, kind: 'system', message: `favorite "${fav.Title}" has no playable URI`, code: 'no_uri' }
      }
      const metadata = MetaDataHelper.TrackToMetaData(fav, true)
      const isContainer = favoriteIsContainer(fav)

      if (isContainer) {
        // Containers play from the queue: clear it, point the transport at the
        // queue, then enqueue+play (the same recipe play-uri uses for Spotify).
        await d.AVTransportService.RemoveAllTracksFromQueue({ InstanceID: 0 }).catch(() => {})
        await d.AVTransportService.SetAVTransportURI({ InstanceID: 0, CurrentURI: `x-rincon-queue:${d.Uuid}#0`, CurrentURIMetaData: '' })
        await enqueueAndPlay(d, uri, metadata)
      } else {
        await d.AVTransportService.SetAVTransportURI({ InstanceID: 0, CurrentURI: uri, CurrentURIMetaData: metadata })
        await d.Play()
      }

      return { ok: true, data: { room: d.Name, played: fav.Title, uri, kind: isContainer ? 'container' : 'item' } }
    })
  },
}
