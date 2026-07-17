import type { CommandSpec } from '../../../core/types'
import { createTransport, pbQuote, readBeszelConfig, type RawRecord } from '../client'
import { normalizeSmartDevice } from '../adapter'
import { resolveSystemArg } from './shared'

/** Bound on the devices fetch — a host with more SMART devices than this is not our problem yet. */
const SMART_DEVICES_LIMIT = 100

export const smartGetCmd: CommandSpec = {
  path: ['smart', 'get'],
  effect: 'read',
  description: 'SMART/eMMC disk health for a system: state, temperature, power-on hours, cycles, bounded raw attributes',
  args: [{ name: 'system', kind: 'positional', description: 'System id or exact name', required: true }],
  examples: ['home beszel smart get boris --json'],
  async run(ctx) {
    const t = createTransport(readBeszelConfig(ctx.config))
    const picked = await resolveSystemArg(ctx, t)
    if (!picked.ok) return picked.error
    let raw: RawRecord[]
    try {
      raw = await t.list('smart_devices', SMART_DEVICES_LIMIT, {
        filter: `system=${pbQuote(picked.system.id)}`,
        sort: 'name',
      })
    } catch (err) {
      // Hubs predating SMART support have no smart_devices collection at all —
      // PocketBase 404s the list. Absence of data is a finding, not a failure.
      if ((err as { code?: string }).code === 'beszel_http_404') {
        return {
          ok: true,
          data: { system: picked.system, devices: [], note: 'this hub has no smart_devices collection — no SMART data' },
        }
      }
      throw err
    }
    const devices = raw.map(normalizeSmartDevice)
    if (devices.length === 0) {
      return {
        ok: true,
        data: { system: picked.system, devices, note: `no SMART devices reported for ${picked.system.name}` },
      }
    }
    return { ok: true, data: { system: picked.system, devices } }
  },
}
