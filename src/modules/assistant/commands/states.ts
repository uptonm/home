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
