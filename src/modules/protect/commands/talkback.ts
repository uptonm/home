import type { CommandSpec } from '../../../core/types'
import { getBootstrap, getTalkbackUrl, readProtectConfig } from '../client'
import { pickOne } from './shared'

export const camerasTalkback: CommandSpec = {
  path: ['cameras', 'talkback'],
  effect: 'destructive',
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

    const bootstrap = await getBootstrap(cfg)
    const picked = pickOne(bootstrap.cameras ?? [], ref, 'camera')
    if (!picked.ok) return picked.error
    const camera = picked.item

    const wsUrl = await getTalkbackUrl(cfg, camera.id ?? '')
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
  },
}
