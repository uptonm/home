import { authedRequest, authedRequestJson, requireGoogleCredentials, type GoogleOAuthCredentials } from '../../core/google-auth'
import { SystemError } from '../../core/errors'

/**
 * Gmail REST client. All requests hit `users/me` (the authenticated user's
 * mailbox) and carry a bearer token minted by `core/google-auth` from the
 * stored refresh token. URL builders and response parsers are kept pure and
 * exported so they can be unit-tested without a network or real credentials.
 */

/** Module name — also the namespace under which secrets are stored. */
export const GMAIL_MODULE = 'gmail'

export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** Read-spine scope: covers messages/threads/labels/drafts list+get. Kept for reference; superseded by modify. */
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
/** Write spine: read + relabel/archive/trash/create-label. Superset of readonly. */
export const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
/** Settings scope, needed for filters (routing rules) — modify does not cover it. */
export const GMAIL_SETTINGS_BASIC_SCOPE = 'https://www.googleapis.com/auth/gmail.settings.basic'
export const GMAIL_SCOPES = [GMAIL_MODIFY_SCOPE, GMAIL_SETTINGS_BASIC_SCOPE]

/** Secret key under which the OAuth refresh token is persisted (module "gmail"). */
export const GMAIL_REFRESH_TOKEN_KEY = 'refreshToken'

export type GmailConfig = GoogleOAuthCredentials

/** Shared OAuth client + gmail's own refresh token. Throws when either is absent. */
export function readGmailCredentials(): GmailConfig {
  return requireGoogleCredentials(GMAIL_MODULE)
}

// `messages.get` / `threads.get` / `drafts.get` projection. `raw` (full RFC 2822
// base64url) is valid for messages only; the get command validates per-entity.
export const MESSAGE_FORMATS = ['full', 'metadata', 'minimal', 'raw'] as const
export type MessageFormat = (typeof MESSAGE_FORMATS)[number]

export const THREAD_FORMATS = ['full', 'metadata', 'minimal'] as const
export type ThreadFormat = (typeof THREAD_FORMATS)[number]

// Headers worth hydrating for the common "show my unread" listing.
export const SUMMARY_HEADERS = ['From', 'To', 'Subject', 'Date'] as const

// --- URL builders (pure) -------------------------------------------------

export interface MessagesListOptions {
  q?: string
  labelIds?: string[]
  maxResults?: number
  pageToken?: string
  includeSpamTrash?: boolean
}

function listParams(opts: MessagesListOptions): URLSearchParams {
  const p = new URLSearchParams()
  if (opts.q) p.set('q', opts.q)
  for (const l of opts.labelIds ?? []) p.append('labelIds', l)
  if (opts.maxResults !== undefined) p.set('maxResults', String(opts.maxResults))
  if (opts.pageToken) p.set('pageToken', opts.pageToken)
  if (opts.includeSpamTrash) p.set('includeSpamTrash', 'true')
  return p
}

