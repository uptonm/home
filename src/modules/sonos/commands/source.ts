import { MetaDataHelper } from '@svrooij/sonos'
import type { CommandSpec } from '../../../core/types'
import { discover, readSonosConfig, resolveRoom } from '../client'

const roomArg = { name: 'room', kind: 'positional', description: 'Room name (case-insensitive, partial match)', required: true } as const

export const playUri: CommandSpec = {
  path: ['play-uri'],
  description: 'Replace the current transport with a URI (HTTP stream, spotify:..., etc.) and start playing',
  args: [
    roomArg,
    { name: 'uri', kind: 'positional', description: 'Track or stream URI (http://, https://, spotify:..., etc.)', required: true },
  ],
  examples: [
    'home sonos play-uri "Dining Room" "https://ice1.somafm.com/groovesalad-128-mp3"',
    'home sonos play-uri "Dining Room" "spotify:track:7qiZfU4dY1lWllzX7mPBI3"',
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
