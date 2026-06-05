import type { ModuleConfig } from '../../core/types'
import { getSecret } from '../../core/secrets'
import {
  authedRequest,
  authedRequestJson,
  type GoogleOAuthCredentials,
} from '../../core/google-auth'
import { SystemError } from '../../core/errors'
import type { HttpOptions } from '../../core/http'

export const DRIVE_API = 'https://www.googleapis.com/drive/v3'

/**
 * Least-privilege read scope for the Phase 1 spine (list/get/download/export).
 * Write commands (Phase 3) would add `drive.file` or `drive`; keep this minimal
 * until those land so a `gdrive` consent never grants more than it needs.
 */
export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

/** Secret key (outside the config schema) holding the OAuth refresh token. Managed by `auth login`/`auth logout`. */
export const REFRESH_TOKEN_KEY = 'refreshToken'

export const MODULE_NAME = 'gdrive'

export interface GdriveConfig {
  clientId: string
  clientSecret: string
}

export function readGdriveConfig(cfg: ModuleConfig): GdriveConfig {
  return {
    clientId: String(cfg.clientId ?? ''),
    clientSecret: String(cfg.clientSecret ?? ''),
  }
}

/**
 * Assemble the full OAuth credential set. `clientId`/`clientSecret` arrive via
 * the module config (declared in `configSchema`); the `refreshToken` is stored
 * out-of-schema (it's obtained via the browser flow, not typed at a prompt) so
 * we read it straight from the secrets store here.
 */
export function readGdriveCredentials(cfg: ModuleConfig): GoogleOAuthCredentials {
  const { clientId, clientSecret } = readGdriveConfig(cfg)
  return {
    clientId,
    clientSecret,
    refreshToken: getSecret(MODULE_NAME, REFRESH_TOKEN_KEY) ?? '',
  }
}

// ---------------------------------------------------------------------------
// Drive `q` query language helpers
// ---------------------------------------------------------------------------

/** Escape a value for interpolation inside a Drive `q` string literal ( ' and \ ). */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** A `q` clause matching a file by exact name OR name-substring (both escaped). */
export function buildNameQuery(ref: string): string {
  const v = escapeDriveQueryValue(ref)
  return `(name = '${v}' or name contains '${v}')`
}

// ---------------------------------------------------------------------------
// URL builders (pure)
// ---------------------------------------------------------------------------

/** Default `fields` mask for `files list` — Drive returns sparse objects unless asked. */
export const DEFAULT_LIST_FIELDS =
  'nextPageToken,files(id,name,mimeType,size,modifiedTime,trashed,parents,driveId,owners(displayName,emailAddress),webViewLink,shortcutDetails)'

/** Lean field set used when resolving a name → file (id/name/mimeType are all the resolver needs). */
export const RESOLVE_FIELDS = 'id,name,mimeType,size,modifiedTime,driveId,trashed'
const RESOLVE_LIST_FIELDS = `files(${RESOLVE_FIELDS})`

export interface FilesListParams {
  q?: string
  orderBy?: string
  pageSize?: number
  pageToken?: string
  fields?: string
  /** Scope the listing to a single shared drive (sets `driveId` + `corpora=drive`). */
  driveId?: string
  corpora?: string
  spaces?: string
  includeItemsFromAllDrives?: boolean
  supportsAllDrives?: boolean
}

export function buildFilesListUrl(p: FilesListParams = {}): string {
  const params = new URLSearchParams()
  if (p.q) params.set('q', p.q)
  if (p.orderBy) params.set('orderBy', p.orderBy)
  params.set('pageSize', String(p.pageSize ?? 100))
  if (p.pageToken) params.set('pageToken', p.pageToken)
  params.set('fields', p.fields ?? DEFAULT_LIST_FIELDS)

  // Shared-drive items only surface when both flags are set; default them on so
  // a plain `files list` sees My Drive + shared drives + shared-with-me.
  params.set('supportsAllDrives', String(p.supportsAllDrives ?? true))
  params.set('includeItemsFromAllDrives', String(p.includeItemsFromAllDrives ?? true))

  if (p.driveId) {
    params.set('driveId', p.driveId)
    params.set('corpora', p.corpora ?? 'drive')
  } else if (p.corpora) {
    params.set('corpora', p.corpora)
  }
  if (p.spaces) params.set('spaces', p.spaces)

  return `${DRIVE_API}/files?${params.toString()}`
}

