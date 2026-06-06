import { existsSync, readFileSync, rmSync } from 'node:fs'
import { afterAll, describe, expect, mock, test } from 'bun:test'
import type { ResolveResult } from '../modules/assistant/client'

const EMPTY_CTX = {
  config: {},
  json: false,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {},
}

function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const OUT = `/tmp/assistant-camera-test-${process.pid}.jpg`

const realClient = await import('../modules/assistant/client')

mock.module('../modules/assistant/client', () => ({
  ...realClient,
  resolveEntity: async (_cfg: unknown, ref: string): Promise<ResolveResult> => {
    if (ref === 'Front Door' || ref === 'camera.front_door') {
      return { kind: 'ok', entity: { entity_id: 'camera.front_door', friendly_name: 'Front Door' } }
    }
    return { kind: 'not_found' }
  },
  cameraSnapshot: async () => JPEG,
}))

const { cameraSnapshotCmd } = await import('../modules/assistant/commands/camera')

afterAll(() => {
  rmSync(OUT, { force: true })
})

describe('assistant camera snapshot', () => {
  test('command path and required arg', () => {
    expect(cameraSnapshotCmd.path).toEqual(['camera', 'snapshot'])
    expect(cameraSnapshotCmd.args.find((a) => a.name === 'camera')?.required).toBe(true)
  })

  test('rejects missing camera', async () => {
    expect(errCode(await cameraSnapshotCmd.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('not_found for an unknown camera', async () => {
    expect(errCode(await cameraSnapshotCmd.run({ ...EMPTY_CTX, args: { camera: 'nope' } }))).toBe('not_found')
  })

  test('writes the JPEG to --out and reports bytes', async () => {
    const res = await cameraSnapshotCmd.run({ ...EMPTY_CTX, args: { camera: 'Front Door', out: OUT } })
    expect(res.ok).toBe(true)
    const data = (res as { data: { entity_id: string; path: string; bytes: number } }).data
    expect(data.entity_id).toBe('camera.front_door')
    expect(data.path).toBe(OUT)
    expect(data.bytes).toBe(JPEG.length)
    expect(existsSync(OUT)).toBe(true)
    expect(readFileSync(OUT).equals(JPEG)).toBe(true)
  })
})
