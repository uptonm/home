import type SonosDevice from '@svrooij/sonos/lib/sonos-device'

/**
 * Translate a Spotify share URL (https://open.spotify.com/track/<id>?si=...) or
 * spotify-app URI (spotify:track:<id>) into the canonical `spotify:type:id`
 * form that MetaDataHelper.GuessMetaDataAndTrackUri understands. Returns the
 * input unchanged if it doesn't look like Spotify.
 */
export function translateSpotifyInput(input: string): string {
  const m = input.match(/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|artist)\/([a-zA-Z0-9]+)(?:\?[^#]*)?/i)
  if (m) {
    const kind = m[1]!.toLowerCase()
    const id = m[2]!
    // Spotify share URLs for an artist map to the library's "artistTopTracks" pattern.
    if (kind === 'artist') return `spotify:artistTopTracks:${id}`
    return `spotify:${kind}:${id}`
  }
  return input
}

/**
 * The library hard-codes `sn=7` in Spotify cpcontainer / x-sonos-spotify URIs.
 * Different Sonos households have Spotify in different account slots — this
 * rewrites `sn=` to a discovered or user-supplied value. Also rewrites the
 * Spotify region in the CdUdn metadata when sn != 7.
 */
export function rewriteSpotifySession(trackUri: string, sn: number): string {
  return trackUri.replace(/(\?|&amp;|&)sn=\d+/g, `$1sn=${sn}`)
}

const SONOS_SPOTIFY_SERVICE_ID = 12

/**
 * Try to discover the household's Spotify subscription number (sn=) by
 * inspecting `ListAvailableServices`. Returns null if Spotify isn't a
 * recognized service on the household at all. Note: this returns the *catalog*
 * service Id, which is also the value most households use for `sn=`. A
 * household with the Sonos-native Spotify integration disabled (e.g. using
 * Spotify Connect only) will still see Spotify in this list but cpcontainer
 * URIs will fail at playback time with an auth error.
 */
export async function discoverSpotifySn(device: SonosDevice): Promise<number | null> {
  const services = await device.MusicServicesService.ListAndParseAvailableServices()
  const spotify = services.find((s) => s.Name === 'Spotify')
  return spotify ? spotify.Id : null
}
