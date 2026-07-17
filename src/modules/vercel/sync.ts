import { loadModuleConfig, saveModuleConfig, type ModuleConfigData } from '../../core/config'
import { resolveModuleConfig } from '../../core/citty'
import { getSecret, setSecret } from '../../core/secrets'
import { modules } from '../../registry'
import type { ConfigField, ModuleManifest } from '../../core/types'
import { KEY_PREFIX } from './client'

export { KEY_PREFIX }

/** `HOME__<module>__<field>`. Vercel accepts mixed-case keys, so the field name
 * survives a round trip verbatim — no lossy upper-casing of e.g. `insecureTLS`. */
export function encodeKey(module: string, field: string): string {
  return `${KEY_PREFIX}${module}__${field}`
}

export interface DecodedKey {
  module: string
  field: string
}

export function decodeKey(key: string): DecodedKey | null {
  if (!key.startsWith(KEY_PREFIX)) return null
  const rest = key.slice(KEY_PREFIX.length)
  const sep = rest.indexOf('__')
  if (sep <= 0) return null
  const module = rest.slice(0, sep)
  const field = rest.slice(sep + 2)
  if (!module || !field) return null
  return { module, field }
}

/** The `vercel` module configures the sync itself; syncing it would be circular —
 * you need teamSlug locally before a pull can possibly run. */
function syncableModules(): ModuleManifest[] {
  return modules.filter((m) => m.name !== 'vercel')
}

function syncableFields(manifest: ModuleManifest): ConfigField[] {
  return manifest.configSchema.filter((f) => !f.hostLocal)
}

export interface LocalEntry {
  module: string
  field: string
  key: string
  value: string
  secret: boolean
}

/**
 * Every syncable value present on this host, secrets included. Reuses
 * `resolveModuleConfig` so config and keyring secrets merge exactly the way a
 * real command sees them.
 */
export function collectLocal(): LocalEntry[] {
  const out: LocalEntry[] = []
  for (const manifest of syncableModules()) {
    const cfg = resolveModuleConfig(manifest)
    if (!cfg) continue
    for (const field of syncableFields(manifest)) {
      const raw = cfg[field.key]
      if (raw === undefined || raw === '') continue
      out.push({
        module: manifest.name,
        field: field.key,
        key: encodeKey(manifest.name, field.key),
        value: String(raw),
        secret: field.kind === 'secret',
      })
    }
  }
  return out
}

/** Resolve a remote key back to its declaring field, or null if it names a
 * module/field this build doesn't know or must not sync. */
export function fieldFor(module: string, field: string): ConfigField | null {
  const manifest = syncableModules().find((m) => m.name === module)
  if (!manifest) return null
  return syncableFields(manifest).find((f) => f.key === field) ?? null
}

/** Coerce a transported string back to the type the field declares. */
function coerce(field: ConfigField, value: string): string | boolean {
  if (field.kind === 'boolean') return value === 'true'
  return value
}

export interface ApplyResult {
  applied: { module: string; field: string; secret: boolean }[]
  unchanged: { module: string; field: string; secret: boolean }[]
  skipped: { key: string; reason: string }[]
}

/**
 * Write remote values into local config and secrets. Additive by design: local
 * keys absent from `remote` are left untouched, so a pull can never delete
 * config this host has and the other doesn't. Values already equal locally are
 * reported as `unchanged` and not rewritten — so `--dry-run` genuinely means
 * "what would change", and a pull right after a pull reports nothing pending.
 */
export function applyRemote(remote: Map<string, string>, dryRun: boolean): ApplyResult {
  const applied: ApplyResult['applied'] = []
  const unchanged: ApplyResult['unchanged'] = []
  const skipped: ApplyResult['skipped'] = []

  // Group by module so each config file is read and written once.
  const byModule = new Map<string, { field: ConfigField; value: string }[]>()

  for (const [key, value] of remote) {
    const decoded = decodeKey(key)
    if (!decoded) continue
    const field = fieldFor(decoded.module, decoded.field)
    if (!field) {
      skipped.push({ key, reason: `unknown or non-syncable field ${decoded.module}.${decoded.field}` })
      continue
    }
    const list = byModule.get(decoded.module) ?? []
    list.push({ field, value })
    byModule.set(decoded.module, list)
  }

  for (const [moduleName, entries] of byModule) {
    const existing = loadModuleConfig(moduleName)
    const next: ModuleConfigData = existing ? { ...existing } : { $schemaVersion: 1 }
    let configChanged = false

    for (const { field, value } of entries) {
      const row = { module: moduleName, field: field.key, secret: field.kind === 'secret' }
      if (field.kind === 'secret') {
        if (getSecret(moduleName, field.key) === value) {
          unchanged.push(row)
          continue
        }
        if (!dryRun) setSecret(moduleName, field.key, value)
      } else {
        const coerced = coerce(field, value)
        if (existing !== null && existing[field.key] === coerced) {
          unchanged.push(row)
          continue
        }
        next[field.key] = coerced
        configChanged = true
      }
      applied.push(row)
    }

    if (configChanged && !dryRun) saveModuleConfig(moduleName, next)
  }

  return { applied, unchanged, skipped }
}
