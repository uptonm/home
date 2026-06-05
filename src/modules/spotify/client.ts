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

/**
 * Caps the number of in-flight `task()` calls at `concurrency`. Spotify's
 * Client Credentials budget is ~180 req/min with no `Retry-After` header
 * until you cross it; we cap at 5 parallel resolver calls so even a
 * `--limit 20` search across 3 container types (worst case 60 sequenced
 * batches of 5) stays well clear without affecting median-case latency
 * (most searches return a handful of matches and finish in one batch).
 */
export async function mapWithConcurrency<I, O>(items: I[], concurrency: number, task: (item: I) => Promise<O>): Promise<O[]> {
  const out: O[] = new Array(items.length)
  let next = 0
  const workers: Promise<void>[] = []
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push((async () => {
      while (true) {
        const i = next++
        if (i >= items.length) return
        out[i] = await task(items[i]!)
      }
    })())
  }
  await Promise.all(workers)
  return out
}

const RESOLVER_CONCURRENCY = 5

// ---------------------------------------------------------------------------
// Phase 1 — catalog list/get (client-credentials, no new auth).
//
// Every command below reuses `authedRequestJson` and emits the same match
// shapes as `search` so the Sonos compose story is preserved: track-bearing
// rows carry a directly-playable `spotify:track:<id>` `uri`, containers carry
// their canonical `spotify:<type>:<id>` form.
// ---------------------------------------------------------------------------

const SPOTIFY_API = 'https://api.spotify.com/v1'

/** A browse category (`/v1/browse/categories`). No playable `uri` — it is a
 *  grouping, not a catalog entity, so callers list a category's contents via
 *  search/new-releases rather than handing it to Sonos. */
export interface CategoryMatch {
  kind: 'category'
  id: string
  name: string
}

/** A single page of a Spotify paging object. `total`/`limit`/`offset` are
 *  echoed straight from Spotify so callers can page without guessing. */
export interface Paged<T> {
  items: T[]
  total?: number
  limit?: number
  offset?: number
}

export interface ListOptions {
  market?: string
  limit?: number
  offset?: number
}

interface RawCategory {
  id?: string
  name?: string
}

interface RawPagingTracks {
  items?: (RawTrack | null)[]
  total?: number
  limit?: number
  offset?: number
}

interface RawPagingAlbums {
  items?: (RawAlbum | null)[]
  total?: number
  limit?: number
  offset?: number
}

interface RawPlaylistTrackPage {
  items?: ({ track?: RawTrack | null } | null)[]
  total?: number
  limit?: number
  offset?: number
}

interface RawArtistTopTracksFull {
  tracks?: (RawTrack | null)[]
}

interface RawNewReleases {
  albums?: RawPagingAlbums
}

interface RawCategoriesPage {
  categories?: {
    items?: (RawCategory | null)[]
    total?: number
    limit?: number
    offset?: number
  }
}

/** Map a raw `/v1/tracks/{id}`-style track into our playable `TrackMatch`. */
export function shapeTrack(t: RawTrack): TrackMatch {
  return {
    kind: 'track',
    uri: `spotify:track:${t.id}`,
    title: t.name ?? '',
    artist: artistName(t.artists),
    album: t.album?.name ?? '',
    releaseDate: t.album?.release_date,
    durationMs: t.duration_ms,
    explicit: t.explicit,
  }
}

export function shapeAlbum(a: RawAlbum): AlbumMatch {
  return {
    kind: 'album',
    uri: `spotify:album:${a.id}`,
    title: a.name ?? '',
    artist: artistName(a.artists),
    releaseDate: a.release_date,
    totalTracks: a.total_tracks,
    albumType: a.album_type,
  }
}

export function shapeArtist(a: RawArtist): ArtistMatch {
  return {
    kind: 'artist',
    uri: `spotify:artist:${a.id}`,
    name: a.name ?? '',
    genres: a.genres ?? [],
    popularity: a.popularity,
    followers: a.followers?.total,
  }
}

export function shapePlaylist(p: RawPlaylist): PlaylistMatch {
  return {
    kind: 'playlist',
    uri: `spotify:playlist:${p.id}`,
    title: p.name ?? '',
    owner: p.owner?.display_name ?? p.owner?.id ?? '',
    totalTracks: p.tracks?.total,
    public: p.public,
  }
}

export function shapeCategory(c: RawCategory): CategoryMatch {
  return { kind: 'category', id: c.id ?? '', name: c.name ?? '' }
}

// --- Pure normalizers (exported & unit-tested separately from the fetch) -----
// Splitting the network call from the response-shaping keeps the shaping
// (null-row filtering, envelope unwrapping, paging passthrough) testable
// without a live token, mirroring `normalizeSearchResponse`.

