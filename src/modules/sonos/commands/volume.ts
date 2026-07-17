import type { CommandSpec } from '../../../core/types'
import { withRoom } from '../client'

const roomArg = { name: 'room', kind: 'positional', description: 'Room name (case-insensitive, partial match)', required: true } as const

export const volumeGet: CommandSpec = {
  path: ['volume', 'get'],
  effect: 'read',
  description: 'Get current volume (0-100) for a room',
  args: [roomArg],
  examples: ['home sonos volume get kitchen'],
  async run(ctx) {
    return withRoom(ctx, { pick: 'device', required: true }, async (d) => {
      const volume = await d.RenderingControlService.GetVolume({ InstanceID: 0, Channel: 'Master' })
      return { ok: true, data: { room: d.Name, volume: volume.CurrentVolume } }
    })
  },
}

export const volumeSet: CommandSpec = {
  path: ['volume', 'set'],
  effect: 'write',
  description: 'Set volume (0-100) for a room',
  args: [
    roomArg,
    { name: 'level', kind: 'positional', description: 'Volume level 0-100', required: true },
  ],
  examples: [
    'home sonos volume set kitchen 30',
    'home sonos volume set "living room" 0',
  ],
  async run(ctx) {
    const level = Number(ctx.args.level)
    if (!Number.isFinite(level) || level < 0 || level > 100) {
      return { ok: false, kind: 'user', message: 'level must be a number 0-100', code: 'bad_arg' }
    }
    return withRoom(ctx, { pick: 'device', required: true }, async (d) => {
      await d.SetVolume(Math.round(level))
      return { ok: true, data: { room: d.Name, volume: Math.round(level) } }
    })
  },
}

export const mute: CommandSpec = {
  path: ['mute'],
  effect: 'write',
  description: 'Mute or unmute a room',
  args: [
    roomArg,
    { name: 'state', kind: 'string', description: 'on | off | toggle (default toggle)' },
  ],
  examples: [
    'home sonos mute kitchen',
    'home sonos mute kitchen --state on',
    'home sonos mute "living room" --state off',
  ],
  async run(ctx) {
    const state = String(ctx.args.state ?? 'toggle').toLowerCase()
    if (!['on', 'off', 'toggle'].includes(state)) {
      return { ok: false, kind: 'user', message: 'state must be on, off, or toggle', code: 'bad_arg' }
    }
    return withRoom(ctx, { pick: 'device', required: true }, async (d) => {
      let desired: boolean
      if (state === 'toggle') {
        const cur = await d.RenderingControlService.GetMute({ InstanceID: 0, Channel: 'Master' })
        desired = !cur.CurrentMute
      } else {
        desired = state === 'on'
      }
      await d.RenderingControlService.SetMute({ InstanceID: 0, Channel: 'Master', DesiredMute: desired })
      return { ok: true, data: { room: d.Name, muted: desired } }
    })
  },
}
