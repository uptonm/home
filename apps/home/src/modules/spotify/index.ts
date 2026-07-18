import type { ModuleManifest } from '../../core/types'
import { getAccessToken, getCachedTokenExpiry, readSpotifyConfig } from './client'
import { searchCmd } from './commands/search'
import { albumGet, artistGet, playlistGet, trackGet } from './commands/get'
import { albumTracks, artistAlbums, artistTopTracks, playlistTracks } from './commands/children'
import { categoriesGet, categoriesList, newReleases } from './commands/browse'

export const manifest: ModuleManifest = {
  name: 'spotify',
  description: 'Search the Spotify catalog and emit Sonos-playable URIs (composes with `home sonos play-uri`)',
  whenToUse:
    'Use when the user wants to find a Spotify track, album, artist, or playlist by name. This module only resolves URIs — it does not play anything. For playback, hand the returned `uri` to `home sonos play-uri <room> <uri>` (or `home sonos queue add`). Do not use for non-Spotify catalogs.',
  configSchema: [
    {
      key: 'clientId',
      label: 'Spotify Client ID',
      kind: 'string',
      required: true,
      help: 'Create a free app at https://developer.spotify.com/dashboard',
    },
    {
      key: 'clientSecret',
      label: 'Spotify Client Secret',
      kind: 'secret',
      required: true,
      help: 'Same Spotify developer-app page — the "Client Secret" field',
    },
  ],
  commands: [
    searchCmd,
    trackGet,
    albumGet,
    artistGet,
    playlistGet,
    albumTracks,
    artistAlbums,
    artistTopTracks,
    playlistTracks,
    newReleases,
    categoriesList,
    categoriesGet,
  ],
  async status(cfg) {
    try {
      await getAccessToken(readSpotifyConfig(cfg))
      const expiresAt = getCachedTokenExpiry()
      const tokenExpiresIn = expiresAt !== null ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : null
      return { ok: true, data: { status: 'authenticated', tokenExpiresIn } }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
