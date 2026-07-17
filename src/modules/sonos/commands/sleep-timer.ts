import type { CommandSpec, RunResult } from '../../../core/types'
import { withRoom } from '../client'
import { parseSleepTimerArg } from '../parse'

const roomArg = { name: 'room', kind: 'positional', description: 'Room name (defaults to the only group)', required: false } as const

export const sleepTimerGet: CommandSpec = {
  path: ['sleep-timer', 'get'],
  effect: 'read',
  description: 'Get the remaining sleep-timer duration for a room (empty when none is set)',
  args: [roomArg],
  examples: [
    'home sonos sleep-timer get',
    'home sonos sleep-timer get kitchen --json',
  ],
  async run(ctx) {
    return withRoom(ctx, { pick: 'coordinator' }, async (d) => {
      const r = await d.AVTransportService.GetRemainingSleepTimerDuration({ InstanceID: 0 })
      const remaining = r.RemainingSleepTimerDuration || ''
      return { ok: true, data: { room: d.Name, active: remaining !== '', remaining } }
    })
  },
}

export const sleepTimerSet: CommandSpec = {
  path: ['sleep-timer', 'set'],
  effect: 'write',
  description: 'Set or cancel a room\'s sleep timer. Accepts "30m", "1h", "90", "1:30:00", or off/cancel to clear.',
  args: [
    { name: 'room', kind: 'positional', description: 'Room name', required: true },
    { name: 'duration', kind: 'positional', description: 'Duration (30m, 1h, 90, 1:30:00) or off/cancel to clear', required: true },
  ],
  examples: [
    'home sonos sleep-timer set kitchen 30m',
    'home sonos sleep-timer set "living room" 1:00:00',
    'home sonos sleep-timer set kitchen off',
  ],
  async run(ctx): Promise<RunResult> {
    const raw = ctx.args.duration !== undefined ? String(ctx.args.duration) : undefined
    if (raw === undefined) return { ok: false, kind: 'user', message: 'duration is required (e.g. 30m, 1h, or off)', code: 'missing_arg' }
    const duration = parseSleepTimerArg(raw)
    if (duration === null) {
      return { ok: false, kind: 'user', message: `invalid duration "${raw}" — use 30m / 1h / 90 / 1:30:00, or off to cancel`, code: 'bad_arg' }
    }

    return withRoom(ctx, { pick: 'coordinator', required: true }, async (d) => {
      await d.AVTransportService.ConfigureSleepTimer({ InstanceID: 0, NewSleepTimerDuration: duration })
      return { ok: true, data: { room: d.Name, action: duration === '' ? 'sleep_timer_cancelled' : 'sleep_timer_set', duration: duration || null } }
    })
  },
}
