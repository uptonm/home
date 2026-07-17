import type { CommandSpec } from '../../../core/types'
import { listEvents, readAssistantConfig } from '../client'

export const eventsList: CommandSpec = {
  path: ['events', 'list'],
  effect: 'read',
  description: 'List event types on the bus and their listener counts',
  args: [],
  examples: [
    'home assistant events list --json',
    'home assistant events list --json | jq \'.[] | select(.listener_count > 0)\'',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const data = await listEvents(cfg)
    return { ok: true, data }
  },
}
