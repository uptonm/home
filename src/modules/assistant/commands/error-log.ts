import type { CommandSpec } from '../../../core/types'
import { errorLog, readAssistantConfig } from '../client'

export const errorLogCmd: CommandSpec = {
  path: ['error-log'],
  effect: 'read',
  description: 'Tail the Home Assistant error log (plain text)',
  args: [],
  examples: [
    'home assistant error-log',
    'home assistant error-log | tail -n 50',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const data = await errorLog(cfg)
    return { ok: true, data }
  },
}
