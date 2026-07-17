import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { paths } from './paths'
import { SystemError } from './errors'

export const CURRENT_GLOBAL_SCHEMA = 1
export const CURRENT_MODULE_SCHEMA = 1

export type SecretsBackend = 'keyring' | 'file'

export interface GlobalConfig {
  $schemaVersion: number
  secretsBackend?: SecretsBackend
  defaultOutput?: 'human' | 'json'
  logLevel?: 'error' | 'warn' | 'info' | 'debug'
  /** Set to false to silence the "newer version available" preflight banner. */
  updateCheck?: boolean
}

export type ModuleConfigData = {
  $schemaVersion: number
} & Record<string, string | number | boolean | undefined>

const DEFAULT_GLOBAL: GlobalConfig = {
  $schemaVersion: CURRENT_GLOBAL_SCHEMA,
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (err) {
    throw new SystemError(`failed to parse ${path}: ${(err as Error).message}`, 'config_parse')
  }
}

function writeJsonAtomic(path: string, data: unknown, mode = 0o644): void {
  ensureDir(dirname(path))
  const partial = `${path}.partial`
  writeFileSync(partial, JSON.stringify(data, null, 2) + '\n', { mode })
  renameSync(partial, path)
}

function migrateGlobal(cfg: GlobalConfig): GlobalConfig {
  return cfg
}

function migrateModule(cfg: ModuleConfigData): ModuleConfigData {
  return cfg
}

export function ensureConfigDirs(): void {
  ensureDir(paths.configRoot)
  ensureDir(paths.modulesDir)
}

export function loadGlobalConfig(): GlobalConfig {
  const raw = readJson<GlobalConfig>(paths.globalConfig)
  if (!raw) return { ...DEFAULT_GLOBAL }
  return migrateGlobal(raw)
}

export function saveGlobalConfig(cfg: GlobalConfig): void {
  const out: GlobalConfig = { ...cfg, $schemaVersion: CURRENT_GLOBAL_SCHEMA }
  writeJsonAtomic(paths.globalConfig, out)
}

export function loadModuleConfig(name: string): ModuleConfigData | null {
  const raw = readJson<ModuleConfigData>(paths.moduleConfig(name))
  if (!raw) return null
  return migrateModule(raw)
}

export function saveModuleConfig(name: string, cfg: ModuleConfigData): void {
  const out: ModuleConfigData = { ...cfg, $schemaVersion: CURRENT_MODULE_SCHEMA }
  writeJsonAtomic(paths.moduleConfig(name), out, 0o600)
}

export function deleteModuleConfig(name: string): void {
  const path = paths.moduleConfig(name)
  if (existsSync(path)) {
    const fs = require('node:fs') as typeof import('node:fs')
    fs.unlinkSync(path)
  }
}
