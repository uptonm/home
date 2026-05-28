import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { paths } from './paths'
import { loadGlobalConfig, saveGlobalConfig, type SecretsBackend } from './config'
import { SystemError } from './errors'

const KEYRING_SERVICE = 'home-cli'

interface KeyringEntry {
  setPassword(value: string): void
  getPassword(): string | null
  deletePassword(): boolean
}

interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry
}

let keyringMod: KeyringModule | null | undefined

function tryLoadKeyring(): KeyringModule | null {
  if (keyringMod !== undefined) return keyringMod
  try {
    keyringMod = require('@napi-rs/keyring') as KeyringModule
    return keyringMod
  } catch {
    keyringMod = null
    return null
  }
}

function account(module: string, key: string): string {
  return `${module}:${key}`
}

function fileStore(): Record<string, string> {
  if (!existsSync(paths.secretsFile)) return {}
  try {
    const raw = JSON.parse(readFileSync(paths.secretsFile, 'utf8')) as {
      $schemaVersion?: number
      entries?: Record<string, string>
    }
    return raw.entries ?? {}
  } catch (err) {
    throw new SystemError(`failed to read ${paths.secretsFile}: ${(err as Error).message}`, 'secrets_parse')
  }
}

function writeFileStore(entries: Record<string, string>): void {
  const data = { $schemaVersion: 1, entries }
  writeFileSync(paths.secretsFile, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  chmodSync(paths.secretsFile, 0o600)
}

function backendOrDefault(): SecretsBackend {
  const cfg = loadGlobalConfig()
  return cfg.secretsBackend ?? (tryLoadKeyring() ? 'keyring' : 'file')
}

export function getSecret(module: string, key: string): string | null {
  const backend = backendOrDefault()
  if (backend === 'keyring') {
    const mod = tryLoadKeyring()
    if (!mod) throw new SystemError('keyring backend selected but @napi-rs/keyring not loadable', 'keyring_missing')
    const entry = new mod.Entry(KEYRING_SERVICE, account(module, key))
    try {
      return entry.getPassword()
    } catch {
      return null
    }
  }
  return fileStore()[account(module, key)] ?? null
}

export function setSecret(module: string, key: string, value: string): void {
  const backend = backendOrDefault()
  if (backend === 'keyring') {
    const mod = tryLoadKeyring()
    if (!mod) throw new SystemError('keyring backend selected but @napi-rs/keyring not loadable', 'keyring_missing')
    new mod.Entry(KEYRING_SERVICE, account(module, key)).setPassword(value)
    return
  }
  const entries = fileStore()
  entries[account(module, key)] = value
  writeFileStore(entries)
}

export function deleteSecret(module: string, key: string): void {
  const backend = backendOrDefault()
  if (backend === 'keyring') {
    const mod = tryLoadKeyring()
    if (!mod) throw new SystemError('keyring backend selected but @napi-rs/keyring not loadable', 'keyring_missing')
    try {
      new mod.Entry(KEYRING_SERVICE, account(module, key)).deletePassword()
    } catch {
      /* not present — fine */
    }
    return
  }
  const entries = fileStore()
  delete entries[account(module, key)]
  writeFileStore(entries)
}

export function listSecretKeys(module: string): string[] {
  const backend = backendOrDefault()
  if (backend === 'file') {
    const prefix = `${module}:`
    return Object.keys(fileStore())
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length))
  }
  // Keyring backends don't generally support listing; return [].
  return []
}

export function probeKeyring(): boolean {
  const mod = tryLoadKeyring()
  if (!mod) return false
  try {
    new mod.Entry(KEYRING_SERVICE, '__probe__').getPassword()
    return true
  } catch {
    return false
  }
}

export function selectAndPersistBackend(backend: SecretsBackend): void {
  const cfg = loadGlobalConfig()
  cfg.secretsBackend = backend
  saveGlobalConfig(cfg)
}

export interface SecretRow {
  module: string
  key: string
  value: string
}

export function exportAll(modules: string[]): SecretRow[] {
  const out: SecretRow[] = []
  const backend = backendOrDefault()
  if (backend === 'file') {
    const entries = fileStore()
    for (const [combo, value] of Object.entries(entries)) {
      const [mod, ...rest] = combo.split(':')
      if (!mod) continue
      out.push({ module: mod, key: rest.join(':'), value })
    }
    return out
  }
  // Keyring: we don't know all keys; rely on caller to enumerate via module manifests.
  // Modules pass us their list of secret keys; we look them up.
  return out
}

export function importAll(rows: SecretRow[]): void {
  for (const row of rows) setSecret(row.module, row.key, row.value)
}
