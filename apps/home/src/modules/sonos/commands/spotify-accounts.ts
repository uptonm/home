import type { CommandSpec } from '../../../core/types'
import { discover, readSonosConfig } from '../client'
import { listSpotifyAccounts } from '../spotify'

export const spotifyAccountsList: CommandSpec = {
  path: ['spotify-accounts', 'list'],
  effect: 'read',
  description: 'List every Spotify account subscribed on the Sonos household, with the `sn` you can pass to play-uri / queue add via `--sn`. This is a household-level query — any speaker reports the same answer, so no room argument is needed.',
  args: [],
  examples: [
    'home sonos spotify-accounts list',
    'home sonos spotify-accounts list --json | jq \'.accounts[] | .sn\'',
  ],
  async run(ctx) {
    const mgr = await discover(readSonosConfig(ctx.config))
    const device = mgr.Devices[0]
    if (!device) return { ok: false, kind: 'system', message: 'no Sonos devices discovered on the network', code: 'no_devices' }
    const accounts = await listSpotifyAccounts(device)
    return {
      ok: true,
      data: {
        count: accounts.length,
        accounts: accounts.map((a) => ({ sid: a.sid, sn: a.sn })),
      },
    }
  },
}
