import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { consola } from 'consola'
import { emit } from '../core/output'
import { exportAll, getSecret, importAll, type SecretRow } from '../core/secrets'
import { modules } from '../registry'

const exportArgs: ArgsDef = {
  out: { type: 'string', description: 'Output JSON path', required: true },
  json: { type: 'boolean', description: 'Emit JSON to stdout' },
}

const importArgs: ArgsDef = {
  in: { type: 'string', description: 'Input JSON path', required: true },
  json: { type: 'boolean', description: 'Emit JSON to stdout' },
}

function collectSecretRows(): SecretRow[] {
  const direct = exportAll(modules.map((m) => m.name))
  if (direct.length) return direct
  // Keyring backend: walk manifests for declared secret keys, look them up.
  const out: SecretRow[] = []
  for (const m of modules) {
    for (const field of m.configSchema) {
      if (field.kind !== 'secret') continue
      const v = getSecret(m.name, field.key)
      if (v !== null) out.push({ module: m.name, key: field.key, value: v })
    }
  }
  return out
}

export const secretsCmd: CommandDef = defineCommand({
  meta: { name: 'secrets', description: 'Export or import stored secrets' },
  subCommands: {
    export: defineCommand({
      meta: { name: 'export', description: 'Write all stored secrets to a JSON file (plaintext)' },
      args: exportArgs,
      async run({ args }) {
        const raw = args as Record<string, unknown>
        const json = Boolean(raw.json)
        const out = String(raw.out)
        consola.warn('output is plaintext — encrypt before transport')
        const rows = collectSecretRows()
        const payload = { $schemaVersion: 1, entries: rows }
        writeFileSync(out, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 })
        chmodSync(out, 0o600)
        await emit({ ok: true, data: { path: out, count: rows.length } }, { json })
      },
    }),
    import: defineCommand({
      meta: { name: 'import', description: 'Load secrets from a JSON file produced by `home secrets export`' },
      args: importArgs,
      async run({ args }) {
        const raw = args as Record<string, unknown>
        const json = Boolean(raw.json)
        const inPath = String(raw.in)
        if (!existsSync(inPath)) {
          await emit(
            { ok: false, kind: 'user', message: `file not found: ${inPath}`, code: 'not_found' },
            { json },
          )
        }
        const data = JSON.parse(readFileSync(inPath, 'utf8')) as { entries?: SecretRow[] }
        const rows = data.entries ?? []
        importAll(rows)
        await emit({ ok: true, data: { imported: rows.length } }, { json })
      },
    }),
  },
})
