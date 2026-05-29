import type { CommandSpec, RunResult } from '../../../core/types'
import type SonosDevice from '@svrooij/sonos/lib/sonos-device'
import { discover, readSonosConfig, resolveRoom } from '../client'

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
  description: 'Add a URI to the queue (spotify:track:..., spotify:album:..., HTTP stream, etc.). Metadata is auto-guessed for known services.',
  args: [
    roomArg,
    { name: 'uri', kind: 'positional', description: 'Track URI (spotify:track:..., http://stream, etc.)', required: true },
    { name: 'next', kind: 'boolean', description: 'Enqueue as next track (default true)' },
    { name: 'play', kind: 'boolean', description: 'Start playing after adding (skips to the added track and plays)' },
  ],
  examples: [
    'home sonos queue add "Dining Room" "spotify:track:7qiZfU4dY1lWllzX7mPBI3" --play',
    'home sonos queue add "Dining Room" "spotify:album:5r36AJ6VOJtp00oxSkBZ5h"',
  ],
  async run(ctx) {
    return withCoordinator(ctx, async (d) => {
      const uri = String(ctx.args.uri ?? '')
      if (!uri) return { ok: false, kind: 'user', message: 'uri is required', code: 'missing_arg' }
      const enqueueAsNext = ctx.args.next === undefined ? true : Boolean(ctx.args.next)
      const result = await d.AddUriToQueue(uri, 0, enqueueAsNext)
      if (ctx.args.play) {
        const trackNr = Number(result.FirstTrackNumberEnqueued)
        if (Number.isFinite(trackNr) && trackNr > 0) {
          await d.AVTransportService.Seek({ InstanceID: 0, Unit: 'TRACK_NR', Target: String(trackNr) })
        }
        await d.Play()
      }
      return {
        ok: true,
        data: {
          room: d.Name,
          firstTrackEnqueued: result.FirstTrackNumberEnqueued,
          numTracksAdded: result.NumTracksAdded,
          newQueueLength: result.NewQueueLength,
          played: Boolean(ctx.args.play),
        },
      }
    })
  },
}
