import type { CommandSpec } from '../../../core/types'
import { callService, readAssistantConfig, resolveEntity } from '../client'

async function resolveOrError(
  cfg: ReturnType<typeof readAssistantConfig>,
  ref: string,
  domain: string,
) {
  const res = await resolveEntity(cfg, ref, domain)
  if (res.kind === 'ok') return { ok: true as const, entity: res.entity }
  if (res.kind === 'not_found') {
    return {
      ok: false as const,
      result: { ok: false as const, kind: 'user' as const, message: `no ${domain} entity matching "${ref}"`, code: 'not_found' },
    }
  }
  const list = res.matches
    .map((m) => `  ${m.entity_id}${m.friendly_name ? ` (${m.friendly_name})` : ''}`)
    .join('\n')
  return {
    ok: false as const,
    result: {
      ok: false as const,
      kind: 'user' as const,
      message: `"${ref}" is ambiguous — ${res.matches.length} matches:\n${list}\nPass an exact entity_id.`,
      code: 'ambiguous',
    },
  }
}

export const sceneActivate: CommandSpec = {
  path: ['scene'],
  description: 'Activate a scene by name or entity_id',
  args: [{ name: 'scene', kind: 'positional', description: 'Scene name or entity_id (e.g. "Movie Time" or scene.movie_time)', required: true }],
  examples: [
    'home assistant scene "Movie Time"',
    'home assistant scene scene.evening',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const ref = String(ctx.args.scene ?? '')
    if (!ref) return { ok: false, kind: 'user' as const, message: 'scene is required', code: 'missing_arg' }

    const resolved = await resolveOrError(cfg, ref, 'scene')
    if (!resolved.ok) return resolved.result

    const result = await callService(cfg, 'scene', 'turn_on', {
      entity_id: resolved.entity.entity_id,
    })
    return {
      ok: true as const,
      data: { scene: resolved.entity.friendly_name ?? resolved.entity.entity_id, entity_id: resolved.entity.entity_id, result },
    }
  },
}

export const scriptRun: CommandSpec = {
  path: ['script'],
  description: 'Run a script by name or entity_id',
  args: [{ name: 'script', kind: 'positional', description: 'Script name or entity_id (e.g. "Goodnight" or script.goodnight)', required: true }],
  examples: [
    'home assistant script "Goodnight"',
    'home assistant script script.morning',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const ref = String(ctx.args.script ?? '')
    if (!ref) return { ok: false, kind: 'user' as const, message: 'script is required', code: 'missing_arg' }

    const resolved = await resolveOrError(cfg, ref, 'script')
    if (!resolved.ok) return resolved.result

    const result = await callService(cfg, 'script', 'turn_on', {
      entity_id: resolved.entity.entity_id,
    })
    return {
      ok: true as const,
      data: { script: resolved.entity.friendly_name ?? resolved.entity.entity_id, entity_id: resolved.entity.entity_id, result },
    }
  },
}