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
  /**
   * What running this command does to the world. `read` observes only;
   * `write` mutates state that is recoverable or acceptable to perturb;
   * `destructive` is irreversible or outward-facing without a containable
   * target — the e2e harness refuses to execute it.
   */
  effect: 'read' | 'write' | 'destructive'
  description: string
  args: ArgSpec[]
  examples: string[]
  run: (ctx: RunContext) => Promise<RunResult>
}

export type ConfigFieldKind = 'url' | 'string' | 'secret' | 'enum' | 'boolean'

export type DynamicEnumOption = string | { value: string; label?: string; hint?: string }

export type ConfigFieldDefault = string | boolean | (() => string | boolean)

export interface ConfigField {
  key: string
  label: string
  kind: ConfigFieldKind
  required?: boolean
  /** Default value, or a thunk evaluated at prompt time (e.g. detect default gateway). */
  default?: ConfigFieldDefault
  enum?: readonly string[]
  /** Resolve options at prompt time from values gathered so far. */
  dynamicEnum?: (partial: ModuleConfig) => Promise<readonly DynamicEnumOption[]>
  help?: string
  validate?: (v: string) => string | null
  probe?: (cfg: ModuleConfig) => Promise<string | null>
  /**
   * Whether this field's value is meaningful only on the host that set it, and
   * so must never be shared between machines (`home vercel env push/pull`).
   * Set for anything describing the host's own vantage point rather than the
   * service being reached — e.g. sonos `subnet`, which depends on which VLAN
   * *this* machine sits on.
   */
  hostLocal?: boolean
}

export interface ModuleManifest {
  name: string
  description: string
  whenToUse: string
  configSchema: ConfigField[]
  /**
   * Whether commands hard-error until the module is configured. Defaults to
   * `configSchema.length > 0` (any schema ⇒ config mandatory). Set `false` for
   * a module whose config is purely optional — it has fields worth offering via
   * `configure`, but every command still works unconfigured (e.g. sonos:
   * SSDP multicast needs no config; the subnet field is only for split-VLAN).
   */
  requiresConfig?: boolean
  commands: CommandSpec[]
  /** Async readiness probe used by both module-level and root-level status. */
  status(cfg: ModuleConfig): Promise<RunResult>
}
