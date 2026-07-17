import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { resolveModuleConfig } from '../core/citty'
import { emit } from '../core/output'
import { collectModuleStatuses } from '../core/status'
import { modules } from '../registry'

const args: ArgsDef = {
  json: { type: 'boolean', description: 'Emit JSON to stdout' },
}

export const statusCmd: CommandDef = defineCommand({
  meta: { name: 'status', description: 'Check readiness across every module' },
  args,
  async run({ args }) {
    const raw = args as Record<string, unknown>
    const report = await collectModuleStatuses(modules, resolveModuleConfig)
    await emit({ ok: true, data: report }, { json: Boolean(raw.json) })
  },
})
