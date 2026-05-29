import type { CommandSpec } from '../../../core/types'
import { discover, readSonosConfig, resolveRoom } from '../client'

const roomArg = { name: 'room', kind: 'positional', description: 'Room name (case-insensitive, partial match)', required: true } as const

export const volumeGet: CommandSpec = {
  path: ['volume', 'get'],
  description: 'Get current volume (0-100) for a room',
  args: [roomArg],
  examples: ['home sonos volume get kitchen'],
  async run(ctx) {
    const mgr = await discover(readSonosConfig(ctx.config))
    const ref = String(ctx.args.room ?? '')
    const r = resolveRoom(mgr.Devices, ref)
    if (r.kind === 'not_found') return { ok: false, kind: 'user', message: `no room matching "${ref}"`, code: 'not_found' }
    if (r.kind === 'ambiguous') return { ok: false, kind: 'user', message: `room is ambiguous — candidates: ${r.candidates.join(', ')}`, code: 'ambiguous' }
    const volume = await r.device.RenderingControlService.GetVolume({ InstanceID: 0, Channel: 'Master' })
    return { ok: true, data: { room: r.device.Name, volume: volume.CurrentVolume } }
  },
}

export const volumeSet: CommandSpec = {
  path: ['volume', 'set'],
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
    const mgr = await discover(readSonosConfig(ctx.config))
    const ref = String(ctx.args.room ?? '')
    const level = Number(ctx.args.level)
    if (!Number.isFinite(level) || level < 0 || level > 100) {
      return { ok: false, kind: 'user', message: 'level must be a number 0-100', code: 'bad_arg' }
    }
    const r = resolveRoom(mgr.Devices, ref)
    if (r.kind === 'not_found') return { ok: false, kind: 'user', message: `no room matching "${ref}"`, code: 'not_found' }
    if (r.kind === 'ambiguous') return { ok: false, kind: 'user', message: `room is ambiguous — candidates: ${r.candidates.join(', ')}`, code: 'ambiguous' }
    await r.device.SetVolume(Math.round(level))
    return { ok: true, data: { room: r.device.Name, volume: Math.round(level) } }
  },
}

export const mute: CommandSpec = {
  path: ['mute'],
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
    const mgr = await discover(readSonosConfig(ctx.config))
    const ref = String(ctx.args.room ?? '')
    const state = String(ctx.args.state ?? 'toggle').toLowerCase()
    if (!['on', 'off', 'toggle'].includes(state)) {
      return { ok: false, kind: 'user', message: 'state must be on, off, or toggle', code: 'bad_arg' }
    }
    const r = resolveRoom(mgr.Devices, ref)
    if (r.kind === 'not_found') return { ok: false, kind: 'user', message: `no room matching "${ref}"`, code: 'not_found' }
    if (r.kind === 'ambiguous') return { ok: false, kind: 'user', message: `room is ambiguous — candidates: ${r.candidates.join(', ')}`, code: 'ambiguous' }

    let desired: boolean
    if (state === 'toggle') {
      const cur = await r.device.RenderingControlService.GetMute({ InstanceID: 0, Channel: 'Master' })
      desired = !cur.CurrentMute
    } else {
      desired = state === 'on'
    }
    await r.device.RenderingControlService.SetMute({ InstanceID: 0, Channel: 'Master', DesiredMute: desired })
    return { ok: true, data: { room: r.device.Name, muted: desired } }
  },
}