export function normalizeTrackPage(raw: RawPagingTracks): Paged<TrackMatch> {
  const items = (raw.items ?? []).filter((t): t is RawTrack => !!t && !!t.id).map(shapeTrack)
  return { items, total: raw.total, limit: raw.limit, offset: raw.offset }
}

export function normalizeAlbumPage(raw: RawPagingAlbums): Paged<AlbumMatch> {
  const items = (raw.items ?? []).filter((a): a is RawAlbum => !!a && !!a.id).map(shapeAlbum)
  return { items, total: raw.total, limit: raw.limit, offset: raw.offset }
}

/** Playlist rows wrap the track in `{ track }`; entries can be null (a removed
 *  track) or a non-track item (podcast episode with no id) — both are dropped. */
export function normalizePlaylistTrackPage(raw: RawPlaylistTrackPage): Paged<TrackMatch> {
  const items = (raw.items ?? [])
    .map((row) => row?.track)
    .filter((t): t is RawTrack => !!t && !!t.id)
    .map(shapeTrack)
  return { items, total: raw.total, limit: raw.limit, offset: raw.offset }
}

/** Artist top-tracks come back as a flat `{ tracks: [...] }` — not paged. */
export function normalizeTopTracks(raw: RawArtistTopTracksFull): Paged<TrackMatch> {
  const items = (raw.tracks ?? []).filter((t): t is RawTrack => !!t && !!t.id).map(shapeTrack)
  return { items }
}

export function normalizeNewReleases(raw: RawNewReleases): Paged<AlbumMatch> {
  const page = raw.albums
  const items = (page?.items ?? []).filter((a): a is RawAlbum => !!a && !!a.id).map(shapeAlbum)
  return { items, total: page?.total, limit: page?.limit, offset: page?.offset }
}

export function normalizeCategoryPage(raw: RawCategoriesPage): Paged<CategoryMatch> {
  const page = raw.categories
  const items = (page?.items ?? []).filter((c): c is RawCategory => !!c && !!c.id).map(shapeCategory)
  return { items, total: page?.total, limit: page?.limit, offset: page?.offset }
}

/**
 * Resolve a user-supplied catalog reference to a bare Spotify id. Accepts any
 * of the three shapes a human (or LLM) is likely to paste:
 *   - a bare 22-char base62 id (`7oK9VyNzrYvRFo7nQEYkWN`)
 *   - a `spotify:<type>:<id>` URI (delegates to `extractSpotifyId`)
 *   - an `open.spotify.com/<type>/<id>` share URL (with optional `intl-xx`
 *     locale prefix and `?si=` query)
 * Returns null for anything else so commands can reject malformed input at the
 * boundary instead of issuing a doomed request.
 */
