import { MetaDataHelper } from '@svrooij/sonos'
import type SonosDevice from '@svrooij/sonos/lib/sonos-device'
import type { CommandSpec } from '../../../core/types'
import { discover, readSonosConfig, resolveRoom } from '../client'
import { discoverSpotifySn, rewriteSpotifySession, translateSpotifyInput } from '../spotify'

/**
 * Convert a user-supplied URI into the (transport URI, metadata) pair Sonos
 * needs. Raw HTTP(S) stream URLs are rewritten to `x-rincon-mp3radio://host/...`
 * — Sonos rejects the original `http://`/`https://` scheme on SetAVTransportURI
 * with UPnP 714 (Illegal MIME-Type), and empty metadata is fine for streams.
 * Spotify share URLs and spotify:* URIs pass through translation +
 * session-number rewriting before MetaDataHelper.
 */
async function resolveTrackUriAndMetadata(
  device: SonosDevice,
  rawUri: string,
  snOverride?: number,
): Promise<{ trackUri: string; metadata: string }> {
  if (/^https?:\/\//i.test(rawUri) && !/^https?:\/\/open\.spotify\.com\//i.test(rawUri)) {
    return { trackUri: rawUri.replace(/^https?:\/\//i, 'x-rincon-mp3radio://'), metadata: '' }
  }
  const uri = translateSpotifyInput(rawUri)
  const guessed = MetaDataHelper.GuessMetaDataAndTrackUri(uri)
  let trackUri = guessed.trackUri
  let metadata =
    typeof guessed.metadata === 'string'
      ? guessed.metadata
      : MetaDataHelper.TrackToMetaData(guessed.metadata)
  if (uri.startsWith('spotify:')) {
    const sn = snOverride ?? (await discoverSpotifySn(device).catch(() => null))
    if (sn !== null && sn !== undefined) {
      trackUri = rewriteSpotifySession(trackUri, sn)
      metadata = rewriteSpotifySession(metadata, sn)
    }
  }
  return { trackUri, metadata }
}

const roomArg = { name: 'room', kind: 'positional', description: 'Room name (case-insensitive, partial match)', required: true } as const

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
    'home sonos play-uri "Dining Room" "spotify:track:7qiZfU4dY1lWllzX7mPBI3"',
    'home sonos play-uri "Dining Room" "https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3"',
  ],
  async run(ctx) {
    const mgr = await discover(readSonosConfig(ctx.config))
    const ref = String(ctx.args.room ?? '')
    const uri = String(ctx.args.uri ?? '')
    if (!uri) return { ok: false, kind: 'user', message: 'uri is required', code: 'missing_arg' }
    const r = resolveRoom(mgr.Devices, ref)
    if (r.kind === 'not_found') return { ok: false, kind: 'user', message: `no room matching "${ref}"`, code: 'not_found' }
    if (r.kind === 'ambiguous') return { ok: false, kind: 'user', message: `room is ambiguous — candidates: ${r.candidates.join(', ')}`, code: 'ambiguous' }

    const d = r.device.Coordinator ?? r.device
    const snOverride = ctx.args.sn !== undefined ? Number(ctx.args.sn) : undefined
    const { trackUri, metadata } = await resolveTrackUriAndMetadata(d, uri, snOverride)
    await d.AVTransportService.SetAVTransportURI({
      InstanceID: 0,
      CurrentURI: trackUri,
      CurrentURIMetaData: metadata,
    })
    await d.Play()
    return { ok: true, data: { room: d.Name, uri: trackUri, action: 'play_uri' } }
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
