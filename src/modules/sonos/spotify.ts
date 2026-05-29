import type SonosDevice from '@svrooij/sonos/lib/sonos-device'

/**
 * Translate a Spotify share URL (https://open.spotify.com/track/<id>?si=...) or
 * spotify-app URI (spotify:track:<id>) into the canonical `spotify:type:id`
 * form. Returns the input unchanged if it doesn't look like Spotify.
 */
export function translateSpotifyInput(input: string): string {
  const m = input.match(/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|artist)\/([a-zA-Z0-9]+)(?:\?[^#]*)?/i)
  if (m) {
    const kind = m[1]!.toLowerCase()
    const id = m[2]!
    if (kind === 'artist') return `spotify:artistTopTracks:${id}`
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
 * Discover the household's Spotify Sonos-side identifiers.
 *
 * Sonos encodes a household's subscribed services as `ServiceType = sid*256 + sn`
 * entries in `MusicServicesService.ListAvailableServices().AvailableServiceTypeList`.
 * We:
 *   1. Look up Spotify's catalog Id (`sid`) via ListAndParseAvailableServices,
 *      so we stay correct when Sonos renumbers services (e.g. legacy 9 → 12).
 *   2. Scan the household's subscribed-services list for a ServiceType in
 *      Spotify's `[sid*256, sid*256+255]` window. The remainder is `sn`.
 *
 * Returns null if Spotify isn't in the catalog or the household has no Spotify
 * subscription.
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

/**
 * True only for `spotify:track:<id>` URIs. All other Spotify URI shapes
 * (album / playlist / artistTopTracks / user / artistRadio) are containers
 * that require Sonos to call back into the Spotify SMAPI service to expand;
 * that callback fails on this household with UPnP 402 / 800 regardless of
 * sid/sn/metadata permutations we tried. Sonos commands use this to fail
 * fast with a clean error instead of dumping a raw UPnP fault.
 */
export function isPlayableSpotifyUri(uri: string): boolean {
  return /^spotify:track:[A-Za-z0-9]+$/.test(uri)
}

/**
 * Build the Sonos transport URI for a canonical `spotify:type:id` reference.
 * The metadata payload that should accompany this is just an empty string —
 * with valid sid/sn, Sonos fetches the real DIDL-Lite from SMAPI on its own,
 * and any metadata we'd generate ourselves (the library's hardcoded sid=9 /
 * region 2311 / Svc2311 CdUdn) trips UPnP 402 (Invalid args) on modern
 * firmware. Returns null if `spotifyUri` isn't a recognized spotify URI.
 */
export function buildSpotifyTransportUri(spotifyUri: string, account: SpotifyAccount): string | null {
  if (!spotifyUri.startsWith('spotify:')) return null
  const enc = spotifyUri.replace(/:/g, '%3a')
  const { sid, sn } = account

  const kind = spotifyUri.split(':')[1]
  switch (kind) {
    case 'track':
      return `x-sonos-spotify:${spotifyUri}?sid=${sid}&flags=8224&sn=${sn}`
    case 'album':
      return `x-rincon-cpcontainer:1004206c${enc}?sid=${sid}&flags=8300&sn=${sn}`
    case 'playlist':
      return `x-rincon-cpcontainer:1006206c${enc}?sid=${sid}&flags=8300&sn=${sn}`
    case 'user':
      return `x-rincon-cpcontainer:10062a6c${enc}?sid=${sid}&flags=10860&sn=${sn}`
    case 'artistTopTracks':
      return `x-rincon-cpcontainer:100e206c${enc}?sid=${sid}&flags=8300&sn=${sn}`
    case 'artistRadio':
      return `x-sonosapi-radio:${enc}?sid=${sid}&flags=8300&sn=${sn}`
    default:
      return null
  }
}
