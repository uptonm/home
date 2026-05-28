import type { ConsolaInstance } from 'consola'

export type ArgKind = 'positional' | 'string' | 'boolean' | 'number'

export interface ArgSpec {
  name: string
  kind: ArgKind
  description: string
  required?: boolean
  default?: string | number | boolean
  enum?: readonly string[]
}

export type ModuleConfig = Record<string, string | number | boolean | undefined>

export interface RunContext {
  args: Record<string, string | number | boolean | undefined>
  json: boolean
  quiet: boolean
  verbose: boolean
  log: ConsolaInstance
  config: ModuleConfig
}

export type RunResult =
  | { ok: true; data?: unknown }
  | { ok: false; kind: 'user' | 'system' | 'config'; message: string; code?: string }

export interface CommandSpec {
  path: string[]
  description: string
  args: ArgSpec[]
  examples: string[]
  run: (ctx: RunContext) => Promise<RunResult>
}

export type ConfigFieldKind = 'url' | 'string' | 'secret' | 'enum' | 'boolean'

export interface ConfigField {
  key: string
  label: string
  kind: ConfigFieldKind
  required?: boolean
  default?: string | boolean
  enum?: readonly string[]
  help?: string
  validate?: (v: string) => string | null
  probe?: (cfg: ModuleConfig) => Promise<string | null>
}

export interface ModuleManifest {
  name: string
  description: string
  whenToUse: string
  configSchema: ConfigField[]
  commands: CommandSpec[]
  status: (cfg: ModuleConfig) => Promise<RunResult>
}
