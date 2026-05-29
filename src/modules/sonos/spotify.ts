import type SonosDevice from '@svrooij/sonos/lib/sonos-device'

/**
 * Sonos transport-URI building blocks for Spotify, determined empirically.
 *
 * Provenance: every value below was proven against a real household running
 * firmware `Sonos/95.0-77060` (ZPS19 / Arc-era hardware) with Spotify
 * subscribed at `sid=12, sn=7`. The library (`@svrooij/sonos@2.5.0`) hardcodes
 * the legacy `sid=9` + ServiceType-2311 CdUdn, which trips UPnP 402 on this
 * firmware regardless of metadata permutations. The shapes below succeed when
 * paired with an *empty* metadata string — Sonos fetches the real DIDL-Lite
 * from SMAPI itself.
 *
 * If a future firmware update breaks playback, the regression test (in
 * `src/__tests__/sonos-spotify.test.ts`) covers what we *emit*, not what Sonos
 * *accepts* — the only way to detect the next break is a live test, which is
 * why these constants are colocated with the household and firmware they
 * worked against. Update both the values and the provenance line below as
 * other households / firmwares are validated.
 */

/** Sonos container-Object-ID prefix per Spotify URI kind (UPnP DIDL-Lite). */
const CPCONTAINER_PREFIX = {
  album: '1004206c',
  playlist: '1006206c',
  user: '10062a6c',
  artistTopTracks: '100e206c',
} as const

/**
 * Sonos URI `flags=` parameter per kind. The values come from observing the
 * official Sonos app's SOAP traffic on this household; they encode container
 * vs. single-item, browsability, and a few other internal bits.
 */
const FLAGS = {
  track: 8224,
  container: 8300,
  user: 10860,
  radio: 8300,
} as const

/**
 * Translate a Spotify share URL (https://open.spotify.com/track/<id>?si=...) or
 * spotify-app URI (spotify:track:<id>) into the canonical `spotify:type:id`
 * form. Returns the input unchanged if it doesn't look like Spotify.
 *
 * Artist URLs translate to `spotify:artist:<id>` (canonical) rather than
 * `spotify:artistTopTracks:<id>`; the latter is a Sonos-specific container
 * shape that the downstream guard rejects with `container_not_playable`
 * anyway. Producers (`home spotify search`) resolve artist matches to a
 * representative `spotify:track:<id>` before they reach this module.
 */
export function translateSpotifyInput(input: string): string {
  const m = input.match(/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|artist)\/([a-zA-Z0-9]+)(?:\?[^#]*)?/i)
  if (m) {
    const kind = m[1]!.toLowerCase()
    const id = m[2]!
    return `spotify:${kind}:${id}`
  }
  return input
}

export interface SpotifyAccount {
  /** Sonos catalog service Id for Spotify (currently 12). */
  sid: number
  /** Subscription number for this household's Spotify account. */
  sn: number
}

/**
 * Discover one of this household's subscribed Spotify accounts.
 *
 * Sonos encodes a household's subscribed services as `ServiceType = sid*256 + sn`
 * entries in `MusicServicesService.ListAvailableServices().AvailableServiceTypeList`.
 * We:
 *   1. Look up Spotify's catalog Id (`sid`) via ListAndParseAvailableServices,
 *      so we stay correct when Sonos renumbers services (e.g. legacy 9 → 12).
 *   2. Scan the household's subscribed-services list for a ServiceType in
 *      Spotify's `[sid*256, sid*256+255]` window. The remainder is `sn`.
 *
 * Households can have multiple Spotify subscribers registered — this returns
 * one of them (whichever appears first in the subscribed list). Per-command
 * `--sn` override is the existing escape hatch for explicit selection;
 * enumerating and choosing across multiple accounts is tracked separately.
 *
 * Returns null if Spotify isn't in the catalog or the household has no
 * Spotify subscription at all.
 */
export async function discoverSpotifyAccount(device: SonosDevice): Promise<SpotifyAccount | null> {
  const services = await device.MusicServicesService.ListAndParseAvailableServices()
  const spotify = services.find((s) => s.Name === 'Spotify')
  if (!spotify) return null
  const sid = spotify.Id
  const raw = await device.MusicServicesService.ListAvailableServices()
  const subscribed = String(raw.AvailableServiceTypeList ?? '')
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n))
  const match = subscribed.find((t) => t >= sid * 256 && t < (sid + 1) * 256)
  if (match === undefined) return null
  return { sid, sn: match - sid * 256 }
}

const SPOTIFY_TRACK_URI_RE = /^spotify:track:[A-Za-z0-9]{22}$/

/**
 * True only for `spotify:track:<id>` URIs where `<id>` is the canonical
 * 22-char base62 Spotify ID. All other Spotify URI shapes (album / playlist
 * / artistTopTracks / user / artistRadio / artist) are containers that
 * require Sonos to call back into the Spotify SMAPI service to expand; that
 * callback fails on this household with UPnP 402 / 800 regardless of
 * sid/sn/metadata permutations. Sonos commands use this to fail fast with a
 * clean error instead of dumping a raw UPnP fault.
 */
export function isPlayableSpotifyUri(uri: string): boolean {
  return SPOTIFY_TRACK_URI_RE.test(uri)
}

/**
 * Build the Sonos transport URI for a canonical `spotify:type:id` reference.
 * The metadata payload that should accompany this is just an empty string —
 * with valid sid/sn, Sonos fetches the real DIDL-Lite from SMAPI on its own,
 * and any metadata we'd generate ourselves trips UPnP 402 on modern firmware
 * (see the provenance block at top of file). Returns null if `spotifyUri`
 * isn't a recognized spotify URI shape.
 */
export function buildSpotifyTransportUri(spotifyUri: string, account: SpotifyAccount): string | null {
  if (!spotifyUri.startsWith('spotify:')) return null
  const enc = spotifyUri.replace(/:/g, '%3a')
  const { sid, sn } = account

  const kind = spotifyUri.split(':')[1]
  switch (kind) {
    case 'track':
      return `x-sonos-spotify:${spotifyUri}?sid=${sid}&flags=${FLAGS.track}&sn=${sn}`
    case 'album':
      return `x-rincon-cpcontainer:${CPCONTAINER_PREFIX.album}${enc}?sid=${sid}&flags=${FLAGS.container}&sn=${sn}`
    case 'playlist':
      return `x-rincon-cpcontainer:${CPCONTAINER_PREFIX.playlist}${enc}?sid=${sid}&flags=${FLAGS.container}&sn=${sn}`
    case 'user':
      return `x-rincon-cpcontainer:${CPCONTAINER_PREFIX.user}${enc}?sid=${sid}&flags=${FLAGS.user}&sn=${sn}`
    case 'artistTopTracks':
      return `x-rincon-cpcontainer:${CPCONTAINER_PREFIX.artistTopTracks}${enc}?sid=${sid}&flags=${FLAGS.container}&sn=${sn}`
    case 'artistRadio':
      return `x-sonosapi-radio:${enc}?sid=${sid}&flags=${FLAGS.radio}&sn=${sn}`
    default:
      return null
  }
}
