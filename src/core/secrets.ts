import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
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

/**
 * Validate a decoded store. A type assertion establishes nothing: syntactically
 * valid corruption such as `{"entries":[]}` would otherwise pass, migration
 * would assign a named property to the array, JSON.stringify would silently
 * drop it, and the legacy item would then be deleted — losing the secret.
 * Reject anything that is not a plain string-valued object so a corrupt store
 * refuses mutations instead of destroying data.
 */
function validateEntries(parsed: unknown, source: string): Record<string, string> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SystemError(`failed to read secrets from ${source}: root is not an object`, 'secrets_parse')
  }
  const entries = (parsed as SecretStore).entries
  if (entries === undefined) return {}
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    throw new SystemError(`failed to read secrets from ${source}: "entries" is not an object`, 'secrets_parse')
  }
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value !== 'string') {
      throw new SystemError(`failed to read secrets from ${source}: entry "${key}" is not a string`, 'secrets_parse')
    }
  }
  return entries as Record<string, string>
}

function parseStore(raw: string, source: string): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new SystemError(`failed to read secrets from ${source}: ${(err as Error).message}`, 'secrets_parse')
  }
  return validateEntries(parsed, source)
}

function serializeStore(entries: Record<string, string>): string {
  return JSON.stringify({ $schemaVersion: 1, entries }, null, 2)
}

// ── cross-process lock ──────────────────────────────────────────────────────

/**
 * Every mutation is a read/modify/write of one shared value, so two concurrent
 * processes (e.g. both lazily migrating) could each write a store missing the
 * other's key and then delete their legacy items — losing a credential
 * permanently. An O_EXCL lockfile serializes mutations across processes.
 *
 * Keychain dialogs make lock-hold potentially slow, so anything that can pop a
 * dialog (legacy reads) happens *before* the lock is taken; only the re-read,
 * write, and cleanup run under it.
 */
const LOCK_TIMEOUT_MS = Number(process.env.HOME_SECRETS_LOCK_TIMEOUT_MS || 10_000)
const LOCK_STALE_MS = Number(process.env.HOME_SECRETS_LOCK_STALE_MS || 30_000)

function lockFile(): string {
  return join(paths.configRoot, '.secrets.lock')
}

function withStoreLock<T>(fn: () => T): T {
  if (!existsSync(paths.configRoot)) mkdirSync(paths.configRoot, { recursive: true })
  const lock = lockFile()
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      const fd = openSync(lock, 'wx')
      writeSync(fd, `${process.pid}\n`)
      closeSync(fd)
      break
    } catch {
      // Lock held. Break it only when the holder is clearly gone (crashed
      // before its finally ran); otherwise wait our turn.
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          rmSync(lock, { force: true })
          continue
        }
      } catch {
        continue // raced with the holder's release — retry immediately
      }
      if (Date.now() >= deadline) {
        throw new SystemError(
          `timed out waiting for ${lock} — another home process holds the secrets lock`,
          'secrets_lock_timeout',
        )
      }
      Bun.sleepSync(25)
    }
  }
  try {
    return fn()
  } finally {
    rmSync(lock, { force: true })
  }
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

/**
 * A missing item is not an error: @napi-rs/keyring returns null for it on
 * macOS, and some platforms throw a NoEntry-style error instead. Anything
 * else (denied dialog, corrupt blob) is a real failure and must surface —
 * treating it as "absent" turns an unreadable credential into a baffling
 * remote 401, and lets a failed legacy delete report success.
 */
function isNoEntry(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /no matching entry|no entry|not.?found/i.test(msg)
}

/** Read the consolidated store. No item yet → empty; unreadable → throw. */
function readKeyringEntries(): Record<string, string> {
  const entry = new (requireKeyring().Entry)(KEYRING_SERVICE, KEYRING_ACCOUNT)
  let raw: string | null
  try {
    raw = entry.getPassword()
  } catch (err) {
    if (isNoEntry(err)) return {}
    throw new SystemError(
      `keychain item could not be read (denied dialog or keychain failure): ${(err as Error).message}`,
      'keyring_read_failed',
    )
  }
  return raw ? parseStore(raw, 'keyring') : {}
}

function writeKeyringStore(entries: Record<string, string>): void {
  new (requireKeyring().Entry)(KEYRING_SERVICE, KEYRING_ACCOUNT).setPassword(serializeStore(entries))
}

/**
 * Read a secret from the pre-consolidation layout (one keychain item per
 * `module:key`). Missing → null; any other failure throws — a denied read
 * here must not masquerade as "no such secret".
 */
function readLegacyEntry(acct: string): string | null {
  try {
    return new (requireKeyring().Entry)(KEYRING_SERVICE, acct).getPassword()
  } catch (err) {
    if (isNoEntry(err)) return null
    throw new SystemError(
      `legacy keychain item "${acct}" could not be read: ${(err as Error).message}`,
      'keyring_read_failed',
    )
  }
}

