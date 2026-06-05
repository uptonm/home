import type { CommandSpec } from '../../../core/types'
import { getConfig, readAssistantConfig } from '../client'

export const configGet: CommandSpec = {
  path: ['config', 'get'],
  description: 'Get the Home Assistant config (version, components, unit system, location)',
  args: [],
  examples: [
    'home assistant config get --json',
    'home assistant config get --json | jq \'{version, location_name, time_zone}\'',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const data = await getConfig(cfg)
    return { ok: true, data }
  },
}
