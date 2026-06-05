import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  authedRequestJson,
  buildAuthUrl,
  exchangeCodeForTokens,
  generatePkce,
  generateState,
  getGoogleAccessToken,
  parseAuthRedirect,
  resetGoogleTokenCache,
  type GoogleOAuthCredentials,
} from '../core/google-auth'

const base64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('buildAuthUrl', () => {
  const challenge = 'CHALLENGE'
  test('encodes the offline + consent + PKCE installed-app params', () => {
    const url = buildAuthUrl({
      clientId: 'cid.apps.googleusercontent.com',
      redirectUri: 'http://127.0.0.1:54321/',
      scopes: ['https://www.googleapis.com/auth/drive.readonly', 'openid'],
      state: 'st8',
      codeChallenge: challenge,
    })
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('client_id')).toBe('cid.apps.googleusercontent.com')
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:54321/')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.readonly openid')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toBe('consent')
    expect(u.searchParams.get('state')).toBe('st8')
    expect(u.searchParams.get('code_challenge')).toBe(challenge)
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
  })

  test('omits login_hint unless provided', () => {
    expect(new URL(buildAuthUrl({ clientId: 'c', redirectUri: 'http://127.0.0.1/', scopes: ['s'], state: 'x', codeChallenge: 'y' })).searchParams.has('login_hint')).toBe(false)
    const withHint = new URL(buildAuthUrl({ clientId: 'c', redirectUri: 'http://127.0.0.1/', scopes: ['s'], state: 'x', codeChallenge: 'y', loginHint: 'me@example.com' }))
    expect(withHint.searchParams.get('login_hint')).toBe('me@example.com')
  })
})

describe('generatePkce', () => {
  test('challenge is the S256 hash of the verifier, base64url with no padding', () => {
    const { verifier, challenge } = generatePkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).toBe(base64url(createHash('sha256').update(verifier).digest()))
  })

  test('produces a fresh verifier each call', () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier)
  })
})

describe('generateState', () => {
  test('is non-empty url-safe and varies per call', () => {
    const a = generateState()
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a).not.toBe(generateState())
  })
})

describe('parseAuthRedirect', () => {
  test('returns the code when state matches (relative redirect url)', () => {
    expect(parseAuthRedirect('/?state=abc&code=4/xyz', 'abc')).toEqual({ code: '4/xyz' })
  })

  test('throws on state mismatch (CSRF guard)', () => {
    expect(() => parseAuthRedirect('/?state=evil&code=c', 'abc')).toThrow(/state mismatch/)
  })

  test('throws on an error redirect (access denied)', () => {
    expect(() => parseAuthRedirect('/?error=access_denied&state=abc', 'abc')).toThrow(/access_denied/)
  })

  test('throws when no code is present', () => {
    expect(() => parseAuthRedirect('/?state=abc', 'abc')).toThrow(/no authorization code/)
  })
})

