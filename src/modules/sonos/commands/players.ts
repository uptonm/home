import type { CommandSpec } from '../../../core/types'
import { discover, readSonosConfig, summarizePlayer } from '../client'

export const playersList: CommandSpec = {
  path: ['players', 'list'],
  description: 'List all Sonos players discovered on the network',
  args: [],
  examples: [
    'home sonos players list',
    'home sonos players list --json | jq \'.[] | select(.isCoordinator)\'',
  ],
  async run(ctx) {
    const mgr = await discover(readSonosConfig(ctx.config))
    const data = mgr.Devices.map(summarizePlayer).sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}
