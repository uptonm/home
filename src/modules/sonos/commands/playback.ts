import type { CommandSpec } from '../../../core/types'
import type SonosDevice from '@svrooij/sonos/lib/sonos-device'
import { discover, readSonosConfig, withRoom } from '../client'

const roomArg = { name: 'room', kind: 'positional', description: 'Room name (case-insensitive, partial match)', required: false } as const

export const play: CommandSpec = {
  path: ['play'],
  description: 'Resume playback in a room (or the only group if room omitted)',
  args: [roomArg],
  examples: ['home sonos play kitchen', 'home sonos play "living room"'],
  async run(ctx) {
    return withRoom(ctx, { pick: 'coordinator' }, async (d) => {
      await d.Play()
      return { ok: true, data: { room: d.Name, action: 'play' } }
    })
  },
}

export const pause: CommandSpec = {
  path: ['pause'],
  description: 'Pause playback in a room',
  args: [roomArg],
  examples: ['home sonos pause kitchen'],
  async run(ctx) {
    return withRoom(ctx, { pick: 'coordinator' }, async (d) => {
      await d.Pause()
      return { ok: true, data: { room: d.Name, action: 'pause' } }
    })
  },
}

export const next: CommandSpec = {
  path: ['next'],
  description: 'Skip to next track in a room',
  args: [roomArg],
  examples: ['home sonos next kitchen'],
  async run(ctx) {
    return withRoom(ctx, { pick: 'coordinator' }, async (d) => {
      await d.Next()
      return { ok: true, data: { room: d.Name, action: 'next' } }
    })
  },
}

export const prev: CommandSpec = {
  path: ['prev'],
  description: 'Skip to previous track in a room',
  args: [roomArg],
  examples: ['home sonos prev kitchen'],
  async run(ctx) {
    return withRoom(ctx, { pick: 'coordinator' }, async (d) => {
      await d.Previous()
      return { ok: true, data: { room: d.Name, action: 'prev' } }
    })
  },
}

async function readTrackForDevice(d: SonosDevice) {
  const transport = await d.AVTransportService.GetTransportInfo().catch(() => null)
  const position = await d.AVTransportService.GetPositionInfo().catch(() => null)
  const meta = position?.TrackMetaData
  const track = meta && typeof meta === 'object' ? meta : undefined
  return {
    room: d.Name,
    state: transport?.CurrentTransportState ?? 'UNKNOWN',
    title: track?.Title,
    artist: track?.Artist,
    album: track?.Album,
    uri: position?.TrackURI,
    position: position?.RelTime,
    duration: position?.TrackDuration,
  }
}

export const nowPlaying: CommandSpec = {
  path: ['now-playing'],
  description: 'Show current track for a room, or every group if room omitted',
  args: [{ name: 'room', kind: 'positional', description: 'Room name (case-insensitive, partial match)', required: false }],
  examples: [
    'home sonos now-playing',
    'home sonos now-playing kitchen --json',
  ],
  async run(ctx) {
    const ref = ctx.args.room ? String(ctx.args.room) : undefined
    if (ref) {
      return withRoom(ctx, { pick: 'coordinator' }, async (d) => ({
        ok: true,
        data: [await readTrackForDevice(d)],
      }))
    }
    const mgr = await discover(readSonosConfig(ctx.config))
    const targets = mgr.Devices.filter((d) => d.Coordinator?.Uuid === d.Uuid)
    const rows = await Promise.all(targets.map(readTrackForDevice))
    return { ok: true, data: rows }
  },
}
