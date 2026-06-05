import type { CommandSpec } from '../../../core/types'
import { getDevice, listDevices, readUnifiConfig } from '../client'
import { integrationDeviceAction, integrationGetDeviceStats } from '../integration-client'

export const devicesList: CommandSpec = {
  path: ['devices', 'list'],
  description: 'List all adopted UniFi devices (APs, switches, gateway)',
  args: [],
  examples: [
    'home unifi devices list',
    "home unifi devices list --json | jq '.[] | select(.type==\"uap\")'",
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const data = await listDevices(cfg)
    return { ok: true, data }
  },
}

export const devicesGet: CommandSpec = {
  path: ['devices', 'get'],
  description: 'Fetch a single device by MAC address',
  args: [{ name: 'mac', kind: 'positional', description: 'Device MAC (with or without colons)', required: true }],
  examples: ['home unifi devices get 78:8a:20:11:22:33 --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const mac = String(ctx.args.mac ?? '').toLowerCase()
    if (!mac) return { ok: false, kind: 'user', message: 'mac is required', code: 'missing_arg' }
    const data = await getDevice(cfg, mac)
    if (!data) return { ok: false, kind: 'user', message: `no device with mac ${mac}`, code: 'not_found' }
    return { ok: true, data }
  },
}

export const devicesStats: CommandSpec = {
  path: ['devices', 'stats'],
  description: 'Get latest device statistics via Integration API (CPU, memory, uptime, temps)',
  args: [{ name: 'ref', kind: 'positional', description: 'Device MAC (resolved to integration ID)', required: true }],
  examples: ['home unifi devices stats 78:8a:20:11:22:33 --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.ref ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'ref is required', code: 'missing_arg' }
    // Resolve MAC → integration device id via private API
    const devices = (await listDevices(cfg)) as { mac: string; _id: string }[]
    const device = devices.find((d) => d.mac?.toLowerCase() === ref.toLowerCase().trim())
    if (!device) return { ok: false, kind: 'user', message: `no device matching ${JSON.stringify(ref)}`, code: 'not_found' }
    const stats = await integrationGetDeviceStats(cfg, device._id)
    if (!stats) return { ok: false, kind: 'user', message: `stats not available for ${ref}`, code: 'not_found' }
    return { ok: true, data: stats }
  },
}
