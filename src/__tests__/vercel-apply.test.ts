import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Point config at a throwaway dir *before* importing anything that reads it —
// `paths` resolves XDG_CONFIG_HOME at module load. The file secrets backend
// keeps this test free of keyring mocks.
const CONFIG_ROOT = mkdtempSync(join(tmpdir(), 'home-vercel-apply-'))
process.env.XDG_CONFIG_HOME = CONFIG_ROOT
const HOME_DIR = join(CONFIG_ROOT, 'home')
mkdirSync(join(HOME_DIR, 'modules'), { recursive: true })
writeFileSync(join(HOME_DIR, 'config.json'), JSON.stringify({ $schemaVersion: 1, secretsBackend: 'file' }))

const { applyRemote, encodeKey } = await import('../modules/vercel/sync')
const { batchFailureMessage } = await import('../modules/vercel/client')
const { setSecret, getSecret } = await import('../core/secrets')

const unifiConfigPath = join(HOME_DIR, 'modules', 'unifi.json')

function seedUnifi(): void {
  writeFileSync(
    unifiConfigPath,
    JSON.stringify({ $schemaVersion: 1, url: 'https://10.0.10.1', insecureTLS: true, site: 'default' }),
  )
  setSecret('unifi', 'apiKey', 'sekrit')
}

afterAll(() => rmSync(CONFIG_ROOT, { recursive: true, force: true }))

describe('applyRemote equality', () => {
  test('values already equal locally are unchanged, not applied', () => {
    seedUnifi()
    const remote = new Map([
      [encodeKey('unifi', 'url'), 'https://10.0.10.1'],
      // Booleans travel as strings; equality must compare the coerced value.
      [encodeKey('unifi', 'insecureTLS'), 'true'],
      [encodeKey('unifi', 'apiKey'), 'sekrit'],
    ])

    const res = applyRemote(remote, false)

    expect(res.applied).toEqual([])
    expect(res.unchanged.map((u) => u.field).sort()).toEqual(['apiKey', 'insecureTLS', 'url'])
  })

  test('only the differing value is applied and written', () => {
    seedUnifi()
    const remote = new Map([
      [encodeKey('unifi', 'url'), 'https://10.0.20.1'],
      [encodeKey('unifi', 'apiKey'), 'sekrit'],
    ])

    const res = applyRemote(remote, false)

    expect(res.applied).toEqual([{ module: 'unifi', field: 'url', secret: false }])
    expect(res.unchanged.map((u) => u.field)).toEqual(['apiKey'])
    const cfg = JSON.parse(readFileSync(unifiConfigPath, 'utf8'))
    expect(cfg.url).toBe('https://10.0.20.1')
    expect(cfg.insecureTLS).toBe(true)
  })

  test('dry-run reports pending changes without writing anything', () => {
    seedUnifi()
    const remote = new Map([
      [encodeKey('unifi', 'url'), 'https://10.0.30.1'],
      [encodeKey('unifi', 'apiKey'), 'rotated'],
    ])

    const res = applyRemote(remote, true)

    expect(res.applied.map((a) => a.field).sort()).toEqual(['apiKey', 'url'])
    expect(JSON.parse(readFileSync(unifiConfigPath, 'utf8')).url).toBe('https://10.0.10.1')
    expect(getSecret('unifi', 'apiKey')).toBe('sekrit')
  })

  test('a differing secret is written on a real run', () => {
    seedUnifi()
    const res = applyRemote(new Map([[encodeKey('unifi', 'apiKey'), 'rotated']]), false)
    expect(res.applied).toEqual([{ module: 'unifi', field: 'apiKey', secret: true }])
    expect(getSecret('unifi', 'apiKey')).toBe('rotated')
  })

  test('hostLocal and unknown fields are skipped, never written', () => {
    const res = applyRemote(
      new Map([
        [encodeKey('sonos', 'subnet'), '10.0.99.0/24'],
        [encodeKey('nope', 'url'), 'x'],
      ]),
      false,
    )
    expect(res.applied).toEqual([])
    expect(res.skipped.length).toBe(2)
    expect(existsSync(join(HOME_DIR, 'modules', 'sonos.json'))).toBe(false)
  })
})

describe('batchFailureMessage', () => {
  test('null when nothing failed', () => {
    expect(batchFailureMessage(undefined)).toBeNull()
    expect(batchFailureMessage([])).toBeNull()
  })

  test('names the key via envVarKey (error.key is the field name, not the env key)', () => {
    const msg = batchFailureMessage([
      { error: { code: 'env_key_invalid_characters', message: 'invalid characters', key: 'key', envVarKey: 'HOME__x__y' } as never },
    ])
    expect(msg).toContain('HOME__x__y')
    expect(msg).toContain('invalid characters')
  })

  test('maps an id back to its key name for PATCH failures', () => {
    const msg = batchFailureMessage(
      [{ error: { id: 'env_123', message: 'nope' } }],
      new Map([['env_123', 'HOME__unifi__apiKey']]),
    )
    expect(msg).toContain('HOME__unifi__apiKey')
  })
})
