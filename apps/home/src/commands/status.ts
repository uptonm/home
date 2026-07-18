import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { resolveModuleConfig } from '../core/citty'
import { emit } from '../core/output'
import { collectModuleStatuses } from '../core/status'
import { renderStatus } from '../core/status-view'
import { modules } from '../registry'

const args: ArgsDef = {
  json: { type: 'boolean', description: 'Emit the full structured report as JSON' },
}

export const statusCmd: CommandDef = defineCommand({
  meta: { name: 'status', description: 'Check readiness across every module' },
  args,
  async run({ args }) {
    const raw = args as Record<string, unknown>
    const report = await collectModuleStatuses(modules, resolveModuleConfig)
    if (raw.json) {
      await emit({ ok: true, data: report }, { json: true })
      return
    }
    const color = process.stdout.isTTY === true && !process.env.NO_COLOR
    await emit({ ok: true, data: renderStatus(report, { color }) }, { json: false })
  },
})
