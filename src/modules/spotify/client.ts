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

/**
 * Every match emits a `uri` field that is *directly playable* by
 * `home sonos play-uri` — i.e. always `spotify:track:<id>`. For container
 * matches (album / artist / playlist) the resolver picks a representative
 * track and exposes its title via `trackTitle` so the LLM still has enough
 * context to say "playing OK Computer's first track" instead of just the
 * track name.
 */
export interface TrackMatch {
  kind: 'track'
  uri: string
  title: string
  artist: string
  album: string
  releaseDate?: string
  durationMs?: number
  explicit?: boolean
}

export interface AlbumMatch {
  kind: 'album'
  uri: string
  title: string
  artist: string
  releaseDate?: string
  totalTracks?: number
  albumType?: string
  trackTitle?: string
}

export interface ArtistMatch {
  kind: 'artist'
  uri: string
  name: string
  genres: string[]
  popularity?: number
  followers?: number
  trackTitle?: string
}

export interface PlaylistMatch {
  kind: 'playlist'
  uri: string
  title: string
  owner: string
  totalTracks?: number
  public?: boolean
  trackTitle?: string
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

export function buildArtistTopTracksUrl(artistId: string, market: string): string {
  return `https://api.spotify.com/v1/artists/${encodeURIComponent(artistId)}/top-tracks?market=${encodeURIComponent(market)}`
}

export function buildAlbumTracksUrl(albumId: string, market: string): string {
  return `https://api.spotify.com/v1/albums/${encodeURIComponent(albumId)}/tracks?limit=1&market=${encodeURIComponent(market)}`
}

export function buildPlaylistTracksUrl(playlistId: string, market: string): string {
  return `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=1&market=${encodeURIComponent(market)}`
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

export interface ResolvedTrack {
  id: string
  title: string
}

/**
 * Normalize the raw Spotify /v1/search response into our match types.
 * Container matches (album / artist / playlist) have their `uri` set to the
 * placeholder `spotify:<type>:<id>` form here; `search()` overwrites that to
 * `spotify:track:<id>` once the per-container resolver returns its first
 * track. If a resolver fails, the placeholder leaks through and the sonos
 * container_not_playable guard catches it.
 */
export function normalizeSearchResponse(raw: RawSearchResponse): SpotifySearchResult {
  const trackItems = (raw.tracks?.items ?? []).filter((t): t is RawTrack => !!t && !!t.id)
  const albumItems = (raw.albums?.items ?? []).filter((a): a is RawAlbum => !!a && !!a.id)
  const artistItems = (raw.artists?.items ?? []).filter((a): a is RawArtist => !!a && !!a.id)
  const playlistItems = (raw.playlists?.items ?? []).filter((p): p is RawPlaylist => !!p && !!p.id)

  const tracks: TrackMatch[] = trackItems.map((t) => ({
    kind: 'track',
    uri: `spotify:track:${t.id}`,
    title: t.name ?? '',
    artist: artistName(t.artists),
    album: t.album?.name ?? '',
    releaseDate: t.album?.release_date,
    durationMs: t.duration_ms,
    explicit: t.explicit,
  }))

  const albums: AlbumMatch[] = albumItems.map((a) => ({
    kind: 'album',
    uri: `spotify:album:${a.id}`,
    title: a.name ?? '',
    artist: artistName(a.artists),
    releaseDate: a.release_date,
    totalTracks: a.total_tracks,
    albumType: a.album_type,
  }))

  const artists: ArtistMatch[] = artistItems.map((a) => ({
    kind: 'artist',
    uri: `spotify:artist:${a.id}`,
    name: a.name ?? '',
    genres: a.genres ?? [],
    popularity: a.popularity,
    followers: a.followers?.total,
  }))

  const playlists: PlaylistMatch[] = playlistItems.map((p) => ({
    kind: 'playlist',
    uri: `spotify:playlist:${p.id}`,
    title: p.name ?? '',
    owner: p.owner?.display_name ?? p.owner?.id ?? '',
    totalTracks: p.tracks?.total,
    public: p.public,
  }))

  return { tracks, albums, artists, playlists }
}

/** Extract the Spotify ID from a `spotify:<type>:<id>` URI. */
export function extractSpotifyId(uri: string): string | null {
  const m = uri.match(/^spotify:[a-zA-Z]+:([A-Za-z0-9]+)$/)
  return m ? m[1]! : null
}

interface RawArtistTopTracks {
  tracks?: { id?: string; name?: string }[]
}

async function resolveArtistTopTrack(cfg: SpotifyConfig, artistId: string, market: string): Promise<ResolvedTrack | null> {
  const data = await authedRequestJson<RawArtistTopTracks>(cfg, buildArtistTopTracksUrl(artistId, market)).catch(() => null)
  const first = data?.tracks?.[0]
  if (!first?.id) return null
  return { id: first.id, title: first.name ?? '' }
}

interface RawAlbumTracks {
  items?: { id?: string; name?: string }[]
}

async function resolveAlbumFirstTrack(cfg: SpotifyConfig, albumId: string, market: string): Promise<ResolvedTrack | null> {
  const data = await authedRequestJson<RawAlbumTracks>(cfg, buildAlbumTracksUrl(albumId, market)).catch(() => null)
  const first = data?.items?.[0]
  if (!first?.id) return null
  return { id: first.id, title: first.name ?? '' }
}

interface RawPlaylistTracks {
  items?: { track?: { id?: string; name?: string } | null }[]
}

async function resolvePlaylistFirstTrack(cfg: SpotifyConfig, playlistId: string, market: string): Promise<ResolvedTrack | null> {
  const data = await authedRequestJson<RawPlaylistTracks>(cfg, buildPlaylistTracksUrl(playlistId, market)).catch(() => null)
  const first = data?.items?.[0]?.track
  if (!first?.id) return null
  return { id: first.id, title: first.name ?? '' }
}

/**
 * Rewrite a single container match (album / artist / playlist) so its `uri`
 * points at the resolved representative track and `trackTitle` carries that
 * track's name. Pure — kept separate from the HTTP calls so it can be tested
 * independently of `search()`.
 */
export function applyResolvedTrack<T extends AlbumMatch | ArtistMatch | PlaylistMatch>(
  match: T,
  resolved: ResolvedTrack | null,
): T {
  if (!resolved) return match
  return { ...match, uri: `spotify:track:${resolved.id}`, trackTitle: resolved.title }
}

export async function search(cfg: SpotifyConfig, opts: SearchOptions): Promise<SpotifySearchResult> {
  const raw = await authedRequestJson<RawSearchResponse>(cfg, buildSearchUrl(opts))
  const normalized = normalizeSearchResponse(raw)

  // Resolve container matches to first-track URIs in parallel so the LLM can
  // pipe any match.uri straight to `home sonos play-uri` without knowing the
  // kind. Per-match failure is non-fatal: the placeholder URI leaks through
  // and the sonos container_not_playable guard turns it into a clean error.
  const [albums, artists, playlists] = await Promise.all([
    Promise.all(normalized.albums.map(async (a) => {
      const id = extractSpotifyId(a.uri)
      const resolved = id ? await resolveAlbumFirstTrack(cfg, id, opts.market) : null
      return applyResolvedTrack(a, resolved)
    })),
    Promise.all(normalized.artists.map(async (a) => {
      const id = extractSpotifyId(a.uri)
      const resolved = id ? await resolveArtistTopTrack(cfg, id, opts.market) : null
      return applyResolvedTrack(a, resolved)
    })),
    Promise.all(normalized.playlists.map(async (p) => {
      const id = extractSpotifyId(p.uri)
      const resolved = id ? await resolvePlaylistFirstTrack(cfg, id, opts.market) : null
      return applyResolvedTrack(p, resolved)
    })),
  ])

  return { tracks: normalized.tracks, albums, artists, playlists }
}
