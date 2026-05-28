import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { createConsola } from 'consola'
import type { ArgSpec, CommandSpec, ModuleConfig, ModuleManifest, RunContext, RunResult } from './types'
import { loadModuleConfig } from './config'
import { getSecret } from './secrets'
import { runConfigure } from './configure'
import { writeSkill } from './skill'
import { emit } from './output'

const globalFlags: ArgsDef = {
  json: { type: 'boolean', description: 'Emit JSON to stdout (silent otherwise)' },
  quiet: { type: 'boolean', description: 'Suppress non-error output' },
  verbose: { type: 'boolean', description: 'Verbose debug output' },
}

function argsToCitty(args: ArgSpec[]): ArgsDef {
  const out: ArgsDef = {}
  for (const a of args) {
    const spec: Record<string, unknown> = {
      type: a.kind,
      description: a.description,
    }
    if (a.required !== undefined) spec.required = a.required
    if (a.default !== undefined) spec.default = a.default
    if (a.enum !== undefined) spec.options = a.enum
    out[a.name] = spec as ArgsDef[string]
  }
  return out
}

function pickRunArgs(spec: CommandSpec, raw: Record<string, unknown>): RunContext['args'] {
  const out: RunContext['args'] = {}
  for (const a of spec.args) {
    const v = raw[a.name]
    if (v !== undefined) out[a.name] = v as string | number | boolean
  }
  return out
}

function ctxFromArgs(raw: Record<string, unknown>): Pick<RunContext, 'json' | 'quiet' | 'verbose' | 'log'> {
  const json = Boolean(raw.json)
  const quiet = Boolean(raw.quiet)
  const verbose = Boolean(raw.verbose)
  const log = createConsola({
    level: json || quiet ? 1 : verbose ? 4 : 3,
    stdout: process.stderr,
    stderr: process.stderr,
  })
  return { json, quiet, verbose, log }
}

export function resolveModuleConfig(manifest: ModuleManifest): ModuleConfig | null {
  const raw = loadModuleConfig(manifest.name)
  if (!raw) return null
  const { $schemaVersion: _drop, ...rest } = raw
  void _drop
  const out: ModuleConfig = { ...rest }
  for (const field of manifest.configSchema) {
    if (field.kind === 'secret') {
      const secret = getSecret(manifest.name, field.key)
      if (secret !== null) out[field.key] = secret
    }
  }
  return out
}

function makeUserLeaf(manifest: ModuleManifest, spec: CommandSpec): CommandDef {
  const requiresConfig = manifest.configSchema.length > 0
  return defineCommand({
    meta: {
      name: spec.path[spec.path.length - 1]!,
      description: spec.description,
    },
    args: { ...argsToCitty(spec.args), ...globalFlags },
    async run({ args }) {
      const raw = args as Record<string, unknown>
      const env = ctxFromArgs(raw)
      const config = resolveModuleConfig(manifest)
      if (!config && requiresConfig) {
        emit(
          {
            ok: false,
            kind: 'config',
            message: `module "${manifest.name}" is not configured — run \`home ${manifest.name} configure\``,
            code: 'not_configured',
          },
          { json: env.json },
        )
      }
      const ctx: RunContext = {
        ...env,
        args: pickRunArgs(spec, raw),
        config: config ?? {},
      }
      const result = await spec.run(ctx)
      emit(result, { json: env.json })
    },
  })
}

function makeConfigureCommand(manifest: ModuleManifest): CommandDef {
  const args: ArgsDef = {
    rotate: { type: 'boolean', description: 'Re-prompt secrets only' },
    force: { type: 'boolean', description: 'Re-prompt every field, ignore existing values' },
    ...globalFlags,
  }
  return defineCommand({
    meta: { name: 'configure', description: `Configure ${manifest.name} (interactive)` },
    args,
    async run({ args }) {
      const raw = args as Record<string, unknown>
      const env = ctxFromArgs(raw)
      try {
        await runConfigure(manifest, { rotate: Boolean(raw.rotate), force: Boolean(raw.force) })
        emit({ ok: true, data: `${manifest.name}: configured` }, { json: env.json })
      } catch (err) {
        emit(
          {
            ok: false,
            kind: 'user',
            message: (err as Error).message,
            code: (err as { code?: string }).code ?? 'configure_failed',
          },
          { json: env.json },
        )
      }
    },
  })
}

function makeStatusCommand(manifest: ModuleManifest): CommandDef {
  const requiresConfig = manifest.configSchema.length > 0
  return defineCommand({
    meta: { name: 'status', description: `Check ${manifest.name} connectivity` },
    args: { ...globalFlags },
    async run({ args }) {
      const raw = args as Record<string, unknown>
      const env = ctxFromArgs(raw)
      const config = resolveModuleConfig(manifest)
      if (!config && requiresConfig) {
        emit(
          {
            ok: false,
            kind: 'config',
            message: `${manifest.name}: not configured`,
            code: 'not_configured',
          },
          { json: env.json },
        )
      }
      try {
        const result = await manifest.status(config ?? {})
        emit(result, { json: env.json })
      } catch (err) {
        emit(
          { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' },
          { json: env.json },
        )
      }
    },
  })
}

function makeSkillCommand(manifest: ModuleManifest): CommandDef {
  return defineCommand({
    meta: { name: 'skill', description: `Regenerate the home-${manifest.name} Claude skill` },
    args: { ...globalFlags },
    async run({ args }) {
      const raw = args as Record<string, unknown>
      const env = ctxFromArgs(raw)
      const path = writeSkill(manifest)
      emit({ ok: true, data: { path } }, { json: env.json })
    },
  })
}

export function buildCommandTree(manifest: ModuleManifest): CommandDef {
  const leafByName: Record<string, CommandSpec> = {}
  const groups = new Map<string, CommandSpec[]>()

  for (const cmd of manifest.commands) {
    if (cmd.path.length === 1) {
      leafByName[cmd.path[0]!] = cmd
    } else {
      const head = cmd.path[0]!
      if (!groups.has(head)) groups.set(head, [])
      groups.get(head)!.push(cmd)
    }
  }

  const subCommands: Record<string, CommandDef> = {
    configure: makeConfigureCommand(manifest),
    status: makeStatusCommand(manifest),
    skill: makeSkillCommand(manifest),
  }

  for (const [name, spec] of Object.entries(leafByName)) {
    subCommands[name] = makeUserLeaf(manifest, spec)
  }

  for (const [groupName, specs] of groups) {
    const inner: Record<string, CommandDef> = {}
    for (const spec of specs) {
      const tail: CommandSpec = { ...spec, path: spec.path.slice(1) }
      inner[tail.path[tail.path.length - 1]!] = makeUserLeaf(manifest, spec)
    }
    subCommands[groupName] = defineCommand({
      meta: { name: groupName, description: `${groupName} commands` },
      subCommands: inner,
    })
  }

  return defineCommand({
    meta: {
      name: manifest.name,
      description: manifest.description,
    },
    subCommands,
  })
}
