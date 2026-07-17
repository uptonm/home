import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createTransport, pbQuote, readBeszelConfig, type BeszelConfig } from '../modules/beszel/client'
import { SYSTEM_UP, pbPage } from './beszel-fixtures'

const CFG: BeszelConfig = { url: 'http://hub.test', email: 'me@example.com', password: 'hunter22' }

interface SeenRequest {
  url: URL
  init: RequestInit | undefined
}

const realFetch = globalThis.fetch
let seen: SeenRequest[] = []

function stubFetch(handler: (url: URL, init?: RequestInit) => Response): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input))
    seen.push({ url, init })
    return handler(url, init)
  }) as typeof fetch
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function isAuth(url: URL): boolean {
  return url.pathname === '/api/collections/users/auth-with-password'
}

function authHeader(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.Authorization
}

beforeEach(() => {
  seen = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('readBeszelConfig', () => {
  test('rejects missing url/email/password with beszel_not_configured', () => {
    for (const cfg of [{}, { url: 'http://x' }, { url: 'http://x', email: 'a@b' }]) {
      expect(() => readBeszelConfig(cfg)).toThrow(expect.objectContaining({ code: 'beszel_not_configured' }))
    }
  })

  test('strips trailing slashes from the url', () => {
    expect(readBeszelConfig({ url: 'http://x/', email: 'a@b', password: 'p' }).url).toBe('http://x')
  })
})

describe('pbQuote', () => {
  test('quotes and escapes filter values', () => {
    expect(pbQuote('up')).toBe('"up"')
    expect(pbQuote('we"ird\\name')).toBe('"we\\"ird\\\\name"')
  })
})

describe('auth flow', () => {
  test('logs in once and reuses the token across list calls', async () => {
    stubFetch((url) => {
      if (isAuth(url)) return json({ token: 'tok1', record: { id: 'useraaaaaaaaaaa1' } })
      return json(pbPage([SYSTEM_UP]))
    })
    const t = createTransport(CFG)
    await t.list('systems', 10)
    await t.list('systems', 10)

    const authCalls = seen.filter((r) => isAuth(r.url))
    expect(authCalls).toHaveLength(1)
    expect(JSON.parse(String(authCalls[0]!.init?.body))).toEqual({ identity: CFG.email, password: CFG.password })
    const dataCalls = seen.filter((r) => !isAuth(r.url))
    expect(dataCalls).toHaveLength(2)
    expect(dataCalls.every((r) => authHeader(r.init) === 'tok1')).toBe(true)
  })

  test('re-authenticates once on 401 and retries the request', async () => {
    let authCount = 0
    stubFetch((url, init) => {
      if (isAuth(url)) {
        authCount++
        return json({ token: `tok${authCount}` })
      }
      if (authHeader(init) === 'tok1') {
        return json({ status: 401, message: 'The request requires valid record authorization token.' }, 401)
      }
      return json(pbPage([SYSTEM_UP]))
    })
    const t = createTransport(CFG)
    const items = await t.list('systems', 10)

    expect(authCount).toBe(2)
    expect(items).toHaveLength(1)
    const lastData = seen.filter((r) => !isAuth(r.url)).at(-1)
    expect(authHeader(lastData?.init)).toBe('tok2')
  })

  test('bad credentials → beszel_auth_failed', async () => {
    stubFetch(() => json({ status: 400, message: 'Failed to authenticate.' }, 400))
    expect(createTransport(CFG).list('systems', 10)).rejects.toMatchObject({ code: 'beszel_auth_failed' })
  })

  test('password auth disabled (OIDC-only hub) → beszel_auth_unavailable', async () => {
    stubFetch(() =>
      json({ status: 403, message: 'The collection is not configured to allow password authentication.' }, 403),
    )
    expect(createTransport(CFG).list('systems', 10)).rejects.toMatchObject({ code: 'beszel_auth_unavailable' })
  })

  test('login response without a token is an error, not a silent empty session', async () => {
    stubFetch(() => json({ record: {} }))
    expect(createTransport(CFG).list('systems', 10)).rejects.toMatchObject({ code: 'beszel_auth_failed' })
  })
})

describe('bounded pagination', () => {
  test('follows totalPages and stops when the collection is exhausted', async () => {
    stubFetch((url) => {
      if (isAuth(url)) return json({ token: 'tok1' })
      const page = Number(url.searchParams.get('page'))
      return json(pbPage([{ ...SYSTEM_UP, id: `sysaaaaaaaaaa${page}xx`.slice(0, 15) }], { page, totalPages: 3, totalItems: 3 }))
    })
    const t = createTransport(CFG)
    const items = await t.list('systems', 10)

    expect(items).toHaveLength(3)
    const pages = seen.filter((r) => !isAuth(r.url)).map((r) => r.url.searchParams.get('page'))
    expect(pages).toEqual(['1', '2', '3'])
  })

  test('stops at limit even when more pages exist, and truncates the overshoot', async () => {
    stubFetch((url) => {
      if (isAuth(url)) return json({ token: 'tok1' })
      const page = Number(url.searchParams.get('page'))
      const items = [0, 1].map((i) => ({ ...SYSTEM_UP, id: `sys${page}${i}aaaaaaaaaa` }))
      return json(pbPage(items, { page, totalPages: 50, totalItems: 100 }))
    })
    const t = createTransport(CFG)
    const items = await t.list('systems', 3)

    expect(items).toHaveLength(3)
    expect(seen.filter((r) => !isAuth(r.url))).toHaveLength(2)
    expect(seen.filter((r) => !isAuth(r.url))[0]!.url.searchParams.get('perPage')).toBe('3')
  })

  test('passes filter/sort/expand through as PocketBase query params', async () => {
    stubFetch((url) => (isAuth(url) ? json({ token: 'tok1' }) : json(pbPage([]))))
    const t = createTransport(CFG)
    await t.list('alerts', 5, { filter: 'triggered=true', sort: '-updated', expand: 'system' })

    const call = seen.find((r) => r.url.pathname === '/api/collections/alerts/records')!
    expect(call.url.searchParams.get('filter')).toBe('triggered=true')
    expect(call.url.searchParams.get('sort')).toBe('-updated')
    expect(call.url.searchParams.get('expand')).toBe('system')
  })

  test('count uses a one-record page and returns totalItems', async () => {
    stubFetch((url) => (isAuth(url) ? json({ token: 'tok1' }) : json(pbPage([SYSTEM_UP], { totalItems: 42 }))))
    const t = createTransport(CFG)
    expect(await t.count('alerts', 'triggered=true')).toBe(42)
    const call = seen.find((r) => !isAuth(r.url))!
    expect(call.url.searchParams.get('perPage')).toBe('1')
  })
})

describe('insecureTLS plumbing', () => {
  test('insecureTLS: true sets tls.rejectUnauthorized false on every request', async () => {
    stubFetch((url) => (isAuth(url) ? json({ token: 'tok1' }) : json(pbPage([]))))
    const t = createTransport({ ...CFG, insecureTLS: true })
    await t.list('systems', 5)

    expect(seen.length).toBeGreaterThanOrEqual(2)
    for (const r of seen) {
      expect((r.init as { tls?: { rejectUnauthorized?: boolean } }).tls?.rejectUnauthorized).toBe(false)
    }
  })

  test('default leaves TLS verification alone', async () => {
    stubFetch((url) => (isAuth(url) ? json({ token: 'tok1' }) : json(pbPage([]))))
    const t = createTransport(CFG)
    await t.list('systems', 5)
    for (const r of seen) {
      expect((r.init as { tls?: unknown }).tls).toBeUndefined()
    }
  })
})
