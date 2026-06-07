import type { Alarm } from '@svrooij/sonos/lib/models'
import type { CommandSpec, RunResult } from '../../../core/types'
import { discover, readSonosConfig } from '../client'

export function shapeAlarm(a: Alarm) {
  return {
    id: a.ID,
    startTime: a.StartLocalTime,
    duration: a.Duration,
    recurrence: a.Recurrence,
    enabled: a.Enabled,
    roomUuid: a.RoomUUID,
    volume: a.Volume,
    playMode: a.PlayMode,
    includeLinkedZones: a.IncludeLinkedZones,
  }
}

export const alarmsList: CommandSpec = {
  path: ['alarms', 'list'],
  description: 'List all Sonos alarms (household-wide)',
  args: [],
  examples: ['home sonos alarms list', 'home sonos alarms list --json'],
  async run(ctx) {
    const mgr = await discover(readSonosConfig(ctx.config))
    const device = mgr.Devices[0]
    if (!device) return { ok: false, kind: 'system', message: 'no Sonos devices discovered', code: 'no_devices' }
    const alarms = await device.AlarmClockService.ListAndParseAlarms()
    return { ok: true, data: alarms.map(shapeAlarm) }
  },
}

export const alarmsGet: CommandSpec = {
  path: ['alarms', 'get'],
  description: 'Get one alarm by ID',
  args: [{ name: 'id', kind: 'positional', description: 'Alarm ID (from `alarms list`)', required: true }],
  examples: ['home sonos alarms get 7 --json'],
  async run(ctx): Promise<RunResult> {
    const id = ctx.args.id !== undefined ? Number(ctx.args.id) : undefined
    if (id === undefined || !Number.isFinite(id)) return { ok: false, kind: 'user', message: 'id is required (a number)', code: 'missing_arg' }
    const mgr = await discover(readSonosConfig(ctx.config))
    const device = mgr.Devices[0]
    if (!device) return { ok: false, kind: 'system', message: 'no Sonos devices discovered', code: 'no_devices' }
    const alarms = await device.AlarmClockService.ListAndParseAlarms()
    const alarm = alarms.find((a) => a.ID === id)
    if (!alarm) return { ok: false, kind: 'user', message: `no alarm with id ${id}`, code: 'not_found' }
    return { ok: true, data: shapeAlarm(alarm) }
  },
}

/** Shared enable/disable: both toggle the same `Enabled` field via PatchAlarm. */
function alarmToggle(enabled: boolean): CommandSpec['run'] {
  return async (ctx): Promise<RunResult> => {
    const id = ctx.args.id !== undefined ? Number(ctx.args.id) : undefined
    if (id === undefined || !Number.isFinite(id)) return { ok: false, kind: 'user', message: 'id is required (a number)', code: 'missing_arg' }
    const mgr = await discover(readSonosConfig(ctx.config))
    const device = mgr.Devices[0]
    if (!device) return { ok: false, kind: 'system', message: 'no Sonos devices discovered', code: 'no_devices' }
    const alarms = await device.AlarmClockService.ListAndParseAlarms()
    if (!alarms.some((a) => a.ID === id)) return { ok: false, kind: 'user', message: `no alarm with id ${id}`, code: 'not_found' }
    await device.AlarmClockService.PatchAlarm({ ID: id, Enabled: enabled })
    return { ok: true, data: { id, enabled } }
  }
}

export const alarmsEnable: CommandSpec = {
  path: ['alarms', 'enable'],
  description: 'Enable an alarm by ID',
  args: [{ name: 'id', kind: 'positional', description: 'Alarm ID', required: true }],
  examples: ['home sonos alarms enable 7'],
  run: alarmToggle(true),
}

export const alarmsDisable: CommandSpec = {
  path: ['alarms', 'disable'],
  description: 'Disable an alarm by ID',
  args: [{ name: 'id', kind: 'positional', description: 'Alarm ID', required: true }],
  examples: ['home sonos alarms disable 7'],
  run: alarmToggle(false),
}
