import { writeFileSync } from 'node:fs'
import type { CommandSpec } from '../../../core/types'
import { readProtectConfig, withApi } from '../client'

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
    const result = await withApi(cfg, async (api) => {
      const cameras = api.bootstrap?.cameras ?? []
      const camera = cameras.find((c) => c.id === ref) ?? cameras.find((c) => c.name === ref)
      if (!camera) return null
      const buf = await api.getSnapshot(camera)
      if (!buf) return null
      if (toStdout) {
        process.stdout.write(buf)
        return { stdout: true, bytes: buf.length, camera: camera.name }
      }
      writeFileSync(out, buf)
      return { path: out, bytes: buf.length, camera: camera.name }
    })
    if (!result) return { ok: false, kind: 'user', message: `no camera "${ref}" or snapshot failed`, code: 'snapshot_failed' }
    if (toStdout) return { ok: true }
    return { ok: true, data: result }
  },
}
