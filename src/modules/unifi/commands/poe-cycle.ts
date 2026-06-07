import type { CommandSpec } from '../../../core/types'
import { listDevices, powerCyclePort, readUnifiConfig } from '../client'
import { integrationPortAction, withSource } from '../integration-client'

export const devicesPoeCycle: CommandSpec = {
  path: ['devices', 'poe-cycle'],
  description: 'Power-cycle a switch port (PoE) by device name/MAC and port number (write — requires --yes)',
  args: [
    { name: 'device', kind: 'positional', description: 'Switch name or MAC', required: true },
    { name: 'port', kind: 'string', description: 'Port number (1-based)', required: true },
    { name: 'yes', kind: 'boolean', description: 'Confirm the power-cycle — this briefly drops the port' },
  ],
  examples: [
    'home unifi devices poe-cycle "US-8-60W" --port 4 --yes',
    'home unifi devices poe-cycle aa:bb:cc:dd:ee:ff --port 1 --yes',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.device ?? '').toLowerCase()
    if (!ref) return { ok: false, kind: 'user' as const, message: 'device is required', code: 'missing_arg' }

    const portNum = Number(ctx.args.port)
    if (Number.isNaN(portNum) || portNum < 1) {
      return { ok: false, kind: 'user' as const, message: 'port must be a positive number', code: 'invalid_arg' }
    }

    if (!ctx.args.yes) {
      return {
        ok: false,
        kind: 'user' as const,
        message: `refusing to power-cycle port ${portNum} on "${ctx.args.device}" without confirmation — re-run with --yes`,
        code: 'confirmation_required',
      }
    }

    // Resolve device
    const devices = (await listDevices(cfg)) as Array<{
      _id: string; mac: string; name?: string; model?: string; type?: string
    }>
    const device = devices.find(
      (d) =>
        d.mac?.toLowerCase() === ref ||
        d.name?.toLowerCase() === ref,
    )

    if (!device) {
      return {
        ok: false,
        kind: 'user' as const,
        message: `no switch matching "${ctx.args.device}" found`,
        code: 'not_found',
      }
    }

    // Confirm it's a switch
    if (device.type !== 'usw') {
      return {
        ok: false,
        kind: 'user' as const,
        message: `${device.name || device.mac} is a ${device.type ?? 'device'}, not a switch`,
        code: 'not_supported',
      }
    }

    // Prefer the private cmd/devmgr endpoint, fall back to the Integration API
    // POWER_CYCLE action on 401/403/404 (or use it outright when source=integration).
    const result = await withSource(
      cfg,
      () => powerCyclePort(cfg, device.mac, portNum),
      () => integrationPortAction(cfg, device._id, portNum, 'POWER_CYCLE'),
    )
    return {
      ok: true as const,
      data: { device: device.name || device.mac, port: portNum, result },
    }
  },
}
