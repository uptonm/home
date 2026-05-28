import type { CommandSpec } from '../../../core/types'
import { getState, listStates, readAssistantConfig } from '../client'

export const statesList: CommandSpec = {
  path: ['states', 'list'],
  description: 'List Home Assistant entity states, optionally filtered by domain',
  args: [{ name: 'domain', kind: 'string', description: 'Filter by domain prefix (e.g. light, sensor)' }],
  examples: [
    'home assistant states list --json',
    'home assistant states list --domain sensor --json | jq \'.[] | {entity_id, state}\'',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const domain = ctx.args.domain ? String(ctx.args.domain) : undefined
    const data = await listStates(cfg, domain)
    return { ok: true, data }
  },
}

export const stateGet: CommandSpec = {
  path: ['state', 'get'],
  description: 'Get a single entity state by entity_id',
  args: [{ name: 'entity', kind: 'positional', description: 'entity_id (e.g. light.kitchen)', required: true }],
  examples: ['home assistant state get sensor.front_door_temperature --json'],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const entity = String(ctx.args.entity ?? '')
    if (!entity) return { ok: false, kind: 'user', message: 'entity is required', code: 'missing_arg' }
    const data = await getState(cfg, entity)
    if (!data) return { ok: false, kind: 'user', message: `no entity ${entity}`, code: 'not_found' }
    return { ok: true, data }
  },
}
