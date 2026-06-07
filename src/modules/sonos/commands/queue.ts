import { MetaDataHelper } from '@svrooij/sonos'
import type SonosDevice from '@svrooij/sonos/lib/sonos-device'
import type { CommandSpec, RunResult } from '../../../core/types'
import { enqueueAndPlay, withRoom } from '../client'
import {
  buildSpotifyTransportUri,
  isPlayableSpotifyUri,
  selectSpotifyAccount,
  translateSpotifyInput,
  type SpotifyAccount,
} from '../spotify'

const roomArg = { name: 'room', kind: 'positional', description: 'Room name (case-insensitive, partial match)', required: true } as const

/** Same shape as `source.ts#pickSpotifyAccount` — duplicated rather than extracted because the helper is tiny and unit-test surface is per-call. */
async function pickSpotifyAccount(d: SonosDevice, snOverride: number | undefined): Promise<{ ok: true; account: SpotifyAccount } | { ok: false; result: RunResult }> {
  const sel = await selectSpotifyAccount(d, snOverride).catch(
    (err): { kind: 'discovery_failed'; message: string } => ({ kind: 'discovery_failed', message: (err as Error).message }),
  )
  switch (sel.kind) {
    case 'ok':
      return { ok: true, account: sel.account }
    case 'not_subscribed':
      return { ok: false, result: { ok: false, kind: 'system', message: 'Spotify is not subscribed on this Sonos household', code: 'spotify_not_subscribed' } }
    case 'sn_not_subscribed': {
      const available = sel.available.map((a) => a.sn).join(', ')
      return { ok: false, result: { ok: false, kind: 'user', message: `--sn ${sel.requested} does not match any subscribed Spotify account on this household (available: ${available})`, code: 'sn_not_subscribed' } }
    }
    case 'ambiguous': {
      const list = sel.candidates.map((a) => `sn=${a.sn}`).join(', ')
      return { ok: false, result: { ok: false, kind: 'user', message: `this Sonos household has ${sel.candidates.length} subscribed Spotify accounts (${list}); pass --sn <N> to pick one. List them with: home sonos spotify-accounts list`, code: 'spotify_account_ambiguous' } }
    }
    case 'discovery_failed':
      return { ok: false, result: { ok: false, kind: 'system', message: `Spotify account discovery failed: ${sel.message}`, code: 'spotify_discovery_failed' } }
  }
}

export const queueList: CommandSpec = {
  path: ['queue', 'list'],
  description: 'List the current queue for a room',
  args: [roomArg],
  examples: ['home sonos queue list "Dining Room" --json'],
  async run(ctx) {
    return withRoom(ctx, { pick: 'coordinator', required: true }, async (d) => {
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
    return withRoom(ctx, { pick: 'coordinator', required: true }, async (d) => {
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
    return withRoom(ctx, { pick: 'coordinator', required: true }, async (d) => {
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
        const picked = await pickSpotifyAccount(d, snOverride)
        if (!picked.ok) return picked.result
        const built = buildSpotifyTransportUri(uri, picked.account)
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

export const queueRemove: CommandSpec = {
  path: ['queue', 'remove'],
  description: 'Remove a track from the queue by its 1-based position (see `queue list`)',
  args: [
    roomArg,
    { name: 'pos', kind: 'positional', description: 'Queue position to remove (1-based)', required: true },
  ],
  examples: ['home sonos queue remove "Dining Room" 3'],
  async run(ctx): Promise<RunResult> {
    const pos = Number(ctx.args.pos)
    if (!Number.isInteger(pos) || pos < 1) {
      return { ok: false, kind: 'user', message: 'pos must be a whole number >= 1', code: 'bad_arg' }
    }
    return withRoom(ctx, { pick: 'coordinator', required: true }, async (d) => {
      await d.AVTransportService.RemoveTrackRangeFromQueue({ InstanceID: 0, UpdateID: 0, StartingIndex: pos, NumberOfTracks: 1 })
      return { ok: true, data: { room: d.Name, action: 'queue_remove', pos } }
    })
  },
}

export const queueSave: CommandSpec = {
  path: ['queue', 'save'],
  description: 'Save the current queue as a Sonos playlist',
  args: [
    roomArg,
    { name: 'name', kind: 'positional', description: 'Playlist title to save the queue as', required: true },
  ],
  examples: ['home sonos queue save "Dining Room" "Friday Night"'],
  async run(ctx): Promise<RunResult> {
    const name = ctx.args.name ? String(ctx.args.name) : undefined
    if (!name) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }
    return withRoom(ctx, { pick: 'coordinator', required: true }, async (d) => {
      const r = await d.AVTransportService.SaveQueue({ InstanceID: 0, Title: name, ObjectID: '' })
      return { ok: true, data: { room: d.Name, action: 'queue_save', title: name, objectId: r.AssignedObjectID } }
    })
  },
}
