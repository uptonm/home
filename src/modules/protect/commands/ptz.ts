import type { CommandSpec } from '../../../core/types'
import { readProtectConfig, withApi } from '../client'

const DIRECTIONS = ['left', 'right', 'up', 'down', 'home'] as const
type PtzDirection = (typeof DIRECTIONS)[number]

export const camerasPtz: CommandSpec = {
  path: ['cameras', 'ptz'],
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

    return withApi(cfg, async (api) => {
      const cameras = api.bootstrap?.cameras ?? []
      const camera = cameras.find((c) => c.id === ref) ?? cameras.find((c) => c.name === ref)
      if (!camera) {
        return { ok: false, kind: 'user' as const, message: `no camera "${ref}" found`, code: 'not_found' }
      }
      if (!camera.ptzControlEnabled) {
        return { ok: false, kind: 'user' as const, message: `camera "${camera.name}" does not support PTZ`, code: 'not_supported' }
      }

      const endpoint = api.getApiEndpoint('camera')
      const body = dir === 'home'
        ? { action: 'home' }
        : { action: 'move', direction: dir, speed: 50 }

      // Try multiple PTZ endpoint formats (firmware-dependent)
      const paths = ['/ptz', '/move']
      let lastStatus: number | undefined

      for (const p of paths) {
        const url = `${endpoint}/${camera.id}${p}`
        try {
          const response = await api.retrieve(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (response && api.responseOk(response.statusCode)) {
            return { ok: true as const, data: { camera: camera.name, direction: dir } }
          }
          lastStatus = response?.statusCode
        } catch { /* try next path */ }
      }

      // Fallback: try PATCH directly (some firmware only supports this)
      try {
        const patchUrl = `${endpoint}/${camera.id}`
        const patchResponse = await api.retrieve(patchUrl, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ptz: body }),
        })
        if (patchResponse && api.responseOk(patchResponse.statusCode)) {
          return { ok: true as const, data: { camera: camera.name, direction: dir, method: 'patch' } }
        }
        lastStatus = patchResponse?.statusCode
      } catch { /* PATCH not supported */ }

      return {
        ok: false,
        kind: 'system' as const,
        message: `PTZ failed — camera "${camera.name}" doesn't support PTZ via REST API${lastStatus ? ` (last HTTP ${lastStatus})` : ''}`,
        code: 'ptz_failed',
      }
    })
  },
}