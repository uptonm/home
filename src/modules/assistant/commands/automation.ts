import type { CommandSpec } from '../../../core/types'
import { callService, readAssistantConfig } from '../client'

export const automationTrigger: CommandSpec = {
  path: ['automation', 'trigger'],
  description: 'Trigger an automation by entity_id',
  args: [{ name: 'entity', kind: 'positional', description: 'automation.<id>', required: true }],
  examples: ['home assistant automation trigger automation.morning_lights'],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const entity = String(ctx.args.entity ?? '')
    if (!entity.startsWith('automation.')) {
      return { ok: false, kind: 'user', message: 'entity must start with automation.', code: 'bad_entity' }
    }
    const result = await callService(cfg, 'automation', 'trigger', { entity_id: entity })
    return { ok: true, data: result }
  },
}
