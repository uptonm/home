import type { CommandSpec } from '../../../core/types'
import { readProtectConfig, withApi } from '../client'

export const camerasLed: CommandSpec = {
  path: ['cameras', 'led'],
  description: 'Control a camera IR LED and flood light',
  args: [
    { name: 'camera', kind: 'positional', description: 'Camera id or name', required: true },
    {
      name: 'feature',
      kind: 'positional',
      description: 'ir | spotlight',
      required: true,
      enum: ['ir', 'spotlight'],
    },
    {
      name: 'state',
      kind: 'positional',
      description: 'on | off | auto (ir only)',
      required: true,
      enum: ['on', 'off', 'auto'],
    },
  ],
  examples: [
    'home protect cameras led Front-Door ir on',
    'home protect cameras led Front-Door ir auto',
    'home protect cameras led "Back Patio" spotlight on',
    'home protect cameras led Garage spotlight off',
  ],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.camera ?? '')
    const feature = String(ctx.args.feature ?? '')
    const state = String(ctx.args.state ?? '')
    if (!ref) return { ok: false, kind: 'user' as const, message: 'camera is required', code: 'missing_arg' }

    if (feature === 'ir' && !['on', 'off', 'auto'].includes(state)) {
      return { ok: false, kind: 'user' as const, message: 'IR state must be on, off, or auto', code: 'invalid_arg' }
    }
    if (feature === 'spotlight' && !['on', 'off'].includes(state)) {
      return { ok: false, kind: 'user' as const, message: 'spotlight state must be on or off', code: 'invalid_arg' }
    }

    return withApi(cfg, async (api) => {
      const cameras = api.bootstrap?.cameras ?? []
      const camera =
        cameras.find((c) => c.id === ref) ?? cameras.find((c) => c.name === ref)
      if (!camera) {
        return { ok: false, kind: 'user' as const, message: `no camera "${ref}" found`, code: 'not_found' }
      }

      let payload: Record<string, unknown>
      if (feature === 'spotlight') {
        // Flood light / spotlight on camera
        payload = {
          ledSettings: {
            isEnabled: state === 'on',
            // Preserve existing floodLed/welcomeLed values
            ...'floodLed' in camera.ledSettings ? { floodLed: state === 'on' } : {},
          } as Record<string, unknown>,
        }
      } else {
        // IR control
        payload = {
          ispSettings: {
            ...camera.ispSettings,
            // 'auto' maps to irLedMode: 'auto', 'on' → 'manual_on', 'off' → 'manual_off'
            irLedMode: state === 'auto' ? 'auto' : state === 'on' ? 'manual_on' : 'manual_off',
          } as Record<string, unknown>,
        }
      }

      const updated = await api.updateDevice(
        camera,
        payload as Record<string, unknown> as Parameters<typeof api.updateDevice>[1],
      )
      if (!updated) {
        return {
          ok: false,
          kind: 'system' as const,
          message: `failed to update ${feature} on camera "${camera.name}"`,
          code: 'update_failed',
        }
      }

      return {
        ok: true as const,
        data: { camera: camera.name, feature, state },
      }
    })
  },
}