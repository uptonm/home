import type { CommandSpec } from '../../../core/types'
import { getBootstrap, protectRequest, readProtectConfig } from '../client'
import { pickOne } from './shared'

const DIRECTIONS = ['left', 'right', 'up', 'down', 'home'] as const
type PtzDirection = (typeof DIRECTIONS)[number]

export const camerasPtz: CommandSpec = {
  path: ['cameras', 'ptz'],
  effect: 'write',
  description: 'Pan-tilt-zoom a PTZ-capable camera',
  args: [
    { name: 'camera', kind: 'positional', description: 'Camera id or name', required: true },
    {
      name: 'direction',
      kind: 'positional',
      description: `Direction: ${DIRECTIONS.join(', ')}`,
      required: true,
      enum: [...DIRECTIONS],
    },
  ],
  examples: [
    'home protect cameras ptz Front-Door left',
    'home protect cameras ptz Garage right',
    'home protect cameras ptz "Back Patio" home',
  ],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.camera ?? '')
    if (!ref) return { ok: false, kind: 'user' as const, message: 'camera is required', code: 'missing_arg' }

    const dir = String(ctx.args.direction ?? '').toLowerCase() as PtzDirection
    if (!DIRECTIONS.includes(dir)) {
      return { ok: false, kind: 'user' as const, message: `direction must be one of: ${DIRECTIONS.join(', ')}`, code: 'invalid_arg' }
    }

    const bootstrap = await getBootstrap(cfg)
    const picked = pickOne(bootstrap.cameras ?? [], ref, 'camera')
    if (!picked.ok) return picked.error
    const camera = picked.item
    if (!camera.ptzControlEnabled) {
      return { ok: false, kind: 'user' as const, message: `camera "${camera.name}" does not support PTZ`, code: 'not_supported' }
    }

    const base = `/proxy/protect/api/cameras/${camera.id}`
    const body = dir === 'home'
      ? { action: 'home' }
      : { action: 'move', direction: dir, speed: 50 }

    // Try multiple PTZ endpoint formats (firmware-dependent)
    const suffixes = ['/ptz', '/move']
    let lastStatus: number | undefined

    for (const suffix of suffixes) {
      try {
        const response = await protectRequest(cfg, `${base}${suffix}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (response.ok) {
          return { ok: true as const, data: { camera: camera.name, direction: dir } }
        }
        lastStatus = response.status
      } catch { /* try next path */ }
    }

    // Fallback: try PATCH directly (some firmware only supports this)
    try {
      const patchResponse = await protectRequest(cfg, base, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ptz: body }),
      })
      if (patchResponse.ok) {
        return { ok: true as const, data: { camera: camera.name, direction: dir, method: 'patch' } }
      }
      lastStatus = patchResponse.status
    } catch { /* PATCH not supported */ }

    return {
      ok: false,
      kind: 'system' as const,
      message: `PTZ failed — camera "${camera.name}" doesn't support PTZ via REST API${lastStatus ? ` (last HTTP ${lastStatus})` : ''}`,
      code: 'ptz_failed',
    }
  },
}