export function buildFileGetUrl(id: string, opts: { fields?: string; supportsAllDrives?: boolean } = {}): string {
  const params = new URLSearchParams({ fields: opts.fields ?? '*' })
  params.set('supportsAllDrives', String(opts.supportsAllDrives ?? true))
  return `${DRIVE_API}/files/${encodeURIComponent(id)}?${params.toString()}`
}

export function buildFileDownloadUrl(id: string): string {
  const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' })
  return `${DRIVE_API}/files/${encodeURIComponent(id)}?${params.toString()}`
}

export function buildExportUrl(id: string, mimeType: string): string {
  const params = new URLSearchParams({ mimeType })
  return `${DRIVE_API}/files/${encodeURIComponent(id)}/export?${params.toString()}`
}

export function buildAboutUrl(): string {
  return `${DRIVE_API}/about?fields=user,storageQuota`
}

// ---------------------------------------------------------------------------
// MIME helpers (native vs binary, export presets)
// ---------------------------------------------------------------------------

export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'
export const GOOGLE_SHORTCUT_MIME = 'application/vnd.google-apps.shortcut'

/** Google-native editor files (Docs/Sheets/Slides/…) carry an `application/vnd.google-apps.*` MIME. */
export function isGoogleNativeMime(mime: string | undefined): boolean {
  return !!mime && mime.startsWith('application/vnd.google-apps.')
}

/**
 * Friendly `--mime` aliases → export MIME type. Aliases cover the common
 * Docs→pdf/docx, Sheets→xlsx/csv, Slides→pdf/pptx targets; an unrecognized
 * value is assumed to already be a full MIME and passed through unchanged.
 */
export const EXPORT_MIME_ALIASES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  rtf: 'application/rtf',
  html: 'text/html',
  md: 'text/markdown',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  epub: 'application/epub+zip',
  json: 'application/vnd.google-apps.script+json',
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
}

/** Resolve a `--mime` value: a known alias maps to its MIME; anything else is treated as a literal MIME. */
export function resolveExportMime(input: string): string {
  const key = input.trim().toLowerCase()
  return EXPORT_MIME_ALIASES[key] ?? input.trim()
}

/** Best-effort file extension for an export MIME (for default output filenames). */
export function extensionForExportMime(mime: string): string {
  const hit = Object.entries(EXPORT_MIME_ALIASES).find(([, v]) => v === mime)
  return hit ? hit[0] : 'bin'
}

// ---------------------------------------------------------------------------
// File resolution (id or name → file)
// ---------------------------------------------------------------------------

export interface DriveFile {
  id?: string
  name?: string
  mimeType?: string
  size?: string
  modifiedTime?: string
  trashed?: boolean
  driveId?: string
  [key: string]: unknown
}

export type ResolveFileResult =
  | { kind: 'ok'; file: DriveFile }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; matches: DriveFile[] }

/**
 * Heuristic: does `ref` look like a Drive file id rather than a name? Drive ids
 * are opaque, ≥20 chars, drawn from `[A-Za-z0-9_-]` (no spaces, dots, slashes).
 * A real filename ("Q3 Budget.xlsx") fails this, so we route it to a name
 * search instead of a doomed direct GET.
 */
export function looksLikeDriveId(ref: string): boolean {
  return /^[A-Za-z0-9_-]{20,}$/.test(ref.trim())
}