/**
 * Delete a legacy item. Missing is fine; any other failure throws — reporting
 * success on a failed delete lets the stale item migrate back on the next
 * read, silently undoing e.g. `home google logout`.
 */
function deleteLegacyEntry(acct: string): void {
  try {
    new (requireKeyring().Entry)(KEYRING_SERVICE, acct).deletePassword()
  } catch (err) {
    if (isNoEntry(err)) return
    throw new SystemError(
      `legacy keychain item "${acct}" could not be deleted: ${(err as Error).message}`,
      'keyring_delete_failed',
    )
  }
}

// ── public API ──────────────────────────────────────────────────────────────

function backendOrDefault(): SecretsBackend {
  const cfg = loadGlobalConfig()
  return cfg.secretsBackend ?? (tryLoadKeyring() ? 'keyring' : 'file')
}

export function getSecret(module: string, key: string): string | null {
  const acct = account(module, key)
  if (backendOrDefault() !== 'keyring') return fileStore()[acct] ?? null

  const entries = readKeyringEntries()
  if (acct in entries) return entries[acct] ?? null

  // Lazy per-key migration from the pre-consolidation layout. The legacy read
  // can pop a keychain dialog, so it happens before the lock; the store is
  // re-read and re-checked under the lock because another process may have
  // migrated or set this key in the meantime.
  const legacy = readLegacyEntry(acct)
  if (legacy === null) return null
  return withStoreLock(() => {
    const fresh = readKeyringEntries()
    if (acct in fresh) {
      deleteLegacyEntry(acct)
      return fresh[acct] ?? null
    }
    fresh[acct] = legacy
    writeKeyringStore(fresh)
    deleteLegacyEntry(acct)
    return legacy
  })
}

export function setSecret(module: string, key: string, value: string): void {
  const acct = account(module, key)
  withStoreLock(() => {
    if (backendOrDefault() === 'keyring') {
      const store = readKeyringEntries()
      store[acct] = value
      writeKeyringStore(store)
      // Drop any stale pre-consolidation copy so it can't migrate back after a
      // later deleteSecret. Ordered after the write: if this throws, the new
      // value is already stored and consolidated reads win over legacy items.
      deleteLegacyEntry(acct)
      return
    }
    const entries = fileStore()
    entries[acct] = value
    writeFileStore(entries)
  })
}

export function deleteSecret(module: string, key: string): void {
  const acct = account(module, key)
  withStoreLock(() => {
    if (backendOrDefault() === 'keyring') {
      // Legacy first: if this throws, nothing has changed — whereas removing
      // the store entry first would let a surviving legacy item migrate right
      // back, silently undoing the delete.
      deleteLegacyEntry(acct)
      const store = readKeyringEntries()
      delete store[acct]
      writeKeyringStore(store)
      return
    }
    const entries = fileStore()
    delete entries[acct]
    writeFileStore(entries)
  })
}

/**
 * Secret keys held for `module`. Works on both backends — the consolidated
 * keyring item is enumerable, where the old item-per-secret layout was not.
 */
export function listSecretKeys(module: string): string[] {
  const prefix = `${module}:`
  const entries = backendOrDefault() === 'keyring' ? readKeyringEntries() : fileStore()
  return Object.keys(entries)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
}

export function probeKeyring(): boolean {
  const mod = tryLoadKeyring()
  if (!mod) return false
  try {
    new mod.Entry(KEYRING_SERVICE, '__probe__').getPassword()
    return true
  } catch (err) {
    return isNoEntry(err)
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
 * Throws rather than silently exporting an incomplete set when the store
 * cannot be read.
 */
export function exportAll(_modules: string[] = []): SecretRow[] {
  const entries = backendOrDefault() === 'keyring' ? readKeyringEntries() : fileStore()
  const out: SecretRow[] = []
  for (const [combo, value] of Object.entries(entries)) {
    const [mod, ...rest] = combo.split(':')
    if (!mod || rest.length === 0) continue
    out.push({ module: mod, key: rest.join(':'), value })
  }
  return out
}

/** Bulk write — one locked store read/write for the whole batch rather than per row. */
export function importAll(rows: SecretRow[]): void {
  if (rows.length === 0) return
  withStoreLock(() => {
    const backend = backendOrDefault()
    const store = backend === 'keyring' ? readKeyringEntries() : fileStore()
    for (const row of rows) store[account(row.module, row.key)] = row.value

    if (backend === 'keyring') {
      writeKeyringStore(store)
      for (const row of rows) deleteLegacyEntry(account(row.module, row.key))
      return
    }
    writeFileStore(store)
  })
}
