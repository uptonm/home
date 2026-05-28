import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { consola } from 'consola'
import { runConfigure } from '../core/configure'
import { emit } from '../core/output'
import { modules } from '../registry'

const args: ArgsDef = {
  json: { type: 'boolean', description: 'Emit JSON to stdout' },
}

export const configureAllCmd: CommandDef = defineCommand({
  meta: { name: 'configure', description: 'Run configure for every registered module' },
  args,
  async run({ args }) {
    const raw = args as Record<string, unknown>
    const json = Boolean(raw.json)
    const results: { module: string; ok: boolean; error?: string }[] = []
    for (const manifest of modules) {
      consola.info(`\n— ${manifest.name} —`)
      try {
        await runConfigure(manifest)
        results.push({ module: manifest.name, ok: true })
      } catch (err) {
        results.push({ module: manifest.name, ok: false, error: (err as Error).message })
      }
    }
    emit({ ok: true, data: results }, { json })
  },
})
