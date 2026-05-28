import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { emit } from '../core/output'
import { resolveModuleConfig } from '../core/citty'
import { request } from '../core/http'
import { modules } from '../registry'
import { HOME_VERSION } from '../core/version'

const args: ArgsDef = {
  json: { type: 'boolean', description: 'Emit JSON to stdout' },
}

const RELEASE_URL = 'https://api.github.com/repos/uptonm/home/releases/latest'

interface ModuleReport {
  module: string
  configured: boolean
  status: 'ok' | 'error' | 'not_configured'
  message?: string
}

interface DoctorReport {
  version: string
  telemetry: 'off (no-op)'
  modules: ModuleReport[]
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

    const moduleReports: ModuleReport[] = []
    for (const manifest of modules) {
      const cfg = resolveModuleConfig(manifest)
      if (!cfg) {
        moduleReports.push({ module: manifest.name, configured: false, status: 'not_configured' })
        continue
      }
      try {
        const result = await manifest.status(cfg)
        if (result.ok) {
          moduleReports.push({ module: manifest.name, configured: true, status: 'ok' })
        } else {
          moduleReports.push({ module: manifest.name, configured: true, status: 'error', message: result.message })
        }
      } catch (err) {
        moduleReports.push({
          module: manifest.name,
          configured: true,
          status: 'error',
          message: (err as Error).message,
        })
      }
    }

    const update = await checkUpdate()
    const report: DoctorReport = {
      version: HOME_VERSION,
      telemetry: 'off (no-op)',
      modules: moduleReports,
      ...('error' in update ? { updateError: update.error } : { update }),
    }
    await emit({ ok: true, data: report }, { json })
  },
})
