import type { CommandSpec } from '../../../core/types'
import { getDevice, listDevices, powerCyclePort, readUnifiConfig } from '../client'

export const devicesPoeCycle: CommandSpec = {
  path: ['devices', 'poe-cycle'],
  description: 'Power-cycle a switch port (PoE) by device name/MAC and port number',
  args: [
    { name: 'device', kind: 'positional', description: 'Switch name or MAC', required: true },
    { name: 'port', kind: 'string', description: 'Port number (1-based)', required: true },
  ],
  examples: [
    'home unifi devices poe-cycle "US-8-60W" --port 4',
    'home unifi devices poe-cycle aa:bb:cc:dd:ee:ff --port 1',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.device ?? '').toLowerCase()
    if (!ref) return { ok: false, kind: 'user' as const, message: 'device is required', code: 'missing_arg' }

    const portNum = Number(ctx.args.port)
    if (Number.isNaN(portNum) || portNum < 1) {
      return { ok: false, kind: 'user' as const, message: 'port must be a positive number', code: 'invalid_arg' }
    }

    // Resolve device
    const devices = (await listDevices(cfg)) as Array<{
      mac: string; name?: string; model?: string; type?: string
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

    const result = await powerCyclePort(cfg, device.mac, portNum)
    return {
      ok: true as const,
      data: { device: device.name || device.mac, port: portNum, result },
    }
  },
}