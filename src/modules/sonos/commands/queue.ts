import { MetaDataHelper } from '@svrooij/sonos'
import type SonosDevice from '@svrooij/sonos/lib/sonos-device'
import type { CommandSpec, RunResult } from '../../../core/types'
import { discover, enqueueAndPlay, readSonosConfig, resolveRoom } from '../client'
import {
  buildSpotifyTransportUri,
  discoverSpotifyAccount,
  isPlayableSpotifyUri,
  translateSpotifyInput,
  type SpotifyAccount,
} from '../spotify'

async function withCoordinator(
  ctx: Parameters<CommandSpec['run']>[0],
  fn: (d: SonosDevice) => Promise<RunResult>,
): Promise<RunResult> {
  const mgr = await discover(readSonosConfig(ctx.config))
  const ref = String(ctx.args.room ?? '')
  const r = resolveRoom(mgr.Devices, ref)
  if (r.kind === 'not_found') return { ok: false, kind: 'user', message: `no room matching "${ref}"`, code: 'not_found' }
  if (r.kind === 'ambiguous') return { ok: false, kind: 'user', message: `room is ambiguous — candidates: ${r.candidates.join(', ')}`, code: 'ambiguous' }
  return fn(r.device.Coordinator ?? r.device)
}

const roomArg = { name: 'room', kind: 'positional', description: 'Room name (case-insensitive, partial match)', required: true } as const

async function resolveSpotifyAccount(d: SonosDevice, snOverride: number | undefined): Promise<SpotifyAccount | null> {
  const discovered = await discoverSpotifyAccount(d).catch(() => null)
  if (!discovered) return null
  return snOverride !== undefined ? { sid: discovered.sid, sn: snOverride } : discovered
}

export const queueList: CommandSpec = {
  path: ['queue', 'list'],
  description: 'List the current queue for a room',
  args: [roomArg],
  examples: ['home sonos queue list "Dining Room" --json'],
  async run(ctx) {
    return withCoordinator(ctx, async (d) => {
      const q = await d.GetQueue()
      const tracks = Array.isArray(q.Result) ? q.Result : []
      const rows = tracks.map((t, i) => ({
        pos: i + 1,
        title: t.Title,
        artist: t.Artist,
        album: t.Album,
        uri: t.TrackUri,
        duration: t.Duration,
      }))
      return { ok: true, data: { total: q.TotalMatches, returned: q.NumberReturned, tracks: rows } }
    })
  },
}

export const queueClear: CommandSpec = {
  path: ['queue', 'clear'],
  description: 'Clear the queue for a room',
  args: [roomArg],
  examples: ['home sonos queue clear "Dining Room"'],
  async run(ctx) {
    return withCoordinator(ctx, async (d) => {
      await d.AVTransportService.RemoveAllTracksFromQueue({ InstanceID: 0 })
      return { ok: true, data: { room: d.Name, action: 'queue_cleared' } }
    })
  },
}

export const queueAdd: CommandSpec = {
  path: ['queue', 'add'],
  description: 'Add a URI to the queue (spotify:track:..., open.spotify.com share URL, HTTP stream, etc.). Metadata is auto-guessed for known services; Spotify sn= is auto-discovered.',
  args: [
    roomArg,
    { name: 'uri', kind: 'positional', description: 'Track URI (spotify:track:..., open.spotify.com/...,  http://stream, etc.)', required: true },
    { name: 'next', kind: 'boolean', description: 'Enqueue as next track (default true)' },
    { name: 'play', kind: 'boolean', description: 'Start playing after adding (skips to the added track and plays)' },
    { name: 'sn', kind: 'number', description: 'Override Spotify subscription number (auto-discovered by default)' },
  ],
  examples: [
    'home sonos queue add "Dining Room" "spotify:track:7qiZfU4dY1lWllzX7mPBI3" --play',
    'home sonos queue add "Dining Room" "https://open.spotify.com/album/5r36AJ6VOJtp00oxSkBZ5h" --play',
  ],
  async run(ctx) {
    return withCoordinator(ctx, async (d) => {
      const raw = String(ctx.args.uri ?? '')
      if (!raw) return { ok: false, kind: 'user', message: 'uri is required', code: 'missing_arg' }
      const enqueueAsNext = ctx.args.next === undefined ? true : Boolean(ctx.args.next)
      const uri = translateSpotifyInput(raw)

      let enqueuedUri: string
      let enqueuedMetadata: string
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
        enqueuedUri = built
        enqueuedMetadata = ''
      } else {
        const guessed = MetaDataHelper.GuessMetaDataAndTrackUri(uri)
        enqueuedUri = guessed.trackUri
        enqueuedMetadata =
          typeof guessed.metadata === 'string'
            ? guessed.metadata
            : MetaDataHelper.TrackToMetaData(guessed.metadata)
      }

      let firstTrackEnqueued: number
      let numTracksAdded: number
      let newQueueLength: number
      if (ctx.args.play) {
        const r = await enqueueAndPlay(d, enqueuedUri, enqueuedMetadata, { enqueueAsNext })
        firstTrackEnqueued = r.firstTrackEnqueued
        numTracksAdded = r.numTracksAdded
        newQueueLength = r.newQueueLength
      } else {
        const r = await d.AVTransportService.AddURIToQueue({
          InstanceID: 0,
          EnqueuedURI: enqueuedUri,
          EnqueuedURIMetaData: enqueuedMetadata,
          DesiredFirstTrackNumberEnqueued: 0,
          EnqueueAsNext: enqueueAsNext,
        })
        firstTrackEnqueued = r.FirstTrackNumberEnqueued
        numTracksAdded = r.NumTracksAdded
        newQueueLength = r.NewQueueLength
      }
      return {
        ok: true,
        data: {
          room: d.Name,
          enqueuedUri,
          firstTrackEnqueued,
          numTracksAdded,
          newQueueLength,
          played: Boolean(ctx.args.play),
        },
      }
    })
  },
}
