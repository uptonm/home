import type { CommandSpec } from '../../../core/types'
import { controllerInfo, readUnifiConfig } from '../client'

interface RawSysinfo {
  name?: string
  hostname?: string
  ubnt_device_type?: string
  version?: string
  build?: string
  update_available?: boolean
  data_retention_days?: number
  timezone?: string
  uptime?: number
}

export const controllerInfoCmd: CommandSpec = {
  path: ['controller', 'info'],
  description: 'Controller version, build, update status, data retention, timezone',
  args: [],
  examples: ['home unifi controller info', 'home unifi controller info --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const sys = (await controllerInfo(cfg)) as RawSysinfo | null
    if (!sys) return { ok: false, kind: 'system', message: 'no sysinfo returned', code: 'empty' }
    const data = {
      host: sys.name ?? sys.hostname ?? '',
      model: sys.ubnt_device_type ?? '',
      version: sys.version ?? '',
      build: sys.build ?? '',
      update_available: sys.update_available ?? null,
      data_retention_days: sys.data_retention_days ?? null,
      timezone: sys.timezone ?? '',
      uptime_days: typeof sys.uptime === 'number' ? Math.round((sys.uptime / 86400) * 10) / 10 : null,
    }
    return { ok: true, data }
  },
}
