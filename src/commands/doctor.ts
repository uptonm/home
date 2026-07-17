import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { resolveModuleConfig } from '../core/citty'
import { emit } from '../core/output'
import { request } from '../core/http'
import { collectModuleStatuses, type ModuleStatusReport } from '../core/status'
import { modules } from '../registry'
import { HOME_VERSION } from '../core/version'

const args: ArgsDef = {
  json: { type: 'boolean', description: 'Emit JSON to stdout' },
}

const RELEASE_URL = 'https://api.github.com/repos/uptonm/home/releases/latest'

interface DoctorReport {
  version: string
  telemetry: 'off (no-op)'
  modules: ModuleStatusReport[]
  update?: { current: string; latest: string; outOfDate: boolean }
  updateError?: string
}

type UpdateInfo = { current: string; latest: string; outOfDate: boolean }

async function checkUpdate(): Promise<UpdateInfo | { error: string }> {
  try {
    const res = await request(RELEASE_URL, { headers: { 'User-Agent': 'home-cli' } }, { timeoutMs: 10_000, retries: 1 })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const body = (await res.json()) as { tag_name?: string }
    const latest = (body.tag_name ?? '').replace(/^v/, '') || 'unknown'
    return { current: HOME_VERSION, latest, outOfDate: latest !== HOME_VERSION && latest !== 'unknown' }
  } catch (err) {
    return { error: (err as Error).message }
  }
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
