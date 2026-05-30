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

/**
 * Why a container match couldn't be rewritten to a `spotify:track:` URI.
 * Surfaced on the match itself so an LLM reading the search result JSON can
 * tell "this query has no matches" from "Spotify is rate-limited" from
 * "this playlist is region-blocked in `--market`" — instead of every failure
 * collapsing into the same downstream `container_not_playable` from the sonos
 * guard with no producer-side cause attached.
 */
export interface ResolverFailure {
  code: ResolverFailureCode
  message: string
}

export type ResolverFailureCode =
  | 'spotify_auth_failed'   // 401/403 — token revoked / scope insufficient
  | 'spotify_rate_limited'  // 429 — over Client Credentials budget
  | 'container_not_found'   // 404 — region-blocked, deleted, etc.
  | 'spotify_unavailable'   // 5xx — Spotify upstream having a bad day
  | 'spotify_resolver_failed' // anything else thrown by the resolver

export interface AlbumMatch {
  kind: 'album'
  uri: string
  title: string
  artist: string
  releaseDate?: string
  totalTracks?: number
  albumType?: string
  trackTitle?: string
  resolverError?: ResolverFailure
}

export interface ArtistMatch {
  kind: 'artist'
  uri: string
  name: string
  genres: string[]
  popularity?: number
  followers?: number
  trackTitle?: string
  resolverError?: ResolverFailure
}

export interface PlaylistMatch {
  kind: 'playlist'
  uri: string
  title: string
  owner: string
  totalTracks?: number
  public?: boolean
  trackTitle?: string
  resolverError?: ResolverFailure
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

/**
 * Extract the Spotify ID from a `spotify:<type>:<id>` URI. Spotify IDs are
 * always exactly 22 base62 characters in production — enforcing the length
 * here rejects malformed input at the producer boundary instead of letting
 * it propagate into the Sonos transport-URI construction downstream.
 */
export function extractSpotifyId(uri: string): string | null {
  const m = uri.match(/^spotify:[a-zA-Z]+:([A-Za-z0-9]{22})$/)
  return m ? m[1]! : null
}

/**
 * Map a thrown SystemError (or anything else) into a structured
 * `ResolverFailure`. Each per-match resolver wraps its call in this so the
 * cause survives the parallel-resolution pass and ends up on the match.
 */
export function classifyResolverError(err: unknown): ResolverFailure {
  if (err instanceof SystemError) {
    if (err.code === 'http_401' || err.code === 'http_403') {
      return { code: 'spotify_auth_failed', message: 'Spotify token rejected — check clientId/clientSecret or re-run `home spotify configure`' }
    }
    if (err.code === 'http_429') {
      return { code: 'spotify_rate_limited', message: 'Spotify Client Credentials budget exceeded — retry or lower `--limit`' }
    }
    if (err.code === 'http_404') {
      return { code: 'container_not_found', message: 'Spotify returned 404 — container may be region-blocked in `--market`, deleted, or never existed' }
    }
    if (err.code.startsWith('http_5')) {
      return { code: 'spotify_unavailable', message: `Spotify upstream returned ${err.code.replace('http_', '')}` }
    }
    return { code: 'spotify_resolver_failed', message: err.message }
  }
  return { code: 'spotify_resolver_failed', message: err instanceof Error ? err.message : String(err) }
}

/** Resolver result: a representative track, no track (empty container), or a structured failure. */
export type ResolverResult = ResolvedTrack | ResolverFailure | null

function isResolvedTrack(r: ResolverResult): r is ResolvedTrack {
  return r !== null && 'id' in r
}

function isResolverFailure(r: ResolverResult): r is ResolverFailure {
  return r !== null && 'code' in r
}

interface RawArtistTopTracks {
  tracks?: { id?: string; name?: string }[]
}

async function resolveArtistTopTrack(cfg: SpotifyConfig, artistId: string, market: string): Promise<ResolverResult> {
  try {
    const data = await authedRequestJson<RawArtistTopTracks>(cfg, buildArtistTopTracksUrl(artistId, market))
    const first = data?.tracks?.[0]
    if (!first?.id) return null
    return { id: first.id, title: first.name ?? '' }
  } catch (err) {
    return classifyResolverError(err)
  }
}

interface RawAlbumTracks {
  items?: { id?: string; name?: string }[]
}

async function resolveAlbumFirstTrack(cfg: SpotifyConfig, albumId: string, market: string): Promise<ResolverResult> {
  try {
    const data = await authedRequestJson<RawAlbumTracks>(cfg, buildAlbumTracksUrl(albumId, market))
    const first = data?.items?.[0]
    if (!first?.id) return null
    return { id: first.id, title: first.name ?? '' }
  } catch (err) {
    return classifyResolverError(err)
  }
}

interface RawPlaylistTracks {
  items?: { track?: { id?: string; name?: string } | null }[]
}

async function resolvePlaylistFirstTrack(cfg: SpotifyConfig, playlistId: string, market: string): Promise<ResolverResult> {
  try {
    const data = await authedRequestJson<RawPlaylistTracks>(cfg, buildPlaylistTracksUrl(playlistId, market))
    const first = data?.items?.[0]?.track
    if (!first?.id) return null
    return { id: first.id, title: first.name ?? '' }
  } catch (err) {
    return classifyResolverError(err)
  }
}

/**
 * Rewrite a container match given the resolver's result:
 *  - `ResolvedTrack` → set `uri` to `spotify:track:<id>` and fill `trackTitle`
 *  - `ResolverFailure` → keep the placeholder `uri`, set `resolverError` so
 *    callers can tell "Spotify rate-limited" from "region-blocked" from
 *    "playlist has no tracks" instead of collapsing every failure into the
 *    downstream sonos `container_not_playable`
 *  - `null` → no error, no track (empty container); placeholder URI stays
 */
export function withResolvedTrack<T extends AlbumMatch | ArtistMatch | PlaylistMatch>(
  match: T,
  result: ResolverResult,
): T {
  if (isResolvedTrack(result)) {
    return { ...match, uri: `spotify:track:${result.id}`, trackTitle: result.title }
  }
  if (isResolverFailure(result)) {
    return { ...match, resolverError: result }
  }
  return match
}

export async function search(cfg: SpotifyConfig, opts: SearchOptions): Promise<SpotifySearchResult> {
  const raw = await authedRequestJson<RawSearchResponse>(cfg, buildSearchUrl(opts))
  const normalized = normalizeSearchResponse(raw)

  // Resolve container matches to first-track URIs in parallel. Per-match
  // failures land as `resolverError` on the match (`spotify_auth_failed`,
  // `spotify_rate_limited`, `container_not_found`, etc.) so the LLM can tell
  // distinct causes apart instead of relying on the downstream
  // `container_not_playable` collapsing everything.
  const [albums, artists, playlists] = await Promise.all([
    Promise.all(normalized.albums.map(async (a) => {
      const id = extractSpotifyId(a.uri)
      const result = id ? await resolveAlbumFirstTrack(cfg, id, opts.market) : null
      return withResolvedTrack(a, result)
    })),
    Promise.all(normalized.artists.map(async (a) => {
      const id = extractSpotifyId(a.uri)
      const result = id ? await resolveArtistTopTrack(cfg, id, opts.market) : null
      return withResolvedTrack(a, result)
    })),
    Promise.all(normalized.playlists.map(async (p) => {
      const id = extractSpotifyId(p.uri)
      const result = id ? await resolvePlaylistFirstTrack(cfg, id, opts.market) : null
      return withResolvedTrack(p, result)
    })),
  ])

  return { tracks: normalized.tracks, albums, artists, playlists }
}
