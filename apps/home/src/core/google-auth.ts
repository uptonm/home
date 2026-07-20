import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import type { AddressInfo } from 'node:net'
import { request, type HttpOptions } from './http'
import { NotConfiguredError, SystemError, UserError } from './errors'
import { loadModuleConfig } from './config'
import { getSecret } from './secrets'

/**
 * Shared Google OAuth 2.0 helper — the three-legged "installed app"
 * authorization-code flow plus refresh-token exchange. Designed to back every
 * Google-API module (`gdrive` today; `gmail` and `gchat` later): the mechanics
 * here are credential-source- and scope-agnostic. Each module supplies its own
 * `clientId` / `clientSecret` / `refreshToken` (from its own config + secrets
 * namespace) and its own scope list — the only per-module difference.
 *
 * Flow:
 *   1. `runInstalledAppOAuth` (interactive, configure-time) spins up a loopback
 *      server, opens the consent screen, captures the redirect's `code`, and
 *      exchanges it for a long-lived `refresh_token` (PKCE + `state` guarded).
 *   2. `getGoogleAccessToken` (per request) trades that refresh token for a
 *      short-lived bearer access token, cached in-memory until expiry.
 */

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

export interface GoogleOAuthCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
}

/** Module name owning the shared OAuth client — also its secret namespace. */
export const GOOGLE_MODULE = 'google'

/** The half of a credential set that every Google module shares. */
export interface GoogleClient {
  clientId: string
  clientSecret: string
}

/**
 * The OAuth client shared by every Google module, or null when `google` has not
 * been configured. One Cloud project's "Desktop app" client serves every Google
 * API, so the client half lives in one namespace while each module keeps its own
 * refresh token.
 */
export function readSharedGoogleClient(): GoogleClient | null {
  const cfg = loadModuleConfig(GOOGLE_MODULE)
  const clientId = String(cfg?.clientId ?? '')
  const clientSecret = getSecret(GOOGLE_MODULE, 'clientSecret') ?? ''
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

/**
 * Full credentials for `module`: the shared client plus that module's own
 * refresh token. Throws the typed errors a caller can branch on, each naming the
 * exact command that fixes it.
 */
export function requireGoogleCredentials(module: string): GoogleOAuthCredentials {
  const client = readSharedGoogleClient()
  // NotConfiguredError generates "module "x" is not configured — run
  // `home x configure`", which is already the exact remedy in both cases; only
  // the subject differs — the shared client, or this module's own grant.
  if (!client) throw new NotConfiguredError(GOOGLE_MODULE, 'google_unconfigured')
  const refreshToken = getSecret(module, 'refreshToken') ?? ''
  if (!refreshToken) throw new NotConfiguredError(module, 'google_unauthorized')
  return { ...client, refreshToken }
}

// ---------------------------------------------------------------------------
// Access-token cache (refresh-token grant)
// ---------------------------------------------------------------------------

interface CachedToken {
  value: string
  expiresAt: number
  /** Space-delimited scopes Google reported for this grant, or undefined if it didn't. */
  scope?: string
}

// Keyed by refresh token: gmail/gchat will hold *different* refresh tokens
// (separate consent grants with different scopes), so a per-credential cache
// keeps their access tokens from clobbering each other in a shared process.
const tokenCache = new Map<string, CachedToken>()
const TOKEN_REFRESH_MARGIN_MS = 60_000

/** Drop all cached access tokens so the next request re-refreshes. For tests/logout. */
export function resetGoogleTokenCache(): void {
  tokenCache.clear()
}

/** Expiry (ms since epoch) of the cached access token for these creds, or null. */
export function getCachedAccessTokenExpiry(creds: GoogleOAuthCredentials): number | null {
  return tokenCache.get(creds.refreshToken)?.expiresAt ?? null
}

interface RefreshTokenResponse {
  access_token: string
  expires_in?: number
  scope?: string
  token_type?: string
}

/**
 * Exchange the stored refresh token for a fresh access token, caching it until
 * ~60s before expiry. Throws a typed `SystemError` the caller can branch on:
 *   - `google_unconfigured`  — clientId/clientSecret absent (run `configure`)
 *   - `google_unauthorized`  — no refresh token (run the module's `configure`)
 *   - `google_refresh_rejected` — Google rejected the grant (revoked/expired)
 */
export async function getGoogleAccessToken(creds: GoogleOAuthCredentials): Promise<string> {
  if (!creds.clientId || !creds.clientSecret) {
    throw new SystemError('google clientId/clientSecret not configured', 'google_unconfigured')
  }
  if (!creds.refreshToken) {
    throw new SystemError("google refresh token missing — run the module's `configure` to authorize", 'google_unauthorized')
  }

  const cached = tokenCache.get(creds.refreshToken)
  if (cached && Date.now() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return cached.value
  }

  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await request(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // 400 invalid_grant / 401 → the refresh token itself is bad; surface a
    // distinct code so the module can tell the user to re-run its `configure`.
    const code = res.status === 400 || res.status === 401 ? 'google_refresh_rejected' : `http_${res.status}`
    throw new SystemError(
      `google token refresh failed (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`,
      code,
    )
  }
  const json = (await res.json()) as RefreshTokenResponse
  const token: CachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    scope: json.scope,
  }
  tokenCache.set(creds.refreshToken, token)
  return token.value
}

/**
 * The scopes Google actually granted for these credentials, split from the
 * refresh-grant response, or `null` when Google didn't report them. Triggers a
 * token refresh only if none is cached — so it's cheap right after any authed
 * request. Lets a module verify its refresh token still carries the write
 * scopes it needs, instead of discovering a stale read-only grant via a 403.
 */
export async function getGrantedScopes(creds: GoogleOAuthCredentials): Promise<string[] | null> {
  await getGoogleAccessToken(creds)
  const scope = tokenCache.get(creds.refreshToken)?.scope
  if (!scope) return null
  return scope.split(' ').filter(Boolean)
}

// ---------------------------------------------------------------------------
// Authenticated requests (bearer + single 401 retry)
// ---------------------------------------------------------------------------

/**
 * Run a bearer-authed request against a Google API. On a 401 (access token
 * revoked/rotated upstream) the cache is dropped and the request retried once
 * with a freshly refreshed token before the 401 is returned to the caller.
 * Returns the raw `Response` so callers can stream bytes (download/export) or
 * inspect status themselves; use `authedRequestJson` for JSON endpoints.
 */
export async function authedRequest(
  creds: GoogleOAuthCredentials,
  url: string,
  init: RequestInit = {},
  opts: HttpOptions = {},
): Promise<Response> {
  const withBearer = (token: string): RequestInit => ({
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  })
  const token = await getGoogleAccessToken(creds)
  const res = await request(url, withBearer(token), opts)
  if (res.status !== 401) return res
  // 401 → token no longer accepted; refresh once and retry.
  tokenCache.delete(creds.refreshToken)
  const fresh = await getGoogleAccessToken(creds)
  return request(url, withBearer(fresh), opts)
}

/** `authedRequest` + ok-check + JSON parse, throwing `http_<status>` on failure (mirrors core/http requestJson). */
export async function authedRequestJson<T>(
  creds: GoogleOAuthCredentials,
  url: string,
  init: RequestInit = {},
  opts: HttpOptions = {},
): Promise<T> {
  const res = await authedRequest(creds, url, init, opts)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new SystemError(
      `HTTP ${res.status} ${res.statusText} from ${url}${body ? `: ${body.slice(0, 200)}` : ''}`,
      `http_${res.status}`,
    )
  }
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Authorization-code flow (interactive, configure-time)
// ---------------------------------------------------------------------------

/** Base64url with no padding (RFC 7636 PKCE / state encoding). */
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface PkcePair {
  verifier: string
  challenge: string
}

