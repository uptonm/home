import type { CommandSpec } from '../../../core/types'
import { listServices, readAssistantConfig } from '../client'

export const servicesList: CommandSpec = {
  path: ['services', 'list'],
  effect: 'read',
  description: 'List available service domains and their services (with field schemas)',
  args: [{ name: 'domain', kind: 'string', description: 'Limit to a single domain (e.g. light, climate)' }],
  examples: [
    'home assistant services list --json',
    'home assistant services list --domain light --json | jq \'.[0].services | keys\'',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const domain = ctx.args.domain ? String(ctx.args.domain) : undefined
    const data = await listServices(cfg, domain)
    return { ok: true, data }
  },
}
