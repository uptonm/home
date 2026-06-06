import type { CommandSpec } from '../../../core/types'
import { readAssistantConfig, renderTemplate } from '../client'

export const templateRender: CommandSpec = {
  path: ['template'],
  description: 'Render a Jinja template server-side',
  args: [{ name: 'template', kind: 'positional', description: 'Jinja template string', required: true }],
  examples: [
    'home assistant template \'{{ states("sensor.living_room_temperature") }}\'',
    'home assistant template \'{{ now() }}\'',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const template = String(ctx.args.template ?? '')
    if (!template) return { ok: false, kind: 'user', message: 'template is required', code: 'missing_arg' }
    const data = await renderTemplate(cfg, template)
    return { ok: true, data }
  },
}
