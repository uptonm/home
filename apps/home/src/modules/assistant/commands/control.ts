import type { CommandSpec, RunResult } from '../../../core/types'
import { callService, readAssistantConfig, resolveEntity, type AssistantConfig, type ResolvedEntity } from '../client'

/**
 * Resolve a positional entity reference (friendly name or entity_id) within a
 * domain, converting not-found / ambiguous outcomes into user-facing RunResults.
 */
async function resolveOrError(
  cfg: AssistantConfig,
  ref: string,
  domain: string,
): Promise<{ ok: true; entity: ResolvedEntity } | { ok: false; result: RunResult }> {
  const res = await resolveEntity(cfg, ref, domain)
  if (res.kind === 'ok') return { ok: true, entity: res.entity }
  if (res.kind === 'not_found') {
    return {
      ok: false,
      result: { ok: false, kind: 'user', message: `no ${domain} entity matching "${ref}"`, code: 'not_found' },
    }
  }
  const list = res.matches
    .map((m) => `  ${m.entity_id}${m.friendly_name ? ` (${m.friendly_name})` : ''}`)
    .join('\n')
  return {
    ok: false,
    result: {
      ok: false,
      kind: 'user',
      message: `"${ref}" is ambiguous — ${res.matches.length} matches:\n${list}\nPass an exact entity_id.`,
      code: 'ambiguous',
    },
  }
}

// ---------------------------------------------------------------------------
// light
// ---------------------------------------------------------------------------

export function parseColor(value: string): { rgb_color: [number, number, number] } | { color_name: string } | null {
  const named = value.toLowerCase().trim()
  // hex #rrggbb
  const hex = /^#?([0-9a-f]{6})$/i.exec(named)
  if (hex) {
    const n = parseInt(hex[1]!, 16)
    return { rgb_color: [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
  }
  // r,g,b
  const rgb = /^(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})$/.exec(named)
  if (rgb) {
    const parts = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] as [number, number, number]
    if (parts.every((p) => p >= 0 && p <= 255)) return { rgb_color: parts }
    return null
  }
  // fall back to a CSS/HA color name
  if (/^[a-z]+$/.test(named)) return { color_name: named }
  return null
}

export const lightCmd: CommandSpec = {
  path: ['light'],
  effect: 'write',
  description: 'Control a light by name or entity_id (on/off/toggle, brightness, color)',
  args: [
    { name: 'action', kind: 'positional', description: 'on | off | toggle', required: true, enum: ['on', 'off', 'toggle'] },
    { name: 'light', kind: 'positional', description: 'Light name or entity_id (e.g. "TV" or light.tv)', required: true },
    { name: 'brightness', kind: 'number', description: 'Brightness 0-100 (%) (on/toggle only)' },
    { name: 'color', kind: 'string', description: 'Color: name (blue), hex (#3050ff), or r,g,b (on/toggle only)' },
  ],
  examples: [
    'home assistant light on TV',
    'home assistant light on "Living Room" --brightness 60 --color purple',
    'home assistant light toggle light.lamp',
    'home assistant light off TV',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const action = String(ctx.args.action ?? '')
    const ref = String(ctx.args.light ?? '')
    if (!['on', 'off', 'toggle'].includes(action)) {
      return { ok: false, kind: 'user', message: 'action must be on | off | toggle', code: 'bad_action' }
    }
    if (!ref) return { ok: false, kind: 'user', message: 'light is required', code: 'missing_arg' }

    const resolved = await resolveOrError(cfg, ref, 'light')
    if (!resolved.ok) return resolved.result
    const entity_id = resolved.entity.entity_id

    const service = action === 'on' ? 'turn_on' : action === 'off' ? 'turn_off' : 'toggle'
    const data: Record<string, unknown> = { entity_id }

    if (action !== 'off') {
      if (ctx.args.brightness !== undefined) {
        const pct = Number(ctx.args.brightness)
        if (Number.isNaN(pct) || pct < 0 || pct > 100) {
          return { ok: false, kind: 'user', message: 'brightness must be 0-100', code: 'bad_arg' }
        }
        data.brightness_pct = Math.round(pct)
      }
      if (ctx.args.color !== undefined) {
        const color = parseColor(String(ctx.args.color))
        if (!color) {
          return { ok: false, kind: 'user', message: `unrecognised color "${ctx.args.color}"`, code: 'bad_arg' }
        }
        Object.assign(data, color)
      }
    } else if (ctx.args.brightness !== undefined || ctx.args.color !== undefined) {
      return { ok: false, kind: 'user', message: 'brightness/color cannot be used with "off"', code: 'bad_arg' }
    }

    const changed = await callService(cfg, 'light', service, data)
    return { ok: true, data: { entity_id, friendly_name: resolved.entity.friendly_name, action, applied: data, changed } }
  },
}

