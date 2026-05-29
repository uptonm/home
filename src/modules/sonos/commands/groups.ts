import type { CommandSpec } from '../../../core/types'
import { discover, readSonosConfig, summarizeGroups } from '../client'

export const groupsList: CommandSpec = {
  path: ['groups', 'list'],
  description: 'List Sonos groups (coordinator + members)',
  args: [],
  examples: [
    'home sonos groups list',
    'home sonos groups list --json',
  ],
  async run(ctx) {
    const mgr = await discover(readSonosConfig(ctx.config))
    const data = summarizeGroups(mgr.Devices).sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}
