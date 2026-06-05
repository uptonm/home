import type { ModuleManifest } from '../../core/types'
import { discover, readSonosConfig, summarizeGroups } from './client'
import { playersList, playersGet } from './commands/players'
import { groupsList, groupsGet } from './commands/groups'
import { play, pause, next, prev, nowPlaying } from './commands/playback'
import { volumeGet, volumeSet, mute } from './commands/volume'
import { queueList, queueClear, queueAdd } from './commands/queue'
import { playUri, favoritesList } from './commands/source'
import { favoritesPlay } from './commands/favorites'
import { notifyCmd } from './commands/notify'
import { spotifyAccountsList } from './commands/spotify-accounts'
import { validateCidr } from './scan'

export const manifest: ModuleManifest = {
  name: 'sonos',
  description: 'Discover and control Sonos players (playback, volume, queue, play-from-URI, one-shot notifications, now-playing)',
  whenToUse:
    'Use when the user asks to play, pause, skip, or change volume on Sonos speakers, queue tracks, play from a URI (Spotify, HTTP streams), play a one-shot audio file or URL as a notification (`home sonos notify`), or see what is currently playing. Discovery is SSDP multicast on the local network — no configuration required when the host shares a subnet with the speakers. When the speakers sit on a different VLAN/subnet (multicast cannot cross it), run `home sonos configure` and set the speaker subnet (e.g. `10.0.10.0/24`); discovery then scans it for one speaker and enumerates the household over unicast. `SONOS_SEED_HOST=<speaker-ip>` is a one-off env override of the same path. Do not use for non-Sonos audio (that is `home-assistant`) or other devices.',
  requiresConfig: false,
  configSchema: [
    {
      key: 'subnet',
      label: 'Speaker subnet (CIDR)',
      kind: 'string',
      help: 'CIDR of the VLAN your Sonos live on, e.g. 10.0.10.0/24. Leave blank to use SSDP multicast (works only when this host shares the speakers\' subnet).',
      validate: validateCidr,
    },
  ],
  commands: [
    playersList,
    playersGet,
    groupsList,
    groupsGet,
    nowPlaying,
    play,
    pause,
    next,
    prev,
    volumeGet,
    volumeSet,
    mute,
    queueList,
    queueClear,
    queueAdd,
    playUri,
    favoritesList,
    favoritesPlay,
    notifyCmd,
    spotifyAccountsList,
  ],
  async status(cfg) {
    try {
      const mgr = await discover(readSonosConfig(cfg))
      const groups = summarizeGroups(mgr.Devices)
      return { ok: true, data: { players: mgr.Devices.length, groups: groups.length, status: 'reachable' } }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
