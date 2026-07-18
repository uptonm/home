import { request } from '../../core/http'
import type { ModuleConfig } from '../../core/types'
import { SystemError, UserError } from '../../core/errors'

export interface BeszelConfig {
  url: string
  email: string
  password: string
  insecureTLS?: boolean
}

export function readBeszelConfig(cfg: ModuleConfig): BeszelConfig {
  const url = String(cfg.url ?? '')
    .trim()
    .replace(/\/+$/, '')
  const email = String(cfg.email ?? '').trim()
  const password = String(cfg.password ?? '')
  if (!url || !email || !password) {
    throw new UserError('beszel is not configured — run `home beszel configure`', 'beszel_not_configured')
  }
  return { url, email, password, insecureTLS: Boolean(cfg.insecureTLS) }
}

/** A PocketBase record as the hub returns it — untyped beyond the id. Raw
 * records never cross the command boundary; the adapter normalizes them. */
export interface RawRecord {
  id?: string
  [key: string]: unknown
}

export interface ListOptions {
  filter?: string
  sort?: string
  fields?: string
  expand?: string
}

/**
 * Version-agnostic hub access. Commands and the adapter speak only to this
 * interface, so a future hub whose wire protocol changes needs a new transport,
 * not new commands.
 */
export interface BeszelTransport {
  /** Bounded list: pages through the collection until `limit` records or exhaustion. */
  list(collection: string, limit: number, opts?: ListOptions): Promise<RawRecord[]>
  /** Total matching records without fetching them (PocketBase totalItems). */
  count(collection: string, filter?: string): Promise<number>
}

/** Quote + escape a value for a PocketBase filter expression. */
export function pbQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const PER_PAGE_MAX = 500
/** Hard cap on pagination loops so a misbehaving hub can't spin forever. */
const MAX_PAGES = 20

interface PbListPage {
  page?: number
  totalItems?: number
  totalPages?: number
  items?: RawRecord[]
}

interface PbError {
  message?: string
  status?: number
}

/**
 * PocketBase transport for the 0.18.x hub. Regular-user password auth
 * (`POST /api/collections/users/auth-with-password`); the token lives in
 * memory on this transport — one login per CLI invocation, re-auth on 401.
 */
export function createTransport(cfg: BeszelConfig): BeszelTransport {
  let token: string | null = null

  async function authenticate(): Promise<string> {
    const res = await request(
      `${cfg.url}/api/collections/users/auth-with-password`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ identity: cfg.email, password: cfg.password }),
      },
      { insecureTLS: cfg.insecureTLS },
    )
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as PbError | null
      const message = body?.message ?? `HTTP ${res.status}`
      // The hub disables password auth when DISABLE_PASSWORD_AUTH is set
      // (OIDC-only); PocketBase then rejects with "The collection is not
      // configured to allow password authentication."
      if (/password authentication/i.test(message)) {
        throw new UserError(
          'Beszel hub has password login disabled (OIDC-only) — this module needs a user that can log in with a password',
          'beszel_auth_unavailable',
        )
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new UserError(`Beszel login failed for ${cfg.email}: ${message}`, 'beszel_auth_failed')
      }
      throw new SystemError(`Beszel login failed: HTTP ${res.status}: ${message}`, `beszel_http_${res.status}`)
    }
    const json = (await res.json().catch(() => null)) as { token?: string } | null
    if (!json?.token) throw new SystemError('Beszel login returned no token', 'beszel_auth_failed')
    return json.token
  }

  async function authedGet(path: string): Promise<Response> {
    if (!token) token = await authenticate()
    const get = () =>
      request(
        `${cfg.url}${path}`,
        { headers: { Authorization: token as string, Accept: 'application/json' } },
        { insecureTLS: cfg.insecureTLS },
      )
    let res = await get()
    if (res.status === 401) {
      token = await authenticate()
      res = await get()
    }
    return res
  }

  async function getPage(collection: string, page: number, perPage: number, opts?: ListOptions): Promise<PbListPage> {
    const qs = new URLSearchParams({ page: String(page), perPage: String(perPage) })
    if (opts?.filter) qs.set('filter', opts.filter)
    if (opts?.sort) qs.set('sort', opts.sort)
    if (opts?.fields) qs.set('fields', opts.fields)
    if (opts?.expand) qs.set('expand', opts.expand)
    const res = await authedGet(`/api/collections/${encodeURIComponent(collection)}/records?${qs}`)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as PbError | null
      throw new SystemError(
        `Beszel: HTTP ${res.status} from ${collection}${body?.message ? `: ${body.message}` : ''}`,
        `beszel_http_${res.status}`,
      )
    }
    return (await res.json()) as PbListPage
  }

  return {
    async list(collection, limit, opts) {
      const out: RawRecord[] = []
      const perPage = Math.min(limit, PER_PAGE_MAX)
      for (let page = 1; page <= MAX_PAGES; page++) {
        const json = await getPage(collection, page, perPage, opts)
        out.push(...(json.items ?? []))
        const totalPages = json.totalPages ?? page
        if (out.length >= limit || page >= totalPages) return out.slice(0, limit)
      }
      throw new SystemError(`gave up paging ${collection} after ${MAX_PAGES} pages`, 'beszel_pagination')
    },
    async count(collection, filter) {
      const json = await getPage(collection, 1, 1, { filter, fields: 'id' })
      return json.totalItems ?? json.items?.length ?? 0
    },
  }
}
