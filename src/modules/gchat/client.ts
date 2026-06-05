import { requestJson } from '../../core/http'
import { SystemError } from '../../core/errors'
import type { ModuleConfig } from '../../core/types'

// ─── Auth (interim) ─────────────────────────────────────────────────────────
//
// The Google Chat API requires three-legged user OAuth. The *interactive*
// loopback-consent flow that mints a refresh token is shared infrastructure
// (`core/google-auth`) that does not exist yet — per the module plan, whichever
// Google module (gchat/gdrive/gmail) lands first builds it and the rest depend
// on it. That helper is owned by the gdrive workstream.
//
// Until it lands, this module is self-contained: `configure` collects
// clientId/clientSecret/refreshToken, and the block below exchanges the refresh
// token for short-lived access tokens directly (a plain `grant_type=refresh_token`
// POST — no interactive consent needed at runtime). When `core/google-auth`
// exists, replace `getAccessToken`/`authedRequestJson` with calls into it; the
// rest of this file (URL builders, normalizers, resolver) is unaffected.

export interface GchatConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
}

export function readGchatConfig(cfg: ModuleConfig): GchatConfig {
  return {
    clientId: String(cfg.clientId ?? ''),
    clientSecret: String(cfg.clientSecret ?? ''),
    refreshToken: String(cfg.refreshToken ?? ''),
  }
}

export const CHAT_API_BASE = 'https://chat.googleapis.com/v1'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

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
  scope?: string
}

/**
 * Exchange the stored refresh token for a short-lived access token, caching it
 * until ~1 minute before expiry. Mirrors the spotify client's token cache; the
 * only difference is the grant type (`refresh_token` vs `client_credentials`)
 * and the token endpoint.
 */