function withQuery(base: string, params: URLSearchParams): string {
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

export function messagesListUrl(opts: MessagesListOptions = {}): string {
  return withQuery(`${GMAIL_API_BASE}/messages`, listParams(opts))
}

export interface MessageGetOptions {
  format?: MessageFormat
  metadataHeaders?: readonly string[]
}

export function messageGetUrl(id: string, opts: MessageGetOptions = {}): string {
  const p = new URLSearchParams()
  if (opts.format) p.set('format', opts.format)
  for (const h of opts.metadataHeaders ?? []) p.append('metadataHeaders', h)
  return withQuery(`${GMAIL_API_BASE}/messages/${encodeURIComponent(id)}`, p)
}

export function threadsListUrl(opts: MessagesListOptions = {}): string {
  return withQuery(`${GMAIL_API_BASE}/threads`, listParams(opts))
}

export function threadGetUrl(id: string, opts: { format?: ThreadFormat } = {}): string {
  const p = new URLSearchParams()
  if (opts.format) p.set('format', opts.format)
  return withQuery(`${GMAIL_API_BASE}/threads/${encodeURIComponent(id)}`, p)
}

export function labelsListUrl(): string {
  return `${GMAIL_API_BASE}/labels`
}

export function labelGetUrl(id: string): string {
  return `${GMAIL_API_BASE}/labels/${encodeURIComponent(id)}`
}

export interface DraftsListOptions {
  q?: string
  maxResults?: number
  pageToken?: string
  includeSpamTrash?: boolean
}

export function draftsListUrl(opts: DraftsListOptions = {}): string {
  return withQuery(`${GMAIL_API_BASE}/drafts`, listParams(opts))
}

export function draftGetUrl(id: string, opts: { format?: MessageFormat } = {}): string {
  const p = new URLSearchParams()
  if (opts.format) p.set('format', opts.format)
  return withQuery(`${GMAIL_API_BASE}/drafts/${encodeURIComponent(id)}`, p)
}

export function profileUrl(): string {
  return `${GMAIL_API_BASE}/profile`
}

// --- Write URL builders (pure) -------------------------------------------

export function messagesBatchModifyUrl(): string {
  return `${GMAIL_API_BASE}/messages/batchModify`
}

export function messageTrashUrl(id: string): string {
  return `${GMAIL_API_BASE}/messages/${encodeURIComponent(id)}/trash`
}

export function messageUntrashUrl(id: string): string {
  return `${GMAIL_API_BASE}/messages/${encodeURIComponent(id)}/untrash`
}

export function filtersListUrl(): string {
  return `${GMAIL_API_BASE}/settings/filters`
}

export function filterDeleteUrl(id: string): string {
  return `${GMAIL_API_BASE}/settings/filters/${encodeURIComponent(id)}`
}

// --- Response shapes -----------------------------------------------------

export interface GmailHeader {
  name?: string
  value?: string
}

export interface GmailMessagePart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { attachmentId?: string; size?: number; data?: string }
  parts?: GmailMessagePart[]
}

export interface GmailMessage {
  id: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  historyId?: string
  internalDate?: string
  sizeEstimate?: number
  raw?: string
  payload?: GmailMessagePart
}

export interface MessageRef {
  id: string
  threadId?: string
}

