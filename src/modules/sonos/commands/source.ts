import { MetaDataHelper } from '@svrooij/sonos'
import type SonosDevice from '@svrooij/sonos/lib/sonos-device'
import type { CommandSpec, RunResult } from '../../../core/types'
import { discover, enqueueAndPlay, readSonosConfig, resolveRoom, toSonosTrackUri } from '../client'
import {
  buildSpotifyTransportUri,
  discoverSpotifyAccount,
  isPlayableSpotifyUri,
  translateSpotifyInput,
  type SpotifyAccount,
} from '../spotify'

const roomArg = { name: 'room', kind: 'positional', description: 'Room name (case-insensitive, partial match)', required: true } as const

async function resolveSpotifyAccount(d: SonosDevice, snOverride: number | undefined): Promise<SpotifyAccount | null> {
  const discovered = await discoverSpotifyAccount(d).catch(() => null)
  if (!discovered) return null
  return snOverride !== undefined ? { sid: discovered.sid, sn: snOverride } : discovered
}

/**
 * `SetAVTransportURI` on `x-sonos-spotify:track:` fails on this household —
 * Sonos only accepts single Spotify tracks via the queue. Clear, point the
 * transport at the queue, then hand off to the shared `enqueueAndPlay`.
 */
async function replaceAndPlaySpotifyViaQueue(d: SonosDevice, transportUri: string): Promise<void> {
  await d.AVTransportService.RemoveAllTracksFromQueue({ InstanceID: 0 })
  const queueUri = `x-rincon-queue:${d.Uuid}#0`
  await d.AVTransportService.SetAVTransportURI({ InstanceID: 0, CurrentURI: queueUri, CurrentURIMetaData: '' })
  await enqueueAndPlay(d, transportUri, '')
}

export const playUri: CommandSpec = {
  path: ['play-uri'],
  description: 'Replace the current transport with a URI (HTTP stream, spotify:..., open.spotify.com share URL, etc.) and start playing',
  args: [
    roomArg,
    { name: 'uri', kind: 'positional', description: 'Track or stream URI (http://, https://, spotify:..., https://open.spotify.com/...)', required: true },
    { name: 'sn', kind: 'number', description: 'Override Spotify subscription number (auto-discovered by default)' },
  ],
  examples: [
    'home sonos play-uri "Dining Room" "https://ice1.somafm.com/groovesalad-128-mp3"',
    'home sonos play-uri "Dining Room" "spotify:track:7oK9VyNzrYvRFo7nQEYkWN"',
    'home sonos play-uri "Dining Room" "https://open.spotify.com/album/5r36AJ6VOJtp00oxSkBZ5h"',
  ],
  async run(ctx): Promise<RunResult> {
    const mgr = await discover(readSonosConfig(ctx.config))
    const ref = String(ctx.args.room ?? '')
    const rawUri = String(ctx.args.uri ?? '')
    if (!rawUri) return { ok: false, kind: 'user', message: 'uri is required', code: 'missing_arg' }
    const r = resolveRoom(mgr.Devices, ref)
    if (r.kind === 'not_found') return { ok: false, kind: 'user', message: `no room matching "${ref}"`, code: 'not_found' }
    if (r.kind === 'ambiguous') return { ok: false, kind: 'user', message: `room is ambiguous — candidates: ${r.candidates.join(', ')}`, code: 'ambiguous' }

    const d = r.device.Coordinator ?? r.device

    // Raw HTTP(S) stream (anything that's not open.spotify.com).
    if (/^https?:\/\//i.test(rawUri) && !/^https?:\/\/open\.spotify\.com\//i.test(rawUri)) {
      const trackUri = toSonosTrackUri(rawUri)
      await d.AVTransportService.SetAVTransportURI({ InstanceID: 0, CurrentURI: trackUri, CurrentURIMetaData: '' })
      await d.Play()
      return { ok: true, data: { room: d.Name, uri: trackUri, action: 'play_uri' } }
    }

    // Spotify (canonical URI or share URL).
    const uri = translateSpotifyInput(rawUri)
    if (uri.startsWith('spotify:')) {
      if (!isPlayableSpotifyUri(uri)) {
        return {
          ok: false,
          kind: 'user',
          message: `${uri} is a container URI; Sonos cannot play it directly on this household. Use a spotify:track: URI.`,
          code: 'container_not_playable',
        }
      }
      const snOverride = ctx.args.sn !== undefined ? Number(ctx.args.sn) : undefined
      const account = await resolveSpotifyAccount(d, snOverride)
      if (!account) return { ok: false, kind: 'system', message: 'Spotify is not subscribed on this Sonos household', code: 'spotify_not_subscribed' }
      const built = buildSpotifyTransportUri(uri, account)
      if (!built) return { ok: false, kind: 'user', message: `unsupported Spotify URI shape: ${uri}`, code: 'unsupported_spotify_uri' }
      await replaceAndPlaySpotifyViaQueue(d, built)
      return { ok: true, data: { room: d.Name, uri: built, action: 'play_uri' } }
    }

    // Fall-through: trust MetaDataHelper for anything else it knows about.
    const guessed = MetaDataHelper.GuessMetaDataAndTrackUri(uri)
    const metadata =
      typeof guessed.metadata === 'string'
        ? guessed.metadata
        : MetaDataHelper.TrackToMetaData(guessed.metadata)
    await d.AVTransportService.SetAVTransportURI({
      InstanceID: 0,
      CurrentURI: guessed.trackUri,
      CurrentURIMetaData: metadata,
    })
    await d.Play()
    return { ok: true, data: { room: d.Name, uri: guessed.trackUri, action: 'play_uri' } }
  },
}

export const favoritesList: CommandSpec = {
  path: ['favorites', 'list'],
  description: 'List Sonos favorites (My Sonos)',
  args: [],
  examples: ['home sonos favorites list', 'home sonos favorites list --json'],
  async run(ctx) {
    const mgr = await discover(readSonosConfig(ctx.config))
    const device = mgr.Devices[0]
    if (!device) return { ok: false, kind: 'system', message: 'no devices discovered', code: 'no_devices' }
    const favs = await device.GetFavorites()
    const items = Array.isArray(favs.Result)
      ? favs.Result.map((t) => ({ title: t.Title, itemId: t.ItemId, upnpClass: t.UpnpClass }))
      : []
    return { ok: true, data: items }
  },
}