export function extractSpotifyRef(input: string): string | null {
  const raw = input.trim()
  if (/^[A-Za-z0-9]{22}$/.test(raw)) return raw
  const fromUri = extractSpotifyId(raw)
  if (fromUri) return fromUri
  const url = raw.match(/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?[a-zA-Z]+\/([A-Za-z0-9]{22})(?:[/?#].*)?$/i)
  return url ? url[1]! : null
}

function pagingQuery(opts: ListOptions): string {
  const params = new URLSearchParams()
  if (opts.market) params.set('market', opts.market)
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts.offset !== undefined && opts.offset > 0) params.set('offset', String(opts.offset))
  const q = params.toString()
  return q ? `?${q}` : ''
}

// --- URL builders (exported for unit tests) --------------------------------

export function buildTrackGetUrl(id: string): string {
  return `${SPOTIFY_API}/tracks/${encodeURIComponent(id)}`
}
export function buildAlbumGetUrl(id: string): string {
  return `${SPOTIFY_API}/albums/${encodeURIComponent(id)}`
}
export function buildArtistGetUrl(id: string): string {
  return `${SPOTIFY_API}/artists/${encodeURIComponent(id)}`
}
export function buildPlaylistGetUrl(id: string): string {
  return `${SPOTIFY_API}/playlists/${encodeURIComponent(id)}`
}
export function buildAlbumTracksListUrl(id: string, opts: ListOptions): string {
  return `${SPOTIFY_API}/albums/${encodeURIComponent(id)}/tracks${pagingQuery(opts)}`
}
export function buildArtistAlbumsUrl(id: string, opts: ListOptions): string {
  return `${SPOTIFY_API}/artists/${encodeURIComponent(id)}/albums${pagingQuery(opts)}`
}
export function buildPlaylistTracksListUrl(id: string, opts: ListOptions): string {
  return `${SPOTIFY_API}/playlists/${encodeURIComponent(id)}/tracks${pagingQuery(opts)}`
}
export function buildNewReleasesUrl(opts: ListOptions): string {
  return `${SPOTIFY_API}/browse/new-releases${pagingQuery(opts)}`
}
export function buildCategoriesUrl(opts: ListOptions): string {
  return `${SPOTIFY_API}/browse/categories${pagingQuery(opts)}`
}
export function buildCategoryGetUrl(id: string): string {
  return `${SPOTIFY_API}/browse/categories/${encodeURIComponent(id)}`
}

// --- Tier 1: get-by-id ------------------------------------------------------

export async function getTrack(cfg: SpotifyConfig, id: string): Promise<TrackMatch> {
  return shapeTrack(await authedRequestJson<RawTrack>(cfg, buildTrackGetUrl(id)))
}

export async function getAlbum(cfg: SpotifyConfig, id: string): Promise<AlbumMatch> {
  return shapeAlbum(await authedRequestJson<RawAlbum>(cfg, buildAlbumGetUrl(id)))
}

export async function getArtist(cfg: SpotifyConfig, id: string): Promise<ArtistMatch> {
  return shapeArtist(await authedRequestJson<RawArtist>(cfg, buildArtistGetUrl(id)))
}

export async function getPlaylist(cfg: SpotifyConfig, id: string): Promise<PlaylistMatch> {
  return shapePlaylist(await authedRequestJson<RawPlaylist>(cfg, buildPlaylistGetUrl(id)))
}

// --- Tier 2: children listings ---------------------------------------------

export async function getAlbumTracks(cfg: SpotifyConfig, id: string, opts: ListOptions): Promise<Paged<TrackMatch>> {
  // Album-track rows are simplified objects without an `album` field (the
  // album is the parent) — `shapeTrack` tolerates the absence and still emits
  // a playable `spotify:track:<id>` uri.
  return normalizeTrackPage(await authedRequestJson<RawPagingTracks>(cfg, buildAlbumTracksListUrl(id, opts)))
}

export async function getArtistAlbums(cfg: SpotifyConfig, id: string, opts: ListOptions): Promise<Paged<AlbumMatch>> {
  return normalizeAlbumPage(await authedRequestJson<RawPagingAlbums>(cfg, buildArtistAlbumsUrl(id, opts)))
}

export async function getArtistTopTracks(cfg: SpotifyConfig, id: string, market: string): Promise<Paged<TrackMatch>> {
  return normalizeTopTracks(await authedRequestJson<RawArtistTopTracksFull>(cfg, buildArtistTopTracksUrl(id, market)))
}

export async function getPlaylistTracks(cfg: SpotifyConfig, id: string, opts: ListOptions): Promise<Paged<TrackMatch>> {
  return normalizePlaylistTrackPage(await authedRequestJson<RawPlaylistTrackPage>(cfg, buildPlaylistTracksListUrl(id, opts)))
}

// --- Tier 3: browse ---------------------------------------------------------

export async function listNewReleases(cfg: SpotifyConfig, opts: ListOptions): Promise<Paged<AlbumMatch>> {
  return normalizeNewReleases(await authedRequestJson<RawNewReleases>(cfg, buildNewReleasesUrl(opts)))
}

export async function listCategories(cfg: SpotifyConfig, opts: ListOptions): Promise<Paged<CategoryMatch>> {
  return normalizeCategoryPage(await authedRequestJson<RawCategoriesPage>(cfg, buildCategoriesUrl(opts)))
}

export async function getCategory(cfg: SpotifyConfig, id: string): Promise<CategoryMatch> {
  return shapeCategory(await authedRequestJson<RawCategory>(cfg, buildCategoryGetUrl(id)))
}

export async function search(cfg: SpotifyConfig, opts: SearchOptions): Promise<SpotifySearchResult> {
  const raw = await authedRequestJson<RawSearchResponse>(cfg, buildSearchUrl(opts))
  const normalized = normalizeSearchResponse(raw)

  // Resolve container matches to first-track URIs with bounded concurrency
  // (RESOLVER_CONCURRENCY parallel in-flight per type, across all three
  // types). Per-match failures land as `resolverError` on the match so the
  // LLM can tell distinct causes apart instead of collapsing everything
  // into the downstream `container_not_playable`.
  const [albums, artists, playlists] = await Promise.all([
    mapWithConcurrency(normalized.albums, RESOLVER_CONCURRENCY, async (a) => {
      const id = extractSpotifyId(a.uri)
      const result = id ? await resolveAlbumFirstTrack(cfg, id, opts.market) : null
      return withResolvedTrack(a, result)
    }),
    mapWithConcurrency(normalized.artists, RESOLVER_CONCURRENCY, async (a) => {
      const id = extractSpotifyId(a.uri)
      const result = id ? await resolveArtistTopTrack(cfg, id, opts.market) : null
      return withResolvedTrack(a, result)
    }),
    mapWithConcurrency(normalized.playlists, RESOLVER_CONCURRENCY, async (p) => {
      const id = extractSpotifyId(p.uri)
      const result = id ? await resolvePlaylistFirstTrack(cfg, id, opts.market) : null
      return withResolvedTrack(p, result)
    }),
  ])

  return { tracks: normalized.tracks, albums, artists, playlists }
}