/** Generate a PKCE verifier/challenge pair (S256). */
export function generatePkce(): PkcePair {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** A random URL-safe value for the OAuth `state` (CSRF) parameter. */
export function generateState(): string {
  return base64url(randomBytes(16))
}

export interface AuthUrlParams {
  clientId: string
  redirectUri: string
  scopes: string[]
  state: string
  codeChallenge: string
  /** Pre-fill the account chooser (the user's email), if known. */
  loginHint?: string
}

/**
 * Build the consent-screen URL. `access_type=offline` + `prompt=consent` are
 * what make Google return a refresh token (and re-issue one even if the user
 * has authorized this client before).
 */
export function buildAuthUrl(p: AuthUrlParams): string {
  const params = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: p.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
  })
  if (p.loginHint) params.set('login_hint', p.loginHint)
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`
}

/**
 * Pull the authorization `code` out of the loopback redirect, validating the
 * `state` to defeat CSRF. `rawUrl` is the server request URL (path + query);
 * a relative value is resolved against a dummy origin so only the query
 * matters. Throws a `UserError` on denial / mismatch / missing code.
 */
export function parseAuthRedirect(rawUrl: string, expectedState: string): { code: string } {
  const u = new URL(rawUrl, 'http://127.0.0.1')
  const error = u.searchParams.get('error')
  if (error) throw new UserError(`authorization failed: ${error}`, 'google_auth_denied')
  const state = u.searchParams.get('state')
  if (state !== expectedState) throw new UserError('OAuth state mismatch — possible CSRF, aborting', 'google_state_mismatch')
  const code = u.searchParams.get('code')
  if (!code) throw new UserError('no authorization code in redirect', 'google_no_code')
  return { code }
}

/**
 * Interpret a line the user pasted into the terminal when the loopback
 * redirect couldn't reach this machine (browser on another host). Accepts the
 * full redirect URL from the browser's address bar (state validated, same as
 * the loopback path) or a bare authorization code. A bare code carries no
 * state to check — it is useless without the in-process PKCE verifier, and
 * the user typing it is the consent. Throws `UserError` on anything else.
 */
export function parsePastedRedirect(input: string, expectedState: string): { code: string } {
  const trimmed = input.trim()
  if (/^https?:\/\//.test(trimmed)) return parseAuthRedirect(trimmed, expectedState)
  if (/^[\w/-]+$/.test(trimmed) && trimmed.length > 0) return { code: trimmed }
  throw new UserError(
    "unrecognized input — paste the full redirect URL from the browser's address bar",
    'google_paste_unrecognized',
  )
}

export interface ExchangeCodeParams {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
  codeVerifier: string
}

export interface TokenSet {
  refreshToken: string
  accessToken: string
  expiresIn: number
  scope?: string
}

interface CodeExchangeResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

/** Exchange an authorization `code` (+ PKCE verifier) for a token set including the refresh token. */
export async function exchangeCodeForTokens(p: ExchangeCodeParams): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: p.clientId,
    client_secret: p.clientSecret,
    code: p.code,
    redirect_uri: p.redirectUri,
    code_verifier: p.codeVerifier,
    grant_type: 'authorization_code',
  })
  const res = await request(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new SystemError(
      `google code exchange failed (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`,
      'google_code_exchange_failed',
    )
  }
  const json = (await res.json()) as CodeExchangeResponse
  if (!json.refresh_token) {
    // Google omits refresh_token if the user previously consented without a
    // fresh `prompt=consent`; we always send it, so this is rare — but surface
    // it clearly so the user can revoke the prior grant and retry.
    throw new SystemError(
      'google did not return a refresh_token — revoke the existing grant at https://myaccount.google.com/permissions and retry',
      'google_no_refresh_token',
    )
  }
  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    expiresIn: json.expires_in ?? 3600,
    scope: json.scope,
  }
}

// ---------------------------------------------------------------------------
// Loopback installed-app orchestration (the interactive shell)
// ---------------------------------------------------------------------------

const SUCCESS_HTML =
  '<!doctype html><meta charset="utf-8"><title>Authorized</title>' +
  '<body style="font-family:system-ui;padding:3rem"><h2>✅ Authorization complete</h2>' +
  '<p>You can close this tab and return to the terminal.</p></body>'

function errorHtml(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    '<!doctype html><meta charset="utf-8"><title>Authorization failed</title>' +
    `<body style="font-family:system-ui;padding:3rem"><h2>❌ Authorization failed</h2><p>${escapeHtml(msg)}</p></body>`
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** Best-effort browser launch; failures are swallowed (the URL is always printed too). */
function tryOpenBrowser(url: string): void {
  // Over SSH, xdg-open would at best fail and at worst open a browser on a
  // forwarded X display the user isn't looking at — the paste fallback is
  // the real path there.
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) return
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' })
    child.on('error', () => {})
    child.unref()
  } catch {
    /* no browser available — the printed URL is the fallback */
  }
}

export interface InstalledAppFlowOptions {
  clientId: string
  clientSecret: string
  scopes: string[]
  /** Try to open the system browser automatically (default true). */
  openBrowser?: boolean
  loginHint?: string
  /** How long to wait for the redirect before giving up (default 5 min). */
  timeoutMs?: number
  /** Where to print the consent URL / progress. Defaults to stderr. */
  notify?: (message: string) => void
}

/**
 * Drive the full interactive authorization-code flow on a loopback redirect
 * (Google "Desktop app" client type — `http://127.0.0.1:<ephemeral-port>` is
 * accepted without pre-registration). Opens the consent screen, captures the
 * redirect, and returns the resulting token set (caller persists the refresh
 * token). This is the one inherently non-headless piece — it needs a human at
 * a browser — so it lives apart from the pure, unit-tested helpers above.
 */
