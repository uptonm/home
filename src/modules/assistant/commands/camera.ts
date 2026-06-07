import { writeFileSync } from 'node:fs'
import type { CommandSpec, RunResult } from '../../../core/types'
import { cameraSnapshot, readAssistantConfig, resolveEntity, type AssistantConfig, type ResolvedEntity } from '../client'

async function resolveOrError(
  cfg: AssistantConfig,
  ref: string,
): Promise<{ ok: true; entity: ResolvedEntity } | { ok: false; result: RunResult }> {
  const res = await resolveEntity(cfg, ref, 'camera')
  if (res.kind === 'ok') return { ok: true, entity: res.entity }
  if (res.kind === 'not_found') {
    return { ok: false, result: { ok: false, kind: 'user', message: `no camera entity matching "${ref}"`, code: 'not_found' } }
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

export const cameraSnapshotCmd: CommandSpec = {
  path: ['camera', 'snapshot'],
  description: 'Capture a JPEG snapshot from a camera by name or entity_id',
  args: [
    { name: 'camera', kind: 'positional', description: 'Camera name or entity_id (e.g. camera.front_door)', required: true },
    { name: 'out', kind: 'string', description: 'Output path; defaults to ./<entity_id>.jpg' },
    { name: 'stdout', kind: 'boolean', description: 'Write JPEG bytes to stdout instead of a file' },
  ],
  examples: [
    'home assistant camera snapshot camera.front_door',
    'home assistant camera snapshot "Front Door" --out /tmp/front.jpg',
    'home assistant camera snapshot camera.front_door --stdout | imgcat',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const ref = String(ctx.args.camera ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'camera is required', code: 'missing_arg' }

    const resolved = await resolveOrError(cfg, ref)
    if (!resolved.ok) return resolved.result
    const entity_id = resolved.entity.entity_id

    const buf = await cameraSnapshot(cfg, entity_id)

    if (Boolean(ctx.args.stdout)) {
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(buf, (err) => (err ? reject(err) : resolve()))
      })
      return { ok: true }
    }

    const out = ctx.args.out ? String(ctx.args.out) : `./${entity_id}.jpg`
    writeFileSync(out, buf)
    return { ok: true, data: { entity_id, path: out, bytes: buf.length } }
  },
}
