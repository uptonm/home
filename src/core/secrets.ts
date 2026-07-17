import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { paths } from './paths'
import { loadGlobalConfig, saveGlobalConfig, type SecretsBackend } from './config'
import { SystemError } from './errors'

const KEYRING_SERVICE = 'home-cli'

/**
 * Account holding every secret as one JSON blob.
 *
 * macOS attaches an ACL to each keychain *item*, so a item-per-secret layout
 * costs one "allow access?" prompt per module, and every prompt repeats whenever
 * the binary's identity changes. One item means one grant. It cannot collide
 * with a legacy account name: those are always `module:key` and contain a colon.
 */
const KEYRING_ACCOUNT = 'secrets'

/** Layout shared by both backends — only the storage medium differs. */
interface SecretStore {
  $schemaVersion?: number
  entries?: Record<string, string>
}

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

function requireKeyring(): KeyringModule {
  const mod = tryLoadKeyring()
  if (!mod) throw new SystemError('keyring backend selected but @napi-rs/keyring not loadable', 'keyring_missing')
  return mod
}

function account(module: string, key: string): string {
  return `${module}:${key}`
}

function parseStore(raw: string, source: string): Record<string, string> {
  try {
    return (JSON.parse(raw) as SecretStore).entries ?? {}
  } catch (err) {
    throw new SystemError(`failed to read secrets from ${source}: ${(err as Error).message}`, 'secrets_parse')
  }
}

function serializeStore(entries: Record<string, string>): string {
  return JSON.stringify({ $schemaVersion: 1, entries }, null, 2)
}

// ── file backend ────────────────────────────────────────────────────────────

function fileStore(): Record<string, string> {
  if (!existsSync(paths.secretsFile)) return {}
  return parseStore(readFileSync(paths.secretsFile, 'utf8'), paths.secretsFile)
}

function writeFileStore(entries: Record<string, string>): void {
  writeFileSync(paths.secretsFile, serializeStore(entries) + '\n', { mode: 0o600 })
  chmodSync(paths.secretsFile, 0o600)
}

// ── keyring backend ─────────────────────────────────────────────────────────

function keyringStore(): Record<string, string> {
  const entry = new (requireKeyring().Entry)(KEYRING_SERVICE, KEYRING_ACCOUNT)
  let raw: string | null
  try {
    raw = entry.getPassword()
  } catch {
    // No item yet, or access denied — treat as empty and let the caller fall
    // back to the legacy layout rather than hard-failing.
    return {}
  }
  if (!raw) return {}
  return parseStore(raw, 'keyring')
}

function writeKeyringStore(entries: Record<string, string>): void {
  new (requireKeyring().Entry)(KEYRING_SERVICE, KEYRING_ACCOUNT).setPassword(serializeStore(entries))
}

/**
 * Read a secret from the pre-consolidation layout (one keychain item per
 * `module:key`). Returns null when absent.
 */
function readLegacyEntry(acct: string): string | null {
  try {
    return new (requireKeyring().Entry)(KEYRING_SERVICE, acct).getPassword()
  } catch {
    return null
  }
}

function deleteLegacyEntry(acct: string): void {
  try {
    new (requireKeyring().Entry)(KEYRING_SERVICE, acct).deletePassword()
  } catch {
    /* already gone — fine */
  }
}

/**
 * Fold a legacy per-secret item into the consolidated one and drop the original.
 *
 * Migration is lazy and per-key on purpose: `core` can't see the module registry
 * (that would invert the dependency), so there is no way to enumerate which
 * secrets exist up front. Each secret therefore migrates the first time it's
 * read — one prompt each, once — after which every read hits the single item.
 */
function migrateLegacySecret(acct: string, store: Record<string, string>): string | null {
  const legacy = readLegacyEntry(acct)
  if (legacy === null) return null
  store[acct] = legacy
  writeKeyringStore(store)
  deleteLegacyEntry(acct)
  return legacy
}

// ── public API ──────────────────────────────────────────────────────────────

function backendOrDefault(): SecretsBackend {
  const cfg = loadGlobalConfig()
  return cfg.secretsBackend ?? (tryLoadKeyring() ? 'keyring' : 'file')
}

export function getSecret(module: string, key: string): string | null {
  const acct = account(module, key)
  if (backendOrDefault() === 'keyring') {
    const store = keyringStore()
    if (acct in store) return store[acct] ?? null
    return migrateLegacySecret(acct, store)
  }
  return fileStore()[acct] ?? null
}

export function setSecret(module: string, key: string, value: string): void {
  const acct = account(module, key)
  if (backendOrDefault() === 'keyring') {
    const store = keyringStore()
    store[acct] = value
    writeKeyringStore(store)
    // Drop any stale pre-consolidation copy so it can't shadow this later.
    deleteLegacyEntry(acct)
    return
  }
  const entries = fileStore()
  entries[acct] = value
  writeFileStore(entries)
}

export function deleteSecret(module: string, key: string): void {
  const acct = account(module, key)
  if (backendOrDefault() === 'keyring') {
    const store = keyringStore()
    delete store[acct]
    writeKeyringStore(store)
    deleteLegacyEntry(acct)
    return
  }
  const entries = fileStore()
  delete entries[acct]
  writeFileStore(entries)
}

function storeFor(backend: SecretsBackend): Record<string, string> {
  return backend === 'keyring' ? keyringStore() : fileStore()
}

/**
 * Secret keys held for `module`. Now works on both backends — the consolidated
 * keyring item is enumerable, where the old item-per-secret layout was not.
 */
export function listSecretKeys(module: string): string[] {
  const prefix = `${module}:`
  return Object.keys(storeFor(backendOrDefault()))
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
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

/**
 * Every stored secret. `modules` is retained for callers that still want to
 * force legacy migration by looking up declared keys first; the consolidated
 * store is enumerable on both backends, so it is no longer required.
 */
export function exportAll(_modules: string[] = []): SecretRow[] {
  const out: SecretRow[] = []
  for (const [combo, value] of Object.entries(storeFor(backendOrDefault()))) {
    const [mod, ...rest] = combo.split(':')
    if (!mod || rest.length === 0) continue
    out.push({ module: mod, key: rest.join(':'), value })
  }
  return out
}

/** Bulk write — one store read/write for the whole batch rather than per row. */
export function importAll(rows: SecretRow[]): void {
  if (rows.length === 0) return
  const backend = backendOrDefault()
  const store = storeFor(backend)
  for (const row of rows) store[account(row.module, row.key)] = row.value

  if (backend === 'keyring') {
    writeKeyringStore(store)
    for (const row of rows) deleteLegacyEntry(account(row.module, row.key))
    return
  }
  writeFileStore(store)
}