export function runInstalledAppOAuth(opts: InstalledAppFlowOptions): Promise<TokenSet> {
  const notify = opts.notify ?? ((m: string) => process.stderr.write(m + '\n'))
  const openBrowser = opts.openBrowser ?? true
  const timeoutMs = opts.timeoutMs ?? 300_000
  const state = generateState()
  const { verifier, challenge } = generatePkce()

  return new Promise<TokenSet>((resolve, reject) => {
    let redirectUri = ''
    let settled = false
    let stdinReader: Interface | undefined
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      stdinReader?.close()
      fn()
    }

    const settleWithCode = async (code: string) => {
      const tokens = await exchangeCodeForTokens({
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        code,
        redirectUri,
        codeVerifier: verifier,
      })
      return tokens
    }

    const server = createServer(async (req, res) => {
      // The browser fetches /favicon.ico too; only the root path carries the code.
      const url = req.url ?? '/'
      if (!url.startsWith('/?') && url !== '/') {
        res.writeHead(404)
        res.end()
        return
      }
      try {
        const { code } = parseAuthRedirect(url, state)
        const tokens = await settleWithCode(code)
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(SUCCESS_HTML)
        finish(() => resolve(tokens))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(errorHtml(err))
        finish(() => reject(err))
      }
    })

    const timer = setTimeout(
      () => finish(() => reject(new SystemError('timed out waiting for browser authorization', 'google_auth_timeout'))),
      timeoutMs,
    )

    server.on('error', (err) => finish(() => reject(err)))
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null
      const port = addr ? addr.port : 0
      redirectUri = `http://127.0.0.1:${port}/`
      const authUrl = buildAuthUrl({
        clientId: opts.clientId,
        redirectUri,
        scopes: opts.scopes,
        state,
        codeChallenge: challenge,
        loginHint: opts.loginHint,
      })
      notify('Open this URL in your browser to authorize access:')
      notify('')
      notify(authUrl)
      notify('')
      notify('Waiting for authorization…')
      if (process.stdin.isTTY) {
        notify("If the browser can't reach this machine (e.g. you're on SSH), paste the")
        notify('full redirect URL from its address bar here and press Enter.')
        stdinReader = createInterface({ input: process.stdin })
        stdinReader.on('line', (line) => {
          if (settled || !line.trim()) return
          void (async () => {
            try {
              const { code } = parsePastedRedirect(line, state)
              const tokens = await settleWithCode(code)
              finish(() => resolve(tokens))
            } catch (err) {
              // A typo or stale paste shouldn't kill the live flow — report
              // and keep both paths open. Only a spent code (exchange
              // failure) ends it: that authorization is gone either way.
              if (err instanceof UserError) {
                notify(`✗ ${err.message}`)
                return
              }
              finish(() => reject(err))
            }
          })()
        })
      }
      if (openBrowser) tryOpenBrowser(authUrl)
    })
  })
}
