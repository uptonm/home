import type { CommandSpec } from '../../../core/types'
import { callService, readAssistantConfig } from '../client'

export const serviceCall: CommandSpec = {
  path: ['service', 'call'],
  description: 'Call a Home Assistant service (e.g. light.turn_on)',
  args: [
    {
      name: 'spec',
      kind: 'positional',
      description: 'Service spec as <domain>.<service>',
      required: true,
    },
    { name: 'data', kind: 'string', description: 'JSON payload (e.g. \'{"entity_id":"light.kitchen"}\')' },
  ],
  examples: [
    'home assistant service call light.turn_on --data \'{"entity_id":"light.kitchen"}\'',
    'home assistant service call notify.mobile_app --data \'{"message":"hi"}\'',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const spec = String(ctx.args.spec ?? '')
    const [domain, service] = spec.split('.')
    if (!domain || !service) {
      return { ok: false, kind: 'user', message: 'spec must be <domain>.<service>', code: 'bad_spec' }
    }
    let data: Record<string, unknown> = {}
    if (ctx.args.data) {
      try {
        data = JSON.parse(String(ctx.args.data)) as Record<string, unknown>
      } catch {
        return { ok: false, kind: 'user', message: '--data must be valid JSON', code: 'bad_json' }
      }
    }
    const result = await callService(cfg, domain, service, data)

    // Validate the HA response — surface any error states returned
    if (Array.isArray(result)) {
      const errors = result.filter(
        (s: { state?: string; attributes?: Record<string, unknown> }) =>
          s.state === 'error' || s.state === 'unavailable',
      )
      if (errors.length > 0) {
        const detail = errors
          .map((e) => `${e.entity_id ?? '?'}: ${e.state}`)
          .join(', ')
        return { ok: false, kind: 'system', message: `service call errors: ${detail}`, code: 'service_error' }
      }
    }

    return { ok: true, data: result }
  },
}
