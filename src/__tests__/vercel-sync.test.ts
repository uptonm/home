import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// `paths` resolves XDG_CONFIG_HOME at module load — point it at a throwaway
// dir *before* importing anything that reads it, or these tests would read the
// real secret store. Mirrors vercel-apply.test.ts.
const CONFIG_ROOT = mkdtempSync(join(tmpdir(), 'home-vercel-sync-'))
process.env.XDG_CONFIG_HOME = CONFIG_ROOT
const HOME_DIR = join(CONFIG_ROOT, 'home')
mkdirSync(join(HOME_DIR, 'modules'), { recursive: true })
writeFileSync(join(HOME_DIR, 'config.json'), JSON.stringify({ $schemaVersion: 1, secretsBackend: 'file' }))

const { collectLocal, decodeKey, encodeKey, fieldFor, KEY_PREFIX } = await import('../modules/vercel/sync')
const { saveModuleConfig, deleteModuleConfig } = await import('../core/config')
const { setSecret, deleteSecret } = await import('../core/secrets')
const { modules } = await import('../registry')

afterAll(() => rmSync(CONFIG_ROOT, { recursive: true, force: true }))

afterEach(() => {
  deleteSecret('gmail', 'refreshToken')
  deleteSecret('beszel', 'password')
  deleteModuleConfig('beszel')
})

describe('key encoding', () => {
  test('round-trips a camelCase field without lowering it', () => {
    const key = encodeKey('unifi', 'insecureTLS')
    expect(key).toBe('HOME__unifi__insecureTLS')
    expect(decodeKey(key)).toEqual({ module: 'unifi', field: 'insecureTLS' })
  })

  test('round-trips every syncable field in the registry', () => {
    for (const m of modules) {
      for (const f of m.configSchema) {
        expect(decodeKey(encodeKey(m.name, f.key))).toEqual({ module: m.name, field: f.key })
      }
    }
  })

  test('ignores keys that are not ours', () => {
    expect(decodeKey('DATABASE_URL')).toBeNull()
    expect(decodeKey('HOME_UPPER_TEST')).toBeNull()
    expect(decodeKey(`${KEY_PREFIX}nosep`)).toBeNull()
  })
})

describe('host-local fields are never synced', () => {
  test('sonos.subnet is marked hostLocal', () => {
    const sonos = modules.find((m) => m.name === 'sonos')!
    const subnet = sonos.configSchema.find((f) => f.key === 'subnet')!
    expect(subnet.hostLocal).toBe(true)
  })

  test('fieldFor refuses a hostLocal field, so pull cannot apply it', () => {
    expect(fieldFor('sonos', 'subnet')).toBeNull()
  })

  test('fieldFor refuses the vercel module itself', () => {
    expect(fieldFor('vercel', 'teamSlug')).toBeNull()
  })

  test('fieldFor refuses unknown modules and fields', () => {
    expect(fieldFor('nope', 'url')).toBeNull()
    expect(fieldFor('unifi', 'nope')).toBeNull()
  })

  test('fieldFor resolves a normal field', () => {
    expect(fieldFor('unifi', 'insecureTLS')?.kind).toBe('boolean')
  })
})

describe('collectLocal sees secret-only modules with no config file', () => {
  // gmail's entire persisted state is a single `refreshToken` secret written
  // by `configure` — it never gets a modules/gmail.json file.
  test('a declared secret with no config file is still surfaced', () => {
    setSecret('gmail', 'refreshToken', 'rt-token-value')
    const entries = collectLocal().filter((e) => e.module === 'gmail')
    expect(entries).toEqual([
      { module: 'gmail', field: 'refreshToken', key: encodeKey('gmail', 'refreshToken'), value: 'rt-token-value', secret: true },
    ])
  })

  test('same module, secret absent from the store, contributes nothing', () => {
    const entries = collectLocal().filter((e) => e.module === 'gmail')
    expect(entries).toEqual([])
  })

  test('with no config file, a non-secret field never surfaces — only the declared secret does', () => {
    setSecret('beszel', 'password', 'sekrit-key')
    const entries = collectLocal().filter((e) => e.module === 'beszel')
    expect(entries).toEqual([
      { module: 'beszel', field: 'password', key: encodeKey('beszel', 'password'), value: 'sekrit-key', secret: true },
    ])
  })

  test('existing-behavior guard: a module with a config file still emits the same merged entries', () => {
    saveModuleConfig('beszel', { $schemaVersion: 1, url: 'https://beszel.internal', email: 'admin@example.com' })
    setSecret('beszel', 'password', 'sekrit-key')

    const entries = collectLocal()
      .filter((e) => e.module === 'beszel')
      .sort((a, b) => a.field.localeCompare(b.field))

    expect(entries).toEqual([
      { module: 'beszel', field: 'email', key: encodeKey('beszel', 'email'), value: 'admin@example.com', secret: false },
      { module: 'beszel', field: 'password', key: encodeKey('beszel', 'password'), value: 'sekrit-key', secret: true },
      { module: 'beszel', field: 'url', key: encodeKey('beszel', 'url'), value: 'https://beszel.internal', secret: false },
    ])
  })
})
