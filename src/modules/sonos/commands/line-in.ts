import type { CommandSpec, RunResult } from '../../../core/types'
import { discover, readSonosConfig, resolveRoom } from '../client'

/**
 * Build the transport URI for a line-in / TV source. `--tv` selects the home
 * theater SPDIF stream (`x-sonos-htastream:`); otherwise the analog/optical
 * line-in (`x-rincon-stream:`). Both reference the *source* speaker's uuid, so
 * any room can play another room's input.
 */
export function lineInUri(sourceUuid: string, tv: boolean): string {
  return tv ? `x-sonos-htastream:${sourceUuid}:spdif` : `x-rincon-stream:${sourceUuid}`
}

export const lineIn: CommandSpec = {
  path: ['line-in'],
  description: 'Play a speaker\'s line-in (or, with --tv, its TV/HDMI input) on a room. Source defaults to the room itself.',
  args: [
    { name: 'room', kind: 'positional', description: 'Room to play the input on', required: true },
    { name: 'source', kind: 'positional', description: 'Room whose line-in/TV to stream (defaults to the room itself)', required: false },
    { name: 'tv', kind: 'boolean', description: 'Use the TV/HDMI (home theater) input instead of analog line-in' },
  ],
  examples: [
    'home sonos line-in "play:5"',
    'home sonos line-in kitchen "play:5"',
    'home sonos line-in "living room" --tv',
  ],
  async run(ctx): Promise<RunResult> {
    const roomRef = ctx.args.room ? String(ctx.args.room) : undefined
    if (!roomRef) return { ok: false, kind: 'user', message: 'room is required', code: 'missing_arg' }
    const sourceRef = ctx.args.source ? String(ctx.args.source) : undefined
    const tv = Boolean(ctx.args.tv)

    const mgr = await discover(readSonosConfig(ctx.config))
    const room = resolveRoom(mgr.Devices, roomRef)
    if (room.kind === 'not_found') return { ok: false, kind: 'user', message: `no room matching "${roomRef}"`, code: 'not_found' }
    if (room.kind === 'ambiguous') return { ok: false, kind: 'user', message: `room is ambiguous — candidates: ${room.candidates.join(', ')}`, code: 'ambiguous' }

    let source = room.device
    if (sourceRef) {
      const s = resolveRoom(mgr.Devices, sourceRef)
      if (s.kind === 'not_found') return { ok: false, kind: 'user', message: `no source matching "${sourceRef}"`, code: 'not_found' }
      if (s.kind === 'ambiguous') return { ok: false, kind: 'user', message: `source is ambiguous — candidates: ${s.candidates.join(', ')}`, code: 'ambiguous' }
      source = s.device
    }

    const uri = lineInUri(source.Uuid, tv)
    await room.device.AVTransportService.SetAVTransportURI({ InstanceID: 0, CurrentURI: uri, CurrentURIMetaData: '' })
    await room.device.Play().catch(() => {})
    return { ok: true, data: { room: room.device.Name, source: source.Name, input: tv ? 'tv' : 'line-in', uri } }
  },
}
