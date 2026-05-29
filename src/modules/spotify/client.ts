import { requestJson } from '../../core/http'
import { SystemError } from '../../core/errors'
import type { ModuleConfig } from '../../core/types'

export interface SpotifyConfig {
  clientId: string
  clientSecret: string
}

export function readSpotifyConfig(cfg: ModuleConfig): SpotifyConfig {
  return {
    clientId: String(cfg.clientId ?? ''),
    clientSecret: String(cfg.clientSecret ?? ''),
  }
}

export const SPOTIFY_SEARCH_TYPES = ['track', 'album', 'artist', 'playlist'] as const
export type SpotifySearchType = (typeof SPOTIFY_SEARCH_TYPES)[number]

export interface TrackMatch {
  uri: string
  title: string
  artist: string
  album: string
  releaseDate?: string
  durationMs?: number
  explicit?: boolean
}

export interface AlbumMatch {
  uri: string
  title: string
  artist: string
  releaseDate?: string
  totalTracks?: number
  albumType?: string
}

export interface ArtistMatch {
  uri: string
  name: string
  genres: string[]
  popularity?: number
  followers?: number
}

export interface PlaylistMatch {
  uri: string
  title: string
  owner: string
  totalTracks?: number
  public?: boolean
}

export interface SpotifySearchResult {
  tracks: TrackMatch[]
  albums: AlbumMatch[]
  artists: ArtistMatch[]
  playlists: PlaylistMatch[]
}

export interface SearchOptions {
  query: string
  types: SpotifySearchType[]
  limit: number
  market: string
}

interface CachedToken {
  value: string
  expiresAt: number
}

let cachedToken: CachedToken | null = null
const TOKEN_REFRESH_MARGIN_MS = 60_000

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

export async function getAccessToken(cfg: SpotifyConfig): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return cachedToken.value
  }
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new SystemError('spotify clientId/clientSecret not configured', 'spotify_unconfigured')
  }
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')
  const res = await requestJson<TokenResponse>('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  cachedToken = {
    value: res.access_token,
    expiresAt: Date.now() + res.expires_in * 1000,
  }
  return cachedToken.value
}

/** Expiration timestamp of the cached token in ms since epoch, or null. */
export function getCachedTokenExpiry(): number | null {
  return cachedToken?.expiresAt ?? null
}

/** Drop the cached token so the next `getAccessToken` re-auths. */
export function resetTokenCache(): void {
  cachedToken = null
}

/**
 * Run a bearer-token-authed `requestJson` against the Spotify API. On a 401
 * (token revoked or rotated upstream), invalidate the cache and retry exactly
 * once with a fresh token before propagating the failure.
 */
export async function authedRequestJson<T>(cfg: SpotifyConfig, url: string, init: RequestInit = {}): Promise<T> {
  const withBearer = (token: string): RequestInit => ({
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  })
  const firstToken = await getAccessToken(cfg)
  try {
    return await requestJson<T>(url, withBearer(firstToken))
  } catch (err) {
    if (err instanceof SystemError && err.code === 'http_401') {
      resetTokenCache()
      const freshToken = await getAccessToken(cfg)
      return await requestJson<T>(url, withBearer(freshToken))
    }
    throw err
  }
}

export function buildSearchUrl(opts: SearchOptions): string {
  const params = new URLSearchParams({
    q: opts.query,
    type: opts.types.join(','),
    limit: String(opts.limit),
    market: opts.market,
  })
  return `https://api.spotify.com/v1/search?${params.toString()}`
}

interface RawArtist {
  id?: string
  name?: string
  genres?: string[]
  popularity?: number
  followers?: { total?: number }
}

interface RawAlbum {
  id?: string
  name?: string
  artists?: RawArtist[]
  release_date?: string
  total_tracks?: number
  album_type?: string
}

interface RawTrack {
  id?: string
  name?: string
  artists?: RawArtist[]
  album?: RawAlbum
  duration_ms?: number
  explicit?: boolean
}

interface RawPlaylist {
  id?: string
  name?: string
  owner?: { display_name?: string; id?: string }
  tracks?: { total?: number }
  public?: boolean
}

interface RawSearchResponse {
  tracks?: { items?: (RawTrack | null)[] }
  albums?: { items?: (RawAlbum | null)[] }
  artists?: { items?: (RawArtist | null)[] }
  playlists?: { items?: (RawPlaylist | null)[] }
}

function artistName(artists: RawArtist[] | undefined): string {
  if (!artists || artists.length === 0) return ''
  return artists.map((a) => a?.name ?? '').filter(Boolean).join(', ')
}

export function normalizeSearchResponse(raw: RawSearchResponse): SpotifySearchResult {
  const trackItems = (raw.tracks?.items ?? []).filter((t): t is RawTrack => !!t && !!t.id)
  const albumItems = (raw.albums?.items ?? []).filter((a): a is RawAlbum => !!a && !!a.id)
  const artistItems = (raw.artists?.items ?? []).filter((a): a is RawArtist => !!a && !!a.id)
  const playlistItems = (raw.playlists?.items ?? []).filter((p): p is RawPlaylist => !!p && !!p.id)

  const tracks: TrackMatch[] = trackItems.map((t) => ({
    uri: `spotify:track:${t.id}`,
    title: t.name ?? '',
    artist: artistName(t.artists),
    album: t.album?.name ?? '',
    releaseDate: t.album?.release_date,
    durationMs: t.duration_ms,
    explicit: t.explicit,
  }))

  const albums: AlbumMatch[] = albumItems.map((a) => ({
    uri: `spotify:album:${a.id}`,
    title: a.name ?? '',
    artist: artistName(a.artists),
    releaseDate: a.release_date,
    totalTracks: a.total_tracks,
    albumType: a.album_type,
  }))

  const artists: ArtistMatch[] = artistItems.map((a) => ({
    uri: `spotify:artist:${a.id}`,
    name: a.name ?? '',
    genres: a.genres ?? [],
    popularity: a.popularity,
    followers: a.followers?.total,
  }))

  const playlists: PlaylistMatch[] = playlistItems.map((p) => ({
    uri: `spotify:playlist:${p.id}`,
    title: p.name ?? '',
    owner: p.owner?.display_name ?? p.owner?.id ?? '',
    totalTracks: p.tracks?.total,
    public: p.public,
  }))

  return { tracks, albums, artists, playlists }
}

export async function search(cfg: SpotifyConfig, opts: SearchOptions): Promise<SpotifySearchResult> {
  const raw = await authedRequestJson<RawSearchResponse>(cfg, buildSearchUrl(opts))
  return normalizeSearchResponse(raw)
}
