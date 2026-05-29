import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { existsSync, readFileSync } from 'node:fs'
import { consola } from 'consola'
import { emit } from '../core/output'
import { loadModuleConfig, saveModuleConfig, deleteModuleConfig } from '../core/config'
import { modules } from '../registry'
import type { ModuleConfigData } from '../core/config'

const exportArgs: ArgsDef = {
  out: { type: 'string', description: 'Output JSON path (default: stdout)' },
  json: { type: 'boolean', description: 'Emit JSON to stdout' },
}

const importArgs: ArgsDef = {
  in: { type: 'string', description: 'Input JSON path', required: true },
  replace: { type: 'boolean', description: 'Replace all existing configs (default: merge)' },
  json: { type: 'boolean', description: 'Emit JSON to stdout' },
}

interface ConfigExport {
  $schemaVersion: number
  modules: Record<string, ModuleConfigData>
}

function collectConfigs(): ConfigExport {
  const result: Record<string, ModuleConfigData> = {}
  for (const m of modules) {
    const cfg = loadModuleConfig(m.name)
    if (cfg) result[m.name] = cfg
  }
  return { $schemaVersion: 1, modules: result }
}

async function writeExport(outPath: string | undefined, json: boolean): Promise<void> {
  const data = collectConfigs()
  if (outPath) {
    const { writeFileSync, chmodSync } = await import('node:fs')
    writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
    chmodSync(outPath, 0o600)
    await emit({ ok: true, data: { path: outPath, modules: Object.keys(data.modules).length } }, { json })
  } else {
    // Always write to stdout when no --out, regardless of --json
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
    await emit({ ok: true }, { json })
  }
}

async function applyImport(inPath: string, replace: boolean): Promise<{ imported: number }> {
  const raw = JSON.parse(readFileSync(inPath, 'utf8')) as { $schemaVersion?: number; modules?: Record<string, ModuleConfigData> }
  const incoming = raw.modules ?? {}
  const existingModules = new Set(modules.map((m) => m.name))

  if (replace) {
    // Delete all existing configs not in the import
    for (const m of modules) {
      if (!(m.name in incoming)) deleteModuleConfig(m.name)
    }
  }

  let count = 0
  for (const [name, cfg] of Object.entries(incoming)) {
    if (!existingModules.has(name)) {
      consola.warn(`skipping unknown module: ${name}`)
      continue
    }
    saveModuleConfig(name, cfg)
    count++
  }
  return { imported: count }
}

export const configCmd: CommandDef = defineCommand({
  meta: { name: 'config', description: 'Export or import module configuration' },
  subCommands: {
    export: defineCommand({
      meta: { name: 'export', description: 'Write all module configs to a JSON file (no secrets)' },
      args: exportArgs,
      async run({ args }) {
        const raw = args as Record<string, unknown>
        const json = Boolean(raw.json)
        const out = raw.out ? String(raw.out) : undefined
        await writeExport(out, json)
      },
    }),
    import: defineCommand({
      meta: { name: 'import', description: 'Load module configs from a JSON file produced by `home config export`' },
      args: importArgs,
      async run({ args }) {
        const raw = args as Record<string, unknown>
        const json = Boolean(raw.json)
        const inPath = String(raw.in)
        const replace = Boolean(raw.replace)
        if (!existsSync(inPath)) {
          await emit(
            { ok: false, kind: 'user', message: `file not found: ${inPath}`, code: 'not_found' },
            { json },
          )
        }
        const result = await applyImport(inPath, replace)
        await emit({ ok: true, data: result }, { json })
      },
    }),
  },
})