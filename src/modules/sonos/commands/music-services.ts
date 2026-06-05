import type { CommandSpec } from '../../../core/types'
import { discover, readSonosConfig } from '../client'

export const musicServicesList: CommandSpec = {
  path: ['music-services', 'list'],
  description: 'List the streaming music services available on this Sonos household',
  args: [],
  examples: [
    'home sonos music-services list',
    'home sonos music-services list --json | jq \'.[] | .name\'',
  ],
  async run(ctx) {
    const mgr = await discover(readSonosConfig(ctx.config))
    const device = mgr.Devices[0]
    if (!device) return { ok: false, kind: 'system', message: 'no Sonos devices discovered', code: 'no_devices' }
    const services = await device.MusicServicesService.ListAndParseAvailableServices()
    const data = services
      .map((s) => ({ id: s.Id, name: s.Name, auth: s.Policy?.Auth, uri: s.SecureUri || s.Uri }))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    return { ok: true, data }
  },
}
