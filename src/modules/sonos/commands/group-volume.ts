import type { CommandSpec, RunResult } from '../../../core/types'
import { withRoom } from '../client'

const roomArg = { name: 'room', kind: 'positional', description: 'Any room in the target group', required: true } as const

export const groupVolumeGet: CommandSpec = {
  path: ['group-volume', 'get'],
  description: 'Get the group volume (the blended level across all speakers in the group)',
  args: [{ name: 'room', kind: 'positional', description: 'Any room in the target group (defaults to the only group)', required: false }],
  examples: [
    'home sonos group-volume get',
    'home sonos group-volume get kitchen --json',
  ],
  async run(ctx) {
    return withRoom(ctx, { pick: 'coordinator' }, async (d) => {
      const v = await d.GroupRenderingControlService.GetGroupVolume({ InstanceID: 0 })
      return { ok: true, data: { group: d.Name, volume: v.CurrentVolume } }
    })
  },
}

export const groupVolumeSet: CommandSpec = {
  path: ['group-volume', 'set'],
  description: 'Set the group volume (0-100); every speaker in the group moves proportionally',
  args: [
    roomArg,
    { name: 'level', kind: 'positional', description: 'Group volume 0-100', required: true },
  ],
  examples: [
    'home sonos group-volume set kitchen 25',
    'home sonos group-volume set "living room" 0',
  ],
  async run(ctx): Promise<RunResult> {
    const level = Number(ctx.args.level)
    if (!Number.isFinite(level) || level < 0 || level > 100) {
      return { ok: false, kind: 'user', message: 'level must be a number 0-100', code: 'bad_arg' }
    }
    return withRoom(ctx, { pick: 'coordinator', required: true }, async (d) => {
      await d.GroupRenderingControlService.SetGroupVolume({ InstanceID: 0, DesiredVolume: Math.round(level) })
      return { ok: true, data: { group: d.Name, volume: Math.round(level) } }
    })
  },
}

export const groupMute: CommandSpec = {
  path: ['group-mute'],
  description: 'Mute, unmute, or toggle an entire group',
  args: [
    roomArg,
    { name: 'state', kind: 'string', description: 'on | off | toggle (default toggle)' },
  ],
  examples: [
    'home sonos group-mute kitchen',
    'home sonos group-mute kitchen --state on',
    'home sonos group-mute "living room" --state off',
  ],
  async run(ctx): Promise<RunResult> {
    const state = String(ctx.args.state ?? 'toggle').toLowerCase()
    if (!['on', 'off', 'toggle'].includes(state)) {
      return { ok: false, kind: 'user', message: 'state must be on, off, or toggle', code: 'bad_arg' }
    }
    return withRoom(ctx, { pick: 'coordinator', required: true }, async (d) => {
      let desired: boolean
      if (state === 'toggle') {
        const cur = await d.GroupRenderingControlService.GetGroupMute({ InstanceID: 0 })
        desired = !cur.CurrentMute
      } else {
        desired = state === 'on'
      }
      await d.GroupRenderingControlService.SetGroupMute({ InstanceID: 0, DesiredMute: desired })
      return { ok: true, data: { group: d.Name, muted: desired } }
    })
  },
}
