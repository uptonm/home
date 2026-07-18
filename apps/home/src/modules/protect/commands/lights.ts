import type { CommandSpec, RunContext, RunResult } from '../../../core/types'
import { getBootstrap, patchDevice, readProtectConfig } from '../client'
import { pickOne } from './shared'

type LightAction = 'on' | 'off' | 'toggle'

async function control(ctx: RunContext, action: LightAction): Promise<RunResult> {
  const cfg = readProtectConfig(ctx.config)
  const ref = String(ctx.args.light ?? '')
  const brightnessRaw = ctx.args.brightness ? Number(ctx.args.brightness) : undefined

  if (!ref) return { ok: false, kind: 'user', message: 'light is required', code: 'missing_arg' }
  if (brightnessRaw !== undefined && (brightnessRaw < 0 || brightnessRaw > 100 || !Number.isFinite(brightnessRaw))) {
    return { ok: false, kind: 'user', message: 'brightness must be 0-100', code: 'invalid_arg' }
  }

  const bootstrap = await getBootstrap(cfg)
  const picked = pickOne(bootstrap.lights ?? [], ref, 'light')
  if (!picked.ok) return picked.error
  const light = picked.item

  const isLightOn = action === 'toggle' ? !light.isLightOn : action === 'on'

  const payload: Record<string, unknown> = {
    lightOnSettings: { isLedForceOn: isLightOn },
  }
  if (isLightOn && brightnessRaw !== undefined) {
    payload.lightDeviceSettings = { ledLevel: brightnessRaw }
  }

  const updated = await patchDevice(cfg, 'light', light.id ?? '', payload)
  if (!updated) {
    return { ok: false, kind: 'system', message: `failed to update light "${light.name}"`, code: 'update_failed' }
  }

  const result: Record<string, unknown> = { light: light.name, action, on: isLightOn }
  if (isLightOn && brightnessRaw !== undefined) result.brightness = brightnessRaw

  return { ok: true, data: result }
}

const controlArgs = (action: LightAction): CommandSpec['args'] => [
  { name: 'light', kind: 'positional', description: 'Light name or id', required: true },
  ...(action === 'off' ? [] : [{ name: 'brightness', kind: 'string' as const, description: 'Brightness 0-100' }]),
]

export const lightsOn: CommandSpec = {
  path: ['lights', 'on'],
  effect: 'write',
  description: 'Turn a Protect light on (optionally set brightness)',
  args: controlArgs('on'),
  examples: ['home protect lights on "Front Light"', 'home protect lights on "Front Light" --brightness 80'],
  run: (ctx) => control(ctx, 'on'),
}

export const lightsOff: CommandSpec = {
  path: ['lights', 'off'],
  effect: 'write',
  description: 'Turn a Protect light off',
  args: controlArgs('off'),
  examples: ['home protect lights off "Garage Light"'],
  run: (ctx) => control(ctx, 'off'),
}

export const lightsToggle: CommandSpec = {
  path: ['lights', 'toggle'],
  effect: 'write',
  description: 'Toggle a Protect light (optionally set brightness when turning on)',
  args: controlArgs('toggle'),
  examples: ['home protect lights toggle "Front Light"'],
  run: (ctx) => control(ctx, 'toggle'),
}

export const lightsList: CommandSpec = {
  path: ['lights', 'list'],
  effect: 'read',
  description: 'List Protect lights',
  args: [],
  examples: ['home protect lights list --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const bootstrap = await getBootstrap(cfg)
    return { ok: true, data: bootstrap.lights ?? [] }
  },
}

export const lightsGet: CommandSpec = {
  path: ['lights', 'get'],
  effect: 'read',
  description: 'Get a single light by id or name',
  args: [{ name: 'ref', kind: 'positional', description: 'Light id or name (substring ok)', required: true }],
  examples: ['home protect lights get <id> --json', 'home protect lights get "Front Light" --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.ref ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'ref is required', code: 'missing_arg' }
    const bootstrap = await getBootstrap(cfg)
    const picked = pickOne(bootstrap.lights ?? [], ref, 'light')
    if (!picked.ok) return picked.error
    return { ok: true, data: picked.item }
  },
}
