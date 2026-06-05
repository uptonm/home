import type { CommandSpec } from '../../../core/types'
import { getBootstrap, patchDevice, readProtectConfig } from '../client'

export const lights: CommandSpec = {
  path: ['lights'],
  description: 'Control a Protect light (on/off/toggle, brightness)',
  args: [
    {
      name: 'action',
      kind: 'positional',
      description: 'on | off | toggle',
      required: true,
      enum: ['on', 'off', 'toggle'],
    },
    { name: 'light', kind: 'positional', description: 'Light name or id', required: true },
    { name: 'brightness', kind: 'string', description: 'Brightness 0-100 (on/toggle only)' },
  ],
  examples: [
    'home protect lights on "Front Light"',
    'home protect lights off "Garage Light"',
    'home protect lights on "Front Light" --brightness 80',
  ],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const action = String(ctx.args.action ?? '').toLowerCase()
    const ref = String(ctx.args.light ?? '')
    const brightnessRaw = ctx.args.brightness ? Number(ctx.args.brightness) : undefined

    if (!['on', 'off', 'toggle'].includes(action)) {
      return { ok: false, kind: 'user' as const, message: 'action must be on, off, or toggle', code: 'invalid_arg' }
    }
    if (!ref) return { ok: false, kind: 'user' as const, message: 'light is required', code: 'missing_arg' }
    if (brightnessRaw !== undefined && (brightnessRaw < 0 || brightnessRaw > 100 || !Number.isFinite(brightnessRaw))) {
      return { ok: false, kind: 'user' as const, message: 'brightness must be 0-100', code: 'invalid_arg' }
    }

    const bootstrap = await getBootstrap(cfg)
    const all = bootstrap.lights ?? []
    const light = all.find((l) => l.id === ref) ?? all.find((l) => l.name === ref)
    if (!light) {
      return { ok: false, kind: 'user' as const, message: `no light "${ref}" found`, code: 'not_found' }
    }

    let isLightOn: boolean
    if (action === 'toggle') {
      isLightOn = !light.isLightOn
    } else {
      isLightOn = action === 'on'
    }

    const payload: Record<string, unknown> = {
      lightOnSettings: { isLedForceOn: isLightOn },
    }
    if (isLightOn && brightnessRaw !== undefined) {
      payload.lightDeviceSettings = { ledLevel: brightnessRaw }
    }

    const updated = await patchDevice(cfg, 'light', light.id ?? '', payload)
    if (!updated) {
      return { ok: false, kind: 'system' as const, message: `failed to update light "${light.name}"`, code: 'update_failed' }
    }

    const result: Record<string, unknown> = { light: light.name, action, on: isLightOn }
    if (isLightOn && brightnessRaw !== undefined) result.brightness = brightnessRaw

    return { ok: true as const, data: result }
  },
}