/**
 * Match a name query against a candidate list: exact (case-insensitive) name
 * wins; otherwise a unique substring resolves and multiple hits are reported
 * ambiguous (so the caller lists candidates instead of guessing). Pure +
 * synchronous — mirrors `matchNetwork` in the unifi module.
 */
export function matchFileByName(files: DriveFile[], ref: string): ResolveFileResult {
  const q = ref.trim()
  if (!q) return { kind: 'not_found' }
  const ql = q.toLowerCase()

  const exact = files.filter((f) => (f.name ?? '').toLowerCase() === ql)
  if (exact.length === 1) return { kind: 'ok', file: exact[0]! }
  if (exact.length > 1) return { kind: 'ambiguous', matches: exact }

  const sub = files.filter((f) => (f.name ?? '').toLowerCase().includes(ql))
  if (sub.length === 1) return { kind: 'ok', file: sub[0]! }
  if (sub.length > 1) return { kind: 'ambiguous', matches: sub }

  return { kind: 'not_found' }
}

// ---------------------------------------------------------------------------
// Network functions (take resolved OAuth credentials)
// ---------------------------------------------------------------------------

export interface AboutResponse {
  user?: { displayName?: string; emailAddress?: string; photoLink?: string }
  storageQuota?: { limit?: string; usage?: string; usageInDrive?: string; usageInDriveTrash?: string }
}

export async function getAbout(creds: GoogleOAuthCredentials): Promise<AboutResponse> {
  return authedRequestJson<AboutResponse>(creds, buildAboutUrl())
}

export interface FilesListResult {
  files: DriveFile[]
  nextPageToken?: string
}

export async function listFiles(creds: GoogleOAuthCredentials, p: FilesListParams = {}): Promise<FilesListResult> {
  const body = await authedRequestJson<{ files?: DriveFile[]; nextPageToken?: string }>(creds, buildFilesListUrl(p))
  return { files: body.files ?? [], nextPageToken: body.nextPageToken }
}

export async function getFile(
  creds: GoogleOAuthCredentials,
  id: string,
  opts: { fields?: string } = {},
): Promise<DriveFile> {
  return authedRequestJson<DriveFile>(creds, buildFileGetUrl(id, opts))
}

// Media transfers can be large and slow; widen the timeout and don't retry a
// half-streamed body (core/http's default 10s/3-retries is tuned for JSON).
const MEDIA_HTTP_OPTS: HttpOptions = { timeoutMs: 120_000, retries: 1 }

export async function fetchFileMedia(creds: GoogleOAuthCredentials, id: string): Promise<Response> {
  return authedRequest(creds, buildFileDownloadUrl(id), {}, MEDIA_HTTP_OPTS)
}

export async function fetchFileExport(creds: GoogleOAuthCredentials, id: string, mimeType: string): Promise<Response> {
  return authedRequest(creds, buildExportUrl(id, mimeType), {}, MEDIA_HTTP_OPTS)
}

/**
 * Resolve a user-supplied file reference (id or name) to a concrete file.
 * Id-shaped refs are fetched directly (falling back to a name search on 404,
 * since a real filename can coincidentally look id-shaped); everything else is
 * resolved through a scoped, trashed-excluded `files list` + `matchFileByName`.
 */
export async function resolveFile(
  creds: GoogleOAuthCredentials,
  ref: string,
  listExtra: Partial<FilesListParams> = {},
): Promise<ResolveFileResult> {
  const q = ref.trim()
  if (!q) return { kind: 'not_found' }

  if (looksLikeDriveId(q)) {
    try {
      const file = await getFile(creds, q, { fields: RESOLVE_FIELDS })
      return { kind: 'ok', file }
    } catch (err) {
      if (!(err instanceof SystemError && err.code === 'http_404')) throw err
      // Not an id after all — fall through to a name search.
    }
  }

  const { files } = await listFiles(creds, {
    q: `${buildNameQuery(q)} and trashed = false`,
    pageSize: 50,
    fields: RESOLVE_LIST_FIELDS,
    ...listExtra,
  })
  return matchFileByName(files, q)
}
