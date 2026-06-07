import { writeFileSync } from 'node:fs'
import type { CommandSpec } from '../../../core/types'
import { getBootstrap, getSnapshot, readProtectConfig } from '../client'
import { pickOne } from './shared'

export const snapshot: CommandSpec = {
  path: ['snapshot'],
  description: 'Capture a JPEG snapshot from a camera',
  args: [
    { name: 'camera', kind: 'positional', description: 'Camera id or name', required: true },
    { name: 'out', kind: 'string', description: 'Output path; defaults to ./<camera>.jpg' },
    { name: 'stdout', kind: 'boolean', description: 'Write JPEG bytes to stdout instead of a file' },
  ],
  examples: [
    'home protect snapshot <camera-id>',
    'home protect snapshot Front-Door --out /tmp/front.jpg',
    'home protect snapshot Front-Door --stdout | imgcat',
  ],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.camera ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'camera is required', code: 'missing_arg' }
    const toStdout = Boolean(ctx.args.stdout)
    const out = ctx.args.out ? String(ctx.args.out) : `./${ref.replace(/\s+/g, '_')}.jpg`

    const bootstrap = await getBootstrap(cfg)
    const picked = pickOne(bootstrap.cameras ?? [], ref, 'camera')
    if (!picked.ok) return picked.error
    const camera = picked.item

    const buf = await getSnapshot(cfg, camera.id ?? '')
    if (!buf) return { ok: false, kind: 'system', message: `snapshot failed for camera "${camera.name}"`, code: 'snapshot_failed' }

    if (toStdout) {
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(buf, (err) => (err ? reject(err) : resolve()))
      })
      return { ok: true }
    }
    writeFileSync(out, buf)
    return { ok: true, data: { path: out, bytes: buf.length, camera: camera.name } }
  },
}