// ---------------------------------------------------------------------------
// switch
// ---------------------------------------------------------------------------

export const switchCmd: CommandSpec = {
  path: ['switch'],
  effect: 'write',
  description: 'Control a switch by name or entity_id (on/off/toggle)',
  args: [
    { name: 'action', kind: 'positional', description: 'on | off | toggle', required: true, enum: ['on', 'off', 'toggle'] },
    { name: 'switch', kind: 'positional', description: 'Switch name or entity_id', required: true },
  ],
  examples: [
    'home assistant switch on "Office"',
    'home assistant switch toggle switch.borisnet',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const action = String(ctx.args.action ?? '')
    const ref = String(ctx.args.switch ?? '')
    if (!['on', 'off', 'toggle'].includes(action)) {
      return { ok: false, kind: 'user', message: 'action must be on | off | toggle', code: 'bad_action' }
    }
    if (!ref) return { ok: false, kind: 'user', message: 'switch is required', code: 'missing_arg' }

    const resolved = await resolveOrError(cfg, ref, 'switch')
    if (!resolved.ok) return resolved.result
    const entity_id = resolved.entity.entity_id

    const service = action === 'on' ? 'turn_on' : action === 'off' ? 'turn_off' : 'toggle'
    const changed = await callService(cfg, 'switch', service, { entity_id })
    return { ok: true, data: { entity_id, friendly_name: resolved.entity.friendly_name, action, changed } }
  },
}

// ---------------------------------------------------------------------------
// climate
// ---------------------------------------------------------------------------

export const climateCmd: CommandSpec = {
  path: ['climate'],
  effect: 'write',
  description: 'Set a thermostat target temperature and/or HVAC mode by name or entity_id',
  args: [
    { name: 'climate', kind: 'positional', description: 'Climate entity name or entity_id', required: true },
    { name: 'temperature', kind: 'number', description: 'Target temperature' },
    {
      name: 'mode',
      kind: 'string',
      description: 'HVAC mode',
      enum: ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'],
    },
  ],
  examples: [
    'home assistant climate "Thermostat" --temperature 21',
    'home assistant climate climate.thermostat --mode heat --temperature 22',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const ref = String(ctx.args.climate ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'climate entity is required', code: 'missing_arg' }
    const temperature = ctx.args.temperature !== undefined ? Number(ctx.args.temperature) : undefined
    const mode = ctx.args.mode !== undefined ? String(ctx.args.mode) : undefined
    if (temperature === undefined && mode === undefined) {
      return { ok: false, kind: 'user', message: 'provide --temperature and/or --mode', code: 'missing_arg' }
    }
    if (temperature !== undefined && Number.isNaN(temperature)) {
      return { ok: false, kind: 'user', message: 'temperature must be a number', code: 'bad_arg' }
    }

    const resolved = await resolveOrError(cfg, ref, 'climate')
    if (!resolved.ok) return resolved.result
    const entity_id = resolved.entity.entity_id

    const applied: Record<string, unknown> = {}
    if (mode !== undefined) {
      await callService(cfg, 'climate', 'set_hvac_mode', { entity_id, hvac_mode: mode })
      applied.hvac_mode = mode
    }
    if (temperature !== undefined) {
      await callService(cfg, 'climate', 'set_temperature', { entity_id, temperature })
      applied.temperature = temperature
    }
    return { ok: true, data: { entity_id, friendly_name: resolved.entity.friendly_name, applied } }
  },
}
