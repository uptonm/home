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
 * Enumerate every subscribed Spotify account on this household.
 *
 * Sonos encodes a household's subscribed services as `ServiceType = sid*256 + sn`
 * entries in `MusicServicesService.ListAvailableServices().AvailableServiceTypeList`.
 * Each entry within Spotify's `[sid*256, sid*256+255]` window is a separate
 * subscribed account; households can have up to ~4. We:
 *   1. Look up Spotify's catalog Id (`sid`) via ListAndParseAvailableServices,
 *      so we stay correct when Sonos renumbers services (e.g. legacy 9 → 12).
 *   2. Scan the household's subscribed-services list for ServiceTypes inside
 *      Spotify's window. Each remainder is one account's `sn`.
 *
 * Returns `[]` if Spotify isn't in the catalog or the household has no
 * Spotify subscription at all. For single-account households this returns a
 * one-element array, which is the common path — caller can `[0]` it and
 * carry on.
 */
export async function listSpotifyAccounts(device: SonosDevice): Promise<SpotifyAccount[]> {
  const services = await device.MusicServicesService.ListAndParseAvailableServices()
  const spotify = services.find((s) => s.Name === 'Spotify')
  if (!spotify) return []
  const sid = spotify.Id
  const raw = await device.MusicServicesService.ListAvailableServices()
  const subscribed = String(raw.AvailableServiceTypeList ?? '')
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n))
  const matches = subscribed.filter((t) => t >= sid * 256 && t < (sid + 1) * 256)
  return matches.map((t) => ({ sid, sn: t - sid * 256 }))
}

/**
 * Pick a single Spotify account for use by play-uri / queue add.
 *
 *   - `snOverride !== undefined` → use that sn (validated against discovered
 *     accounts); if it doesn't match, returns `{ kind: 'sn_not_subscribed' }`
 *   - exactly one account → use it (common path; behavior unchanged from
 *     the original single-account implementation)
 *   - zero accounts → `{ kind: 'not_subscribed' }`
 *   - multiple accounts, no override → `{ kind: 'ambiguous', candidates }`
 *     so the command can return a clear error telling the user to pass
 *     `--sn <N>`
 */
export type SpotifyAccountSelection =
  | { kind: 'ok'; account: SpotifyAccount }
  | { kind: 'not_subscribed' }
  | { kind: 'sn_not_subscribed'; requested: number; available: SpotifyAccount[] }
  | { kind: 'ambiguous'; candidates: SpotifyAccount[] }

export async function selectSpotifyAccount(device: SonosDevice, snOverride: number | undefined): Promise<SpotifyAccountSelection> {
  const accounts = await listSpotifyAccounts(device)
  if (accounts.length === 0) return { kind: 'not_subscribed' }
  if (snOverride !== undefined) {
    const hit = accounts.find((a) => a.sn === snOverride)
    if (hit) return { kind: 'ok', account: hit }
    return { kind: 'sn_not_subscribed', requested: snOverride, available: accounts }
  }
  if (accounts.length === 1) return { kind: 'ok', account: accounts[0]! }
  return { kind: 'ambiguous', candidates: accounts }
}

/**
 * Back-compat shim — returns the first subscribed Spotify account or null.
 * Existing call sites in `sonos/commands/{source,queue}.ts` were migrated to
 * `selectSpotifyAccount` so they can surface the multi-account-ambiguous
 * case as a clean user error; this stays exported because the `discoverSpotifyAccount`
 * symbol is part of the module's public surface and removing it would be a
 * larger break than the value of the cleanup.
 */
export async function discoverSpotifyAccount(device: SonosDevice): Promise<SpotifyAccount | null> {
  const accounts = await listSpotifyAccounts(device)
  return accounts[0] ?? null
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
