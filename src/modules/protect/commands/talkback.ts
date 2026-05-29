import type { CommandSpec } from '../../../core/types'
import { readProtectConfig, withApi } from '../client'

export const camerasTalkback: CommandSpec = {
  path: ['cameras', 'talkback'],
  description: 'Print the talkback (two-way audio) WebSocket URL for a camera',
  args: [{ name: 'camera', kind: 'positional', description: 'Camera id or name', required: true }],
  examples: [
    'home protect cameras talkback "Front Door"',
    'home protect cameras talkback "Front Door" --json',
  ],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.camera ?? '')
    if (!ref) return { ok: false, kind: 'user' as const, message: 'camera is required', code: 'missing_arg' }

    return withApi(cfg, async (api) => {
      const cameras = api.bootstrap?.cameras ?? []
      const camera =
        cameras.find((c) => c.id === ref) ?? cameras.find((c) => c.name === ref)
      if (!camera) {
        return { ok: false, kind: 'user' as const, message: `no camera "${ref}" found`, code: 'not_found' }
      }

      const params = new URLSearchParams({ camera: camera.id })
      const wsUrl = await api.getWsEndpoint('talkback', params)

      if (!wsUrl) {
        return {
          ok: false,
          kind: 'system' as const,
          message: `failed to get talkback endpoint for camera "${camera.name}"`,
          code: 'talkback_failed',
        }
      }

      return {
        ok: true as const,
        data: {
          camera: camera.name,
          url: wsUrl,
          hint: 'Connect to this WebSocket and send AAC-encoded ADTS audio frames for two-way audio',
        },
      }
    })
  },
}