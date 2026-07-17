import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// `paths` resolves XDG_CONFIG_HOME at module load — point it at a throwaway
// dir *before* importing anything that reads it, or these tests would read the
// real secret store. Mirrors secrets-keyring.test.ts.
const CONFIG_ROOT = mkdtempSync(join(tmpdir(), 'home-google-test-'))
process.env.XDG_CONFIG_HOME = CONFIG_ROOT
mkdirSync(join(CONFIG_ROOT, 'home'), { recursive: true })
writeFileSync(join(CONFIG_ROOT, 'home', 'config.json'), JSON.stringify({ $schemaVersion: 1, secretsBackend: 'file' }))

const { readSharedGoogleClient, requireGoogleCredentials } = await import('../core/google-auth')
const { saveModuleConfig, deleteModuleConfig } = await import('../core/config')
const { setSecret, deleteSecret } = await import('../core/secrets')

function seedClient(): void {
  saveModuleConfig('google', { $schemaVersion: 1, clientId: 'cid.apps.googleusercontent.com' })
  setSecret('google', 'clientSecret', 'csec')
}

afterEach(() => {
  deleteModuleConfig('google')
  deleteSecret('google', 'clientSecret')
  deleteSecret('gmail', 'refreshToken')
  deleteSecret('gdrive', 'refreshToken')
})

describe('readSharedGoogleClient', () => {
  test('returns null when the google module is unconfigured', () => {
    expect(readSharedGoogleClient()).toBeNull()
  })

  test('returns null when the client id is set but the secret is missing', () => {
    saveModuleConfig('google', { $schemaVersion: 1, clientId: 'cid.apps.googleusercontent.com' })
    expect(readSharedGoogleClient()).toBeNull()
  })

  test('assembles the client from google config + secret', () => {
    seedClient()
    expect(readSharedGoogleClient()).toEqual({
      clientId: 'cid.apps.googleusercontent.com',
      clientSecret: 'csec',
    })
  })
})

describe('requireGoogleCredentials', () => {
  test('throws google_unconfigured naming `home google configure`', () => {
    expect(() => requireGoogleCredentials('gmail')).toThrow(/home google configure/)
  })

  test('throws google_unauthorized naming the calling module', () => {
    seedClient()
    expect(() => requireGoogleCredentials('gmail')).toThrow(/home gmail configure/)
  })

  test('combines the shared client with the module refresh token', () => {
    seedClient()
    setSecret('gmail', 'refreshToken', 'rtok')
    expect(requireGoogleCredentials('gmail')).toEqual({
      clientId: 'cid.apps.googleusercontent.com',
      clientSecret: 'csec',
      refreshToken: 'rtok',
    })
  })

  test('reads a different refresh token per module', () => {
    seedClient()
    setSecret('gmail', 'refreshToken', 'gmail-tok')
    setSecret('gdrive', 'refreshToken', 'drive-tok')
    expect(requireGoogleCredentials('gmail').refreshToken).toBe('gmail-tok')
    expect(requireGoogleCredentials('gdrive').refreshToken).toBe('drive-tok')
    deleteSecret('gdrive', 'refreshToken')
  })
})

const { modules } = await import('../registry')

describe('google module', () => {
  test('is registered', () => {
    expect(modules.find((m) => m.name === 'google')).toBeDefined()
  })

  test('declares clientId and clientSecret, and no refreshToken', () => {
    const google = modules.find((m) => m.name === 'google')!
    expect(google.configSchema.map((f) => f.key)).toEqual(['clientId', 'clientSecret'])
    expect(google.configSchema.find((f) => f.key === 'clientSecret')?.kind).toBe('secret')
  })

  test('is registered before gdrive and gmail so configure-all can order correctly', () => {
    const names = modules.map((m) => m.name)
    expect(names.indexOf('google')).toBeLessThan(names.indexOf('gdrive'))
    expect(names.indexOf('google')).toBeLessThan(names.indexOf('gmail'))
  })

  test('status reports which modules hold a grant', async () => {
    seedClient()
    setSecret('gmail', 'refreshToken', 'rtok')
    const google = modules.find((m) => m.name === 'google')!
    const result = await google.status({ clientId: 'cid.apps.googleusercontent.com' })
    expect(result.ok).toBe(true)
    expect((result as { data: { authorized: string[] } }).data.authorized).toEqual(['gmail'])
  })
})

describe('google logout', () => {
  const logout = () => {
    const google = modules.find((m) => m.name === 'google')!
    return google.commands.find((c) => c.path.join(' ') === 'logout')!
  }

  test('clears every module that holds a refresh token and reports which', async () => {
    seedClient()
    setSecret('gmail', 'refreshToken', 'gtok')
    setSecret('gdrive', 'refreshToken', 'dtok')
    const result = await logout().run({ args: {}, config: {} } as never)
    expect(result.ok).toBe(true)
    expect((result as { data: { cleared: string[] } }).data.cleared).toEqual(['gmail', 'gdrive'])
    // Both grants are gone: the client survives but each module now throws unauthorized.
    expect(() => requireGoogleCredentials('gmail')).toThrow(/home gmail configure/)
    expect(() => requireGoogleCredentials('gdrive')).toThrow(/home gdrive configure/)
  })

  test('leaves the shared client intact and skips modules with no grant', async () => {
    seedClient()
    setSecret('gmail', 'refreshToken', 'gtok')
    const result = await logout().run({ args: {}, config: {} } as never)
    expect((result as { data: { cleared: string[] } }).data.cleared).toEqual(['gmail'])
    // The shared client is untouched — logout forgets grants, not the app.
    expect(readSharedGoogleClient()).not.toBeNull()
  })
})

rmSync(CONFIG_ROOT, { recursive: true, force: true })