export interface MessagesListResponse {
  messages?: MessageRef[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

export interface GmailThread {
  id: string
  historyId?: string
  snippet?: string
  messages?: GmailMessage[]
}

export interface ThreadRef {
  id: string
  historyId?: string
  snippet?: string
}

export interface ThreadsListResponse {
  threads?: ThreadRef[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

export interface GmailLabel {
  id: string
  name?: string
  type?: string
  messageListVisibility?: string
  labelListVisibility?: string
  messagesTotal?: number
  messagesUnread?: number
  threadsTotal?: number
  threadsUnread?: number
}

export interface LabelsListResponse {
  labels?: GmailLabel[]
}

export interface DraftRef {
  id: string
  message?: MessageRef
}

export interface GmailDraft {
  id: string
  message?: GmailMessage
}

export interface DraftsListResponse {
  drafts?: DraftRef[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

export interface GmailProfile {
  emailAddress?: string
  messagesTotal?: number
  threadsTotal?: number
  historyId?: string
}

// A routing rule: `criteria` matches incoming mail, `action` relabels it. Mirrors
// the `settings.filters` resource — a subset of its fields, the ones we set.
export interface GmailFilterCriteria {
  from?: string
  to?: string
  subject?: string
  query?: string
  negatedQuery?: string
  hasAttachment?: boolean
}

export interface GmailFilterAction {
  addLabelIds?: string[]
  removeLabelIds?: string[]
  forward?: string
}

export interface GmailFilter {
  id?: string
  criteria: GmailFilterCriteria
  action: GmailFilterAction
}

export interface FiltersListResponse {
  filter?: GmailFilter[]
}

export interface CreateLabelOptions {
  name: string
  labelListVisibility?: string
  messageListVisibility?: string
}

export interface BatchModifyOptions {
  ids: string[]
  addLabelIds?: string[]
  removeLabelIds?: string[]
}

// --- Parsers (pure) ------------------------------------------------------

/** Case-insensitive header lookup over a message payload. */
export function headerValue(message: GmailMessage, name: string): string | undefined {
  const headers = message.payload?.headers
  if (!headers) return undefined
  const lower = name.toLowerCase()
  return headers.find((h) => (h.name ?? '').toLowerCase() === lower)?.value
}

export interface MessageSummary {
  id: string
  threadId?: string
  from?: string
  to?: string
  subject?: string
  date?: string
  snippet?: string
  labelIds?: string[]
  /** Present when the metadata fetch for this message failed (e.g. message deleted between list and get). */
  error?: string
}

/**
 * Flatten a (typically `format=metadata`) message into the compact row the
 * `messages list --hydrate` case wants: id/thread plus the From/To/Subject/Date
 * headers and the snippet, so "show my unread" is readable without a second
 * round-trip per message.
 */
export function summarizeMessage(message: GmailMessage): MessageSummary {
  return {
    id: message.id,
    threadId: message.threadId,
    from: headerValue(message, 'From'),
    to: headerValue(message, 'To'),
    subject: headerValue(message, 'Subject'),
    date: headerValue(message, 'Date'),
    snippet: message.snippet,
    labelIds: message.labelIds,
  }
}

// --- Bounded concurrency -------------------------------------------------

/** Run `task` over `items` with at most `concurrency` in flight, order-preserving. */
export async function mapWithConcurrency<I, O>(
  items: I[],
  concurrency: number,
  task: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  const out: O[] = new Array(items.length)
  let next = 0
  const workers: Promise<void>[] = []
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = next++
          if (i >= items.length) return
          out[i] = await task(items[i]!, i)
        }
      })(),
    )
  }
  await Promise.all(workers)
  return out
}

/** Split `items` into groups of at most `size` (order-preserving, last group short). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const HYDRATE_CONCURRENCY = 8
/** `messages.batchModify` accepts at most 1000 ids per call. */
const BATCH_MODIFY_MAX = 1000
/** Trash has no batch form; cap in-flight per-message trash calls. */
const TRASH_CONCURRENCY = 8

// --- API functions -------------------------------------------------------

export function listMessages(cfg: GmailConfig, opts: MessagesListOptions = {}): Promise<MessagesListResponse> {
  return authedRequestJson<MessagesListResponse>(cfg, messagesListUrl(opts))
}

export function getMessage(cfg: GmailConfig, id: string, opts: MessageGetOptions = {}): Promise<GmailMessage> {
  return authedRequestJson<GmailMessage>(cfg, messageGetUrl(id, opts))
}

export interface HydratedMessagesResponse {
  messages: MessageSummary[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

/**
 * `messages list` followed by a bounded-concurrency `format=metadata` fetch of
 * every id on the page, collapsed into compact summaries. One logical call for
 * the common "show me my unread" ask instead of an id list the caller has to
 * re-hydrate one message at a time.
 */
export async function listMessagesHydrated(
  cfg: GmailConfig,
  opts: MessagesListOptions = {},
): Promise<HydratedMessagesResponse> {
  const page = await listMessages(cfg, opts)
  const refs = page.messages ?? []
  const messages = await mapWithConcurrency(refs, HYDRATE_CONCURRENCY, async (ref) => {
    try {
      const full = await getMessage(cfg, ref.id, {
        format: 'metadata',
        metadataHeaders: SUMMARY_HEADERS,
      })
      return summarizeMessage(full)
    } catch (err) {
      return {
        id: ref.id,
        threadId: ref.threadId,
        error: (err as Error).message,
      } satisfies MessageSummary
    }
  })
  return {
    messages,
    nextPageToken: page.nextPageToken,
    resultSizeEstimate: page.resultSizeEstimate,
  }
}

export function listThreads(cfg: GmailConfig, opts: MessagesListOptions = {}): Promise<ThreadsListResponse> {
  return authedRequestJson<ThreadsListResponse>(cfg, threadsListUrl(opts))
}

export function getThread(cfg: GmailConfig, id: string, opts: { format?: ThreadFormat } = {}): Promise<GmailThread> {
  return authedRequestJson<GmailThread>(cfg, threadGetUrl(id, opts))
}

export function listLabels(cfg: GmailConfig): Promise<LabelsListResponse> {
  return authedRequestJson<LabelsListResponse>(cfg, labelsListUrl())
}

export function getLabel(cfg: GmailConfig, id: string): Promise<GmailLabel> {
  return authedRequestJson<GmailLabel>(cfg, labelGetUrl(id))
}

export function listDrafts(cfg: GmailConfig, opts: DraftsListOptions = {}): Promise<DraftsListResponse> {
  return authedRequestJson<DraftsListResponse>(cfg, draftsListUrl(opts))
}

export function getDraft(cfg: GmailConfig, id: string, opts: { format?: MessageFormat } = {}): Promise<GmailDraft> {
  return authedRequestJson<GmailDraft>(cfg, draftGetUrl(id, opts))
}

export function getProfile(cfg: GmailConfig): Promise<GmailProfile> {
  return authedRequestJson<GmailProfile>(cfg, profileUrl())
}

// --- Write API functions -------------------------------------------------

/** POST helper for the write endpoints that return 204 No Content (batchModify, delete). */
async function authedNoContent(cfg: GmailConfig, url: string, method: string, body?: unknown): Promise<void> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await authedRequest(cfg, url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new SystemError(
      `HTTP ${res.status} ${res.statusText} from ${url}${text ? `: ${text.slice(0, 200)}` : ''}`,
      `http_${res.status}`,
    )
  }
}

/**
 * Add/remove labels on up to `ids.length` messages via `messages.batchModify`,
 * chunked at Gmail's 1000-id-per-call limit. This one primitive is archive
 * (remove INBOX), mark-read (remove UNREAD), and label (add Label_x). Returns
 * the number of messages acted on; makes no request for an empty id set.
 */
export async function batchModifyMessages(cfg: GmailConfig, opts: BatchModifyOptions): Promise<number> {
  if (opts.ids.length === 0) return 0
  const body: Record<string, unknown> = {}
  if (opts.addLabelIds?.length) body.addLabelIds = opts.addLabelIds
  if (opts.removeLabelIds?.length) body.removeLabelIds = opts.removeLabelIds
  for (const ids of chunk(opts.ids, BATCH_MODIFY_MAX)) {
    await authedNoContent(cfg, messagesBatchModifyUrl(), 'POST', { ...body, ids })
  }
  return opts.ids.length
}

/**
 * Move each message to Trash (recoverable ~30 days). `messages.batchModify`
 * rejects the TRASH label and there is no batch-trash endpoint, so this maps
 * per-message `messages.trash` calls under bounded concurrency. Returns the
 * count trashed.
 */
export async function trashMessages(cfg: GmailConfig, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  await mapWithConcurrency(ids, TRASH_CONCURRENCY, (id) =>
    authedRequestJson<GmailMessage>(cfg, messageTrashUrl(id), { method: 'POST' }),
  )
  return ids.length
}

/** Restore messages from Trash via per-message `messages.untrash`. Returns the count restored. */
export async function untrashMessages(cfg: GmailConfig, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  await mapWithConcurrency(ids, TRASH_CONCURRENCY, (id) =>
    authedRequestJson<GmailMessage>(cfg, messageUntrashUrl(id), { method: 'POST' }),
  )
  return ids.length
}

/** Create a user label; returns it with its assigned id. */
export function createLabel(cfg: GmailConfig, opts: CreateLabelOptions): Promise<GmailLabel> {
  return authedRequestJson<GmailLabel>(cfg, labelsListUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
}

export function listFilters(cfg: GmailConfig): Promise<FiltersListResponse> {
  return authedRequestJson<FiltersListResponse>(cfg, filtersListUrl())
}

/** Create a routing rule. Applies to future mail only — Gmail's API does not backfill existing messages. */
export function createFilter(cfg: GmailConfig, filter: GmailFilter): Promise<GmailFilter> {
  return authedRequestJson<GmailFilter>(cfg, filtersListUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ criteria: filter.criteria, action: filter.action }),
  })
}

export function deleteFilter(cfg: GmailConfig, id: string): Promise<void> {
  return authedNoContent(cfg, filterDeleteUrl(id), 'DELETE')
}
