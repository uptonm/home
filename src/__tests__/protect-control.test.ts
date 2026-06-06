import { describe, expect, test } from 'bun:test'
import { camerasPtz } from '../modules/protect/commands/ptz'
import { camerasLed } from '../modules/protect/commands/camera-led'
import { camerasTalkback } from '../modules/protect/commands/talkback'
import { lightsOn } from '../modules/protect/commands/lights'

const EMPTY_CTX = { config: {}, json: false, quiet: true, verbose: false, log: null as unknown as ReturnType<typeof import('consola').createConsola>, args: {} }

function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

describe('protect ptz', () => {
  test('rejects missing camera', async () => {
    expect(errCode(await camerasPtz.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('rejects invalid direction', async () => {
    expect(errCode(await camerasPtz.run({ ...EMPTY_CTX, args: { camera: 't', direction: 'diagonal' } }))).toBe('invalid_arg')
  })
})

describe('protect cameras led', () => {
  test('rejects missing camera', async () => {
    expect(errCode(await camerasLed.run({ ...EMPTY_CTX, args: { feature: 'ir', state: 'on' } }))).toBe('missing_arg')
  })

  test('rejects invalid ir state', async () => {
    expect(errCode(await camerasLed.run({ ...EMPTY_CTX, args: { camera: 't', feature: 'ir', state: 'blink' } }))).toBe('invalid_arg')
  })

  test('rejects auto for spotlight', async () => {
    expect(errCode(await camerasLed.run({ ...EMPTY_CTX, args: { camera: 't', feature: 'spotlight', state: 'auto' } }))).toBe('invalid_arg')
  })
})

describe('protect cameras talkback', () => {
  test('rejects missing camera', async () => {
    expect(errCode(await camerasTalkback.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })
})

describe('protect lights', () => {
  test('rejects missing light', async () => {
    expect(errCode(await lightsOn.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('rejects invalid brightness', async () => {
    expect(errCode(await lightsOn.run({ ...EMPTY_CTX, args: { light: 'test', brightness: '150' } }))).toBe('invalid_arg')
  })

  test('rejects negative brightness', async () => {
    expect(errCode(await lightsOn.run({ ...EMPTY_CTX, args: { light: 'test', brightness: '-5' } }))).toBe('invalid_arg')
  })
})