describe('getGoogleAccessToken', () => {
  const creds: GoogleOAuthCredentials = { clientId: 'cid', clientSecret: 'csec', refreshToken: 'rtok' }
  const originalFetch = globalThis.fetch

  beforeEach(() => resetGoogleTokenCache())
  afterEach(() => {
    globalThis.fetch = originalFetch
    resetGoogleTokenCache()
  })

  test('throws google_unconfigured when client credentials are missing', async () => {
    await expect(getGoogleAccessToken({ clientId: '', clientSecret: 'x', refreshToken: 'r' })).rejects.toThrow(/not configured/)
  })

  test('throws google_unauthorized when the refresh token is missing', async () => {
    await expect(getGoogleAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: '' })).rejects.toThrow(/refresh token missing/)
  })

  test('posts a refresh_token grant and caches the access token', async () => {
    let tokenCalls = 0
    let lastBody: string | undefined
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      tokenCalls++
      lastBody = String(init?.body)
      return new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600, scope: 'drive.readonly' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    expect(await getGoogleAccessToken(creds)).toBe('at-1')
    expect(await getGoogleAccessToken(creds)).toBe('at-1') // served from cache
    expect(tokenCalls).toBe(1)
    const body = new URLSearchParams(lastBody)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('rtok')
    expect(body.get('client_id')).toBe('cid')
    expect(body.get('client_secret')).toBe('csec')
  })

  test('maps a 400 invalid_grant onto google_refresh_rejected', async () => {
    globalThis.fetch = (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as typeof fetch
    await expect(getGoogleAccessToken(creds)).rejects.toThrow(/token refresh failed/)
  })

  test('separate refresh tokens get separate cache entries', async () => {
    const seen: string[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const rt = new URLSearchParams(String(init?.body)).get('refresh_token') ?? ''
      seen.push(rt)
      return new Response(JSON.stringify({ access_token: `at-${rt}`, expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    expect(await getGoogleAccessToken({ ...creds, refreshToken: 'rA' })).toBe('at-rA')
    expect(await getGoogleAccessToken({ ...creds, refreshToken: 'rB' })).toBe('at-rB')
    expect(await getGoogleAccessToken({ ...creds, refreshToken: 'rA' })).toBe('at-rA') // still cached
    expect(seen).toEqual(['rA', 'rB'])
  })
})

describe('authedRequestJson', () => {
  const creds: GoogleOAuthCredentials = { clientId: 'cid', clientSecret: 'csec', refreshToken: 'rtok' }
  const originalFetch = globalThis.fetch
  let calls: { url: string; init?: RequestInit }[]

  beforeEach(() => {
    resetGoogleTokenCache()
    calls = []
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    resetGoogleTokenCache()
  })

  const tokenResponse = (value: string) =>
    new Response(JSON.stringify({ access_token: value, expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  test('attaches a bearer token and returns parsed JSON', async () => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) return tokenResponse('at-1')
      return new Response(JSON.stringify({ files: [{ id: 'f1' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const out = await authedRequestJson<{ files: { id: string }[] }>(creds, 'https://www.googleapis.com/drive/v3/files')
    expect(out.files[0]!.id).toBe('f1')
    const apiCall = calls.find((c) => c.url.includes('/drive/v3/files'))!
    expect((apiCall.init?.headers as Record<string, string>).Authorization).toBe('Bearer at-1')
  })

  test('drops the cached token and retries once on 401', async () => {
    let tokenCalls = 0
    let apiCalls = 0
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        tokenCalls++
        return tokenResponse(tokenCalls === 1 ? 'stale' : 'fresh')
      }
      apiCalls++
      if (apiCalls === 1) return new Response('unauthorized', { status: 401 })
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const out = await authedRequestJson<{ ok: boolean }>(creds, 'https://www.googleapis.com/drive/v3/about')
    expect(out).toEqual({ ok: true })
    expect(tokenCalls).toBe(2)
    expect(apiCalls).toBe(2)
    const apiAuthHeaders = calls.filter((c) => c.url.includes('/drive/v3/about')).map((c) => (c.init?.headers as Record<string, string>).Authorization)
    expect(apiAuthHeaders).toEqual(['Bearer stale', 'Bearer fresh'])
  })

  test('throws http_<status> and does not retry on a non-401 failure', async () => {
    let apiCalls = 0
    globalThis.fetch = (async (url: string) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) return tokenResponse('at')
      apiCalls++
      return new Response('not found', { status: 404 })
    }) as typeof fetch

    await expect(authedRequestJson(creds, 'https://www.googleapis.com/drive/v3/files/x')).rejects.toThrow(/404/)
    expect(apiCalls).toBe(1)
  })
})

describe('exchangeCodeForTokens', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('posts an authorization_code grant and returns the token set', async () => {
    let body: string | undefined
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      body = String(init?.body)
      return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: 'drive.readonly' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const out = await exchangeCodeForTokens({ clientId: 'c', clientSecret: 's', code: '4/abc', redirectUri: 'http://127.0.0.1:5/', codeVerifier: 'ver' })
    expect(out).toEqual({ refreshToken: 'rt', accessToken: 'at', expiresIn: 3599, scope: 'drive.readonly' })
    const p = new URLSearchParams(body)
    expect(p.get('grant_type')).toBe('authorization_code')
    expect(p.get('code')).toBe('4/abc')
    expect(p.get('code_verifier')).toBe('ver')
    expect(p.get('redirect_uri')).toBe('http://127.0.0.1:5/')
  })

  test('throws when Google omits the refresh_token', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
    await expect(exchangeCodeForTokens({ clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'http://127.0.0.1/', codeVerifier: 'v' })).rejects.toThrow(/did not return a refresh_token/)
  })

  test('throws on a non-ok exchange', async () => {
    globalThis.fetch = (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as typeof fetch
    await expect(exchangeCodeForTokens({ clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'http://127.0.0.1/', codeVerifier: 'v' })).rejects.toThrow(/code exchange failed/)
  })
})
