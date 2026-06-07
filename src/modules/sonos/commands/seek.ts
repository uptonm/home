import type { CommandSpec, RunResult } from '../../../core/types'
import { withRoom } from '../client'
import { parseTimeToSeconds, secondsToHms } from '../parse'

export const seek: CommandSpec = {
  path: ['seek'],
  description: 'Seek to an absolute position in the current track. Accepts "90", "1:30", or "1:02:03".',
  args: [
    { name: 'room', kind: 'positional', description: 'Room name (case-insensitive, partial match)', required: true },
    { name: 'position', kind: 'positional', description: 'Target position: seconds (90), m:ss (1:30), or h:mm:ss', required: true },
  ],
  examples: [
    'home sonos seek kitchen 1:30',
    'home sonos seek "living room" 90',
  ],
  async run(ctx): Promise<RunResult> {
    const raw = ctx.args.position !== undefined ? String(ctx.args.position) : undefined
    if (raw === undefined) return { ok: false, kind: 'user', message: 'position is required (e.g. 90 or 1:30)', code: 'missing_arg' }
    const secs = parseTimeToSeconds(raw)
    if (secs === null) {
      return { ok: false, kind: 'user', message: `invalid position "${raw}" — use seconds (90), m:ss (1:30), or h:mm:ss`, code: 'bad_arg' }
    }
    const target = secondsToHms(secs)

    return withRoom(ctx, { pick: 'coordinator', required: true }, async (d) => {
      await d.AVTransportService.Seek({ InstanceID: 0, Unit: 'REL_TIME', Target: target })
      return { ok: true, data: { room: d.Name, action: 'seek', position: target, seconds: secs } }
    })
  },
}