export async function getAccessToken(cfg: GchatConfig): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return cachedToken.value
  }
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    throw new SystemError('gchat clientId/clientSecret/refreshToken not configured', 'gchat_unconfigured')
  }
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await requestJson<TokenResponse>(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
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

/** Drop the cached token so the next `getAccessToken` re-refreshes. */
export function resetTokenCache(): void {
  cachedToken = null
}

/**
 * Run a bearer-token-authed `requestJson` against the Chat API. On a 401 (access
 * token expired or revoked upstream between our margin check and the call),
 * invalidate the cache and retry exactly once with a fresh token before
 * propagating the failure.
 */
export async function authedRequestJson<T>(cfg: GchatConfig, url: string, init: RequestInit = {}): Promise<T> {
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

// ─── Resource names ─────────────────────────────────────────────────────────
//
// Chat resources are addressed by REST resource name, not bare id:
//   space      spaces/{space}
//   membership spaces/{space}/members/{member}
//   message    spaces/{space}/messages/{message}
// The CLI accepts either the full resource name or a bare id (combined with the
// resolved space), so an LLM can pass whatever the previous call returned.

const SPACE_NAME_RE = /^spaces\/[^/]+$/

/** True when `ref` is already a `spaces/{id}` resource name (vs a display name). */
export function looksLikeSpaceName(ref: string): boolean {
  return SPACE_NAME_RE.test(ref.trim())
}

/** Combine a member id with its space, or pass through a full resource name. */
export function memberName(spaceName: string, ref: string): string {
  const t = ref.trim()
  return t.startsWith('spaces/') ? t : `${spaceName}/members/${t}`
}

/** Combine a message id with its space, or pass through a full resource name. */
export function messageName(spaceName: string, ref: string): string {
  const t = ref.trim()
  return t.startsWith('spaces/') ? t : `${spaceName}/messages/${t}`
}

// ─── URL builders ───────────────────────────────────────────────────────────

export interface ListParams {
  pageSize?: number
  pageToken?: string
  filter?: string
  orderBy?: string
}

function appendListParams(url: URL, params: ListParams): void {
  if (params.pageSize !== undefined) url.searchParams.set('pageSize', String(params.pageSize))
  if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
  if (params.filter) url.searchParams.set('filter', params.filter)
  if (params.orderBy) url.searchParams.set('orderBy', params.orderBy)
}

export function buildSpacesListUrl(params: ListParams = {}): string {
  const url = new URL(`${CHAT_API_BASE}/spaces`)
  appendListParams(url, params)
  return url.toString()
}

/** `spaceName` is the full resource name (`spaces/AAAA`). */
export function buildSpaceGetUrl(spaceName: string): string {
  return `${CHAT_API_BASE}/${spaceName}`
}

export function buildMembersListUrl(spaceName: string, params: ListParams = {}): string {
  const url = new URL(`${CHAT_API_BASE}/${spaceName}/members`)
  appendListParams(url, params)
  return url.toString()
}

/** `memberResourceName` is `spaces/AAAA/members/BBBB`. */
export function buildMemberGetUrl(memberResourceName: string): string {
  return `${CHAT_API_BASE}/${memberResourceName}`
}

export function buildMessagesListUrl(spaceName: string, params: ListParams = {}): string {
  const url = new URL(`${CHAT_API_BASE}/${spaceName}/messages`)
  appendListParams(url, params)
  return url.toString()
}

/** `messageResourceName` is `spaces/AAAA/messages/CCCC`. */
export function buildMessageGetUrl(messageResourceName: string): string {
  return `${CHAT_API_BASE}/${messageResourceName}`
}

// ─── Normalized shapes ──────────────────────────────────────────────────────
//
// Trim the verbose Chat resources down to an LLM-friendly subset, tolerating
// missing fields the way the spotify normalizer does (the API omits e.g.
// displayName on DMs). `JSON.stringify` drops the `undefined` optionals.

export interface SpaceSummary {
  name: string
  displayName: string
  spaceType?: string
  singleUserBotDm?: boolean
  threadingState?: string
  externalUserAllowed?: boolean
  createTime?: string
}

export interface MemberSummary {
  name: string
  state?: string
  role?: string
  member: {
    name?: string
    displayName?: string
    type?: string
  }
  createTime?: string
}

export interface MessageSummary {
  name: string
  text: string
  sender: {
    name?: string
    displayName?: string
    type?: string
  }
  createTime?: string
  lastUpdateTime?: string
  thread?: string
  space?: string
  argumentText?: string
}

interface RawUser {
  name?: string
  displayName?: string
  type?: string
  domainId?: string
}

interface RawSpace {
  name?: string
  displayName?: string
  spaceType?: string
  singleUserBotDm?: boolean
  spaceThreadingState?: string
  externalUserAllowed?: boolean
  createTime?: string
}

interface RawMembership {
  name?: string
  state?: string
  role?: string
  member?: RawUser
  createTime?: string
}

interface RawMessage {
  name?: string
  text?: string
  sender?: RawUser
  createTime?: string
  lastUpdateTime?: string
  thread?: { name?: string }
  space?: { name?: string }
  argumentText?: string
}

interface RawSpacesResponse {
  spaces?: (RawSpace | null)[]
  nextPageToken?: string
}

interface RawMembersResponse {
  memberships?: (RawMembership | null)[]
  nextPageToken?: string
}

interface RawMessagesResponse {
  messages?: (RawMessage | null)[]
  nextPageToken?: string
}

export function normalizeSpace(raw: RawSpace): SpaceSummary {
  return {
    name: raw.name ?? '',
    displayName: raw.displayName ?? '',
    spaceType: raw.spaceType,
    singleUserBotDm: raw.singleUserBotDm,
    threadingState: raw.spaceThreadingState,
    externalUserAllowed: raw.externalUserAllowed,
    createTime: raw.createTime,
  }
}

export function normalizeMember(raw: RawMembership): MemberSummary {
  return {
    name: raw.name ?? '',
    state: raw.state,
    role: raw.role,
    member: {
      name: raw.member?.name,
      displayName: raw.member?.displayName,
      type: raw.member?.type,
    },
    createTime: raw.createTime,
  }
}

export function normalizeMessage(raw: RawMessage): MessageSummary {
  return {
    name: raw.name ?? '',
    text: raw.text ?? '',
    sender: {
      name: raw.sender?.name,
      displayName: raw.sender?.displayName,
      type: raw.sender?.type,
    },
    createTime: raw.createTime,
    lastUpdateTime: raw.lastUpdateTime,
    thread: raw.thread?.name,
    space: raw.space?.name,
    argumentText: raw.argumentText,
  }
}

export interface SpacesPage {
  spaces: SpaceSummary[]
  nextPageToken?: string
}

export interface MembersPage {
  members: MemberSummary[]
  nextPageToken?: string
}

export interface MessagesPage {
  messages: MessageSummary[]
  nextPageToken?: string
}

export function normalizeSpacesResponse(raw: RawSpacesResponse): SpacesPage {
  const spaces = (raw.spaces ?? []).filter((s): s is RawSpace => !!s).map(normalizeSpace)
  return { spaces, nextPageToken: raw.nextPageToken }
}

export function normalizeMembersResponse(raw: RawMembersResponse): MembersPage {
  const members = (raw.memberships ?? []).filter((m): m is RawMembership => !!m).map(normalizeMember)
  return { members, nextPageToken: raw.nextPageToken }
}

export function normalizeMessagesResponse(raw: RawMessagesResponse): MessagesPage {
  const messages = (raw.messages ?? []).filter((m): m is RawMessage => !!m).map(normalizeMessage)
  return { messages, nextPageToken: raw.nextPageToken }
}

// ─── High-level operations ──────────────────────────────────────────────────

export async function listSpaces(cfg: GchatConfig, params: ListParams = {}): Promise<SpacesPage> {
  const raw = await authedRequestJson<RawSpacesResponse>(cfg, buildSpacesListUrl(params))
  return normalizeSpacesResponse(raw)
}

export async function getSpace(cfg: GchatConfig, spaceName: string): Promise<SpaceSummary> {
  const raw = await authedRequestJson<RawSpace>(cfg, buildSpaceGetUrl(spaceName))
  return normalizeSpace(raw)
}

export async function listMembers(cfg: GchatConfig, spaceName: string, params: ListParams = {}): Promise<MembersPage> {
  const raw = await authedRequestJson<RawMembersResponse>(cfg, buildMembersListUrl(spaceName, params))
  return normalizeMembersResponse(raw)
}

export async function getMember(cfg: GchatConfig, memberResourceName: string): Promise<MemberSummary> {
  const raw = await authedRequestJson<RawMembership>(cfg, buildMemberGetUrl(memberResourceName))
  return normalizeMember(raw)
}

export async function listMessages(cfg: GchatConfig, spaceName: string, params: ListParams = {}): Promise<MessagesPage> {
  const raw = await authedRequestJson<RawMessagesResponse>(cfg, buildMessagesListUrl(spaceName, params))
  return normalizeMessagesResponse(raw)
}

export async function getMessage(cfg: GchatConfig, messageResourceName: string): Promise<MessageSummary> {
  const raw = await authedRequestJson<RawMessage>(cfg, buildMessageGetUrl(messageResourceName))
  return normalizeMessage(raw)
}

// ─── Space resolution ───────────────────────────────────────────────────────

export interface ResolvedSpace {
  name: string
  displayName?: string
}

export type SpaceResolveResult =
  | { kind: 'ok'; space: ResolvedSpace }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; matches: ResolvedSpace[] }

/** How many spaces a display-name resolution scans (Chat's `pageSize` max). */
const SPACE_RESOLVE_PAGE_SIZE = 1000

/**
 * Pure matching core for `resolveSpace` — operates on an already-fetched space
 * list so the precedence rules can be unit-tested without network access.
 * Precedence: exact resource name > exact displayName > unique displayName
 * substring. A non-unique displayName/substring match is reported as ambiguous.
 */
export function matchSpace(spaces: SpaceSummary[], ref: string): SpaceResolveResult {
  const lower = ref.trim().toLowerCase()

  const byName = spaces.find((s) => s.name.toLowerCase() === lower)
  if (byName) return { kind: 'ok', space: { name: byName.name, displayName: byName.displayName } }

  const exact = spaces.filter((s) => s.displayName.toLowerCase() === lower)
  if (exact.length === 1) return { kind: 'ok', space: { name: exact[0]!.name, displayName: exact[0]!.displayName } }
  if (exact.length > 1) {
    return { kind: 'ambiguous', matches: exact.map((s) => ({ name: s.name, displayName: s.displayName })) }
  }

  const sub = spaces.filter((s) => s.displayName.toLowerCase().includes(lower))
  if (sub.length === 1) return { kind: 'ok', space: { name: sub[0]!.name, displayName: sub[0]!.displayName } }
  if (sub.length > 1) {
    return { kind: 'ambiguous', matches: sub.map((s) => ({ name: s.name, displayName: s.displayName })) }
  }

  return { kind: 'not_found' }
}

/**
 * Resolve a user-supplied space reference to a single space. A `spaces/{id}`
 * resource name short-circuits without a network call; anything else is treated
 * as a display-name and matched against `spaces list` (first page, up to
 * SPACE_RESOLVE_PAGE_SIZE) via `matchSpace`.
 */
export async function resolveSpace(cfg: GchatConfig, ref: string): Promise<SpaceResolveResult> {
  const trimmed = ref.trim()
  if (looksLikeSpaceName(trimmed)) {
    return { kind: 'ok', space: { name: trimmed } }
  }
  const page = await listSpaces(cfg, { pageSize: SPACE_RESOLVE_PAGE_SIZE })
  return matchSpace(page.spaces, trimmed)
}
