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

/** Exported for tests: the migration-inventory behavior is a review guarantee. */
export function collectSecretRows(): SecretRow[] {
  // Read every declared secret first: on the keyring backend that pulls any
  // pre-consolidation entry into the single item. Without this pass a partly
  // migrated install would export only what had already been consolidated.
  // Program-managed secrets (e.g. gdrive/gmail refreshToken, written by `auth
  // login` rather than configure) are declared in their module's schema
  // precisely so this inventory can see them.
  for (const m of modules) {
    for (const field of m.configSchema) {
      if (field.kind === 'secret') getSecret(m.name, field.key)
    }
  }
  return exportAll()
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
