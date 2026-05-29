import type { ModuleManifest } from '../../core/types'
import { discover, readSonosConfig, summarizeGroups } from './client'
import { playersList } from './commands/players'
import { groupsList } from './commands/groups'
import { play, pause, next, prev, nowPlaying } from './commands/playback'
import { volumeGet, volumeSet, mute } from './commands/volume'
import { queueList, queueClear, queueAdd } from './commands/queue'
import { playUri, favoritesList } from './commands/source'
import { notifyCmd } from './commands/notify'

export const manifest: ModuleManifest = {
  name: 'sonos',
  description: 'Discover and control Sonos players (playback, volume, queue, play-from-URI, one-shot notifications, now-playing)',
  whenToUse:
    'Use when the user asks to play, pause, skip, or change volume on Sonos speakers, queue tracks, play from a URI (Spotify, HTTP streams), play a one-shot audio file or URL as a notification (`home sonos notify`), or see what is currently playing. Discovery is SSDP multicast on the local network — no configuration required. Do not use for non-Sonos audio (that is `home-assistant`) or other devices.',
  configSchema: [],
  commands: [
    playersList,
    groupsList,
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
    notifyCmd,
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
