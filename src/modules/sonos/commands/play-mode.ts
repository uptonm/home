import { PlayMode } from '@svrooij/sonos/lib/models'
import type { CommandSpec, RunResult } from '../../../core/types'
import { withRoom } from '../client'
import { parseOnOff } from '../parse'

const roomArg = { name: 'room', kind: 'positional', description: 'Room name (defaults to the only group)', required: false } as const

export type RepeatMode = 'off' | 'all' | 'one'
export interface PlayModeFlags {
  shuffle: boolean
  repeat: RepeatMode
}

/** Decompose a Sonos PlayMode into independent shuffle + repeat flags. */
export function playModeToFlags(mode: PlayMode | string): PlayModeFlags {
  switch (mode) {
    case PlayMode.RepeatAll: return { shuffle: false, repeat: 'all' }
    case PlayMode.RepeatOne: return { shuffle: false, repeat: 'one' }
    case PlayMode.Shuffle: return { shuffle: true, repeat: 'all' }
    case PlayMode.ShuffleNoRepeat: return { shuffle: true, repeat: 'off' }
    case PlayMode.SuffleRepeatOne: return { shuffle: true, repeat: 'one' }
    default: return { shuffle: false, repeat: 'off' }
  }
}

/** Recombine shuffle + repeat flags into the single PlayMode Sonos expects. */
export function flagsToPlayMode(f: PlayModeFlags): PlayMode {
  if (f.shuffle) {
    if (f.repeat === 'all') return PlayMode.Shuffle
    if (f.repeat === 'one') return PlayMode.SuffleRepeatOne
    return PlayMode.ShuffleNoRepeat
  }
  if (f.repeat === 'all') return PlayMode.RepeatAll
  if (f.repeat === 'one') return PlayMode.RepeatOne
  return PlayMode.Normal
}

export const playModeGet: CommandSpec = {
  path: ['play-mode', 'get'],
  effect: 'read',
  description: 'Get the play mode for a room: repeat (off/all/one), shuffle, and crossfade',
  args: [roomArg],
  examples: [
    'home sonos play-mode get',
    'home sonos play-mode get kitchen --json',
  ],
  async run(ctx) {
    return withRoom(ctx, { pick: 'coordinator' }, async (d) => {
      const [settings, crossfade] = await Promise.all([
        d.AVTransportService.GetTransportSettings({ InstanceID: 0 }),
        d.AVTransportService.GetCrossfadeMode({ InstanceID: 0 }).catch(() => null),
      ])
      const flags = playModeToFlags(settings.PlayMode)
      return {
        ok: true,
        data: {
          room: d.Name,
          repeat: flags.repeat,
          shuffle: flags.shuffle,
          crossfade: crossfade?.CrossfadeMode ?? false,
          raw: settings.PlayMode,
        },
      }
    })
  },
}

export const playModeSet: CommandSpec = {
  path: ['play-mode', 'set'],
  effect: 'write',
  description: 'Set repeat, shuffle, and/or crossfade for a room. Only the flags you pass change; the rest are read and preserved.',
  args: [
    { name: 'room', kind: 'positional', description: 'Room name (defaults to the only group)', required: false },
    { name: 'repeat', kind: 'string', description: 'off | all | one' },
    { name: 'shuffle', kind: 'string', description: 'on | off' },
    { name: 'crossfade', kind: 'string', description: 'on | off' },
  ],
  examples: [
    'home sonos play-mode set kitchen --shuffle on --repeat all',
    'home sonos play-mode set "living room" --crossfade on',
    'home sonos play-mode set kitchen --repeat off',
  ],
  async run(ctx): Promise<RunResult> {
    const repeatArg = ctx.args.repeat !== undefined ? String(ctx.args.repeat).toLowerCase() : undefined
    if (repeatArg !== undefined && !['off', 'all', 'one'].includes(repeatArg)) {
      return { ok: false, kind: 'user', message: 'repeat must be off, all, or one', code: 'bad_arg' }
    }
    let shuffleArg: boolean | undefined
    if (ctx.args.shuffle !== undefined) {
      const p = parseOnOff(ctx.args.shuffle)
      if (p === null) return { ok: false, kind: 'user', message: 'shuffle must be on or off', code: 'bad_arg' }
      shuffleArg = p
    }
    let crossfadeArg: boolean | undefined
    if (ctx.args.crossfade !== undefined) {
      const p = parseOnOff(ctx.args.crossfade)
      if (p === null) return { ok: false, kind: 'user', message: 'crossfade must be on or off', code: 'bad_arg' }
      crossfadeArg = p
    }
    if (repeatArg === undefined && shuffleArg === undefined && crossfadeArg === undefined) {
      return { ok: false, kind: 'user', message: 'nothing to set — pass --repeat, --shuffle, and/or --crossfade', code: 'missing_arg' }
    }

    return withRoom(ctx, { pick: 'coordinator' }, async (d) => {
      // Read current flags so a partial update (e.g. only --shuffle) preserves
      // the others rather than resetting them to NORMAL.
      const settings = await d.AVTransportService.GetTransportSettings({ InstanceID: 0 })
      const current = playModeToFlags(settings.PlayMode)
      const next = {
        shuffle: shuffleArg ?? current.shuffle,
        repeat: (repeatArg as RepeatMode | undefined) ?? current.repeat,
      }
      const newMode = flagsToPlayMode(next)
      if (newMode !== settings.PlayMode) {
        await d.AVTransportService.SetPlayMode({ InstanceID: 0, NewPlayMode: newMode })
      }
      if (crossfadeArg !== undefined) {
        await d.AVTransportService.SetCrossfadeMode({ InstanceID: 0, CrossfadeMode: crossfadeArg })
      }
      return {
        ok: true,
        data: { room: d.Name, repeat: next.repeat, shuffle: next.shuffle, crossfade: crossfadeArg, raw: newMode },
      }
    })
  },
}
