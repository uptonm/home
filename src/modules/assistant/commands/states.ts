import type { CommandSpec } from '../../../core/types'
import { getState, listStates, readAssistantConfig, searchEntities, setState } from '../client'

export const statesList: CommandSpec = {
  path: ['states', 'list'],
  effect: 'read',
  description: 'List Home Assistant entity states, optionally filtered by domain',
  args: [{ name: 'domain', kind: 'string', description: 'Limit to domain (e.g. light, sensor)' }],
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

export const statesSearch: CommandSpec = {
  path: ['states', 'search'],
  effect: 'read',
  description: 'Search entities by substring match against entity_id and friendly_name',
  args: [
    { name: 'query', kind: 'positional', description: 'Search query (case-insensitive substring)', required: true },
    { name: 'domain', kind: 'string', description: 'Limit to domain (e.g. light, sensor)' },
  ],
  examples: [
    'home assistant states search temperature',
    'home assistant states search front --domain sensor --json',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const query = String(ctx.args.query ?? '')
    if (!query) return { ok: false, kind: 'user', message: 'query is required', code: 'missing_arg' }
    const domain = ctx.args.domain ? String(ctx.args.domain) : undefined
    const data = await searchEntities(cfg, query, domain)
    return { ok: true, data }
  },
}

export const stateGet: CommandSpec = {
  path: ['state', 'get'],
  effect: 'read',
  description: 'Get a single entity state by entity_id, optionally watch for changes',
  args: [
    { name: 'entity', kind: 'positional', description: 'entity_id (e.g. light.kitchen)', required: true },
    { name: 'watch', kind: 'boolean', description: 'Poll continuously and print state changes' },
    { name: 'interval', kind: 'number', description: 'Poll interval in seconds (default 2)' },
  ],
  examples: [
    'home assistant state get sensor.front_door_temperature --json',
    'home assistant state get light.living_room --watch',
    'home assistant state get binary_sensor.front_door --watch --interval 5',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const entity = String(ctx.args.entity ?? '')
    if (!entity) return { ok: false, kind: 'user', message: 'entity is required', code: 'missing_arg' }
    const watch = Boolean(ctx.args.watch)
    const intervalSec = Math.max(1, Number(ctx.args.interval) || 2)

    if (!watch) {
      const data = await getState(cfg, entity)
      if (!data) return { ok: false, kind: 'user', message: `no entity ${entity}`, code: 'not_found' }
      return { ok: true, data }
    }

    // Watch mode: poll continuously until interrupted.
    let prev: string | undefined
    let consecutiveFailures = 0
    const out = ctx.json ? process.stdout : process.stderr
    let active = true

    const poll = async () => {
      if (!active) return
      try {
        const data = await getState(cfg, entity)
        if (!data) {
          out.write(`[${new Date().toISOString()}] entity ${entity} not found\n`)
          consecutiveFailures++
          if (consecutiveFailures >= 3) {
            out.write(`[${new Date().toISOString()}] entity ${entity} not found 3 times — giving up\n`)
            cleanup()
            return
          }
        } else {
          consecutiveFailures = 0
          const current = data.state
          if (current !== prev) {
            const ts = new Date().toISOString()
            if (ctx.json) {
              out.write(JSON.stringify({ ts, entity_id: data.entity_id, state: current, attributes: data.attributes }) + '\n')
            } else {
              const fn = typeof data.attributes?.friendly_name === 'string' ? ` (${data.attributes.friendly_name})` : ''
              out.write(`${ts}  ${entity}${fn} → ${current}\n`)
            }
            prev = current
          }
        }
      } catch (err) {
        out.write(`[${new Date().toISOString()}] error: ${(err as Error).message}\n`)
      }
      if (active) setTimeout(poll, intervalSec * 1000)
    }

    const cleanup = () => {
      active = false
      process.removeListener('SIGINT', cleanup)
      process.removeListener('SIGTERM', cleanup)
      resolve({ ok: true } as const)
    }

    let resolve: (value: { ok: true }) => void
    const promise = new Promise<{ ok: true }>((res) => { resolve = res })
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)

    // Initial poll immediately.
    await poll()

    return promise
  },
}

export const stateSet: CommandSpec = {
  path: ['state', 'set'],
  effect: 'write',
  description: 'Override an entity state in the HA state machine (virtual write — requires --confirm)',
  args: [
    { name: 'entity', kind: 'positional', description: 'entity_id (e.g. sensor.virtual)', required: true },
    { name: 'state', kind: 'positional', description: 'New state value', required: true },
    { name: 'attributes', kind: 'string', description: 'JSON attributes object (optional)' },
    { name: 'confirm', kind: 'boolean', description: 'Required: acknowledge this is a direct state-machine override' },
  ],
  examples: [
    'home assistant state set sensor.virtual 42 --confirm',
    'home assistant state set sensor.virtual 42 --attributes \'{"unit_of_measurement":"°C"}\' --confirm',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const entity = String(ctx.args.entity ?? '')
    if (!entity) return { ok: false, kind: 'user', message: 'entity is required', code: 'missing_arg' }
    if (ctx.args.state === undefined || ctx.args.state === null || String(ctx.args.state) === '') {
      return { ok: false, kind: 'user', message: 'state is required', code: 'missing_arg' }
    }
    const state = String(ctx.args.state)

    if (!ctx.args.confirm) {
      return {
        ok: false,
        kind: 'user',
        message:
          'state set is a direct override of HA\'s state machine — it does not command the device and is overwritten on the next integration update. Re-run with --confirm to proceed.',
        code: 'confirmation_required',
      }
    }

    let attributes: Record<string, unknown> | undefined
    if (ctx.args.attributes) {
      try {
        attributes = JSON.parse(String(ctx.args.attributes)) as Record<string, unknown>
      } catch {
        return { ok: false, kind: 'user', message: '--attributes must be valid JSON', code: 'bad_json' }
      }
    }

    const data = await setState(cfg, entity, state, attributes)
    return { ok: true, data }
  },
}
