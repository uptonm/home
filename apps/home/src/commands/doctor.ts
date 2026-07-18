import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { resolveModuleConfig } from '../core/citty'
import { emit } from '../core/output'
import { collectModuleStatuses, type ModuleStatusReport } from '../core/status'
import { modules } from '../registry'
import { HOME_VERSION } from '../core/version'
import { checkUpdate, type UpdateInfo } from '../core/update'

const args: ArgsDef = {
  json: { type: 'boolean', description: 'Emit JSON to stdout' },
}

interface DoctorReport {
  version: string
  telemetry: 'off (no-op)'
  modules: ModuleStatusReport[]
  update?: UpdateInfo
  updateError?: string
}

export const doctorCmd: CommandDef = defineCommand({
  meta: { name: 'doctor', description: 'Check status across modules and look for updates' },
  args,
  async run({ args }) {
    const raw = args as Record<string, unknown>
    const json = Boolean(raw.json)

    const [moduleStatus, update] = await Promise.all([
      collectModuleStatuses(modules, resolveModuleConfig),
      checkUpdate(),
    ])
    const report: DoctorReport = {
      version: HOME_VERSION,
      telemetry: 'off (no-op)',
      modules: moduleStatus.modules,
      ...('error' in update ? { updateError: update.error } : { update }),
    }
    await emit({ ok: true, data: report }, { json })
  },
})
