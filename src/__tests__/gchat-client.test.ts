import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  authedRequestJson,
  buildMemberGetUrl,
  buildMembersListUrl,
  buildMessageGetUrl,
  buildMessagesListUrl,
  buildSpaceGetUrl,
  buildSpacesListUrl,
  getAccessToken,
  looksLikeSpaceName,
  matchSpace,
  memberName,
  messageName,
  normalizeMember,
  normalizeMembersResponse,
  normalizeMessage,
  normalizeMessagesResponse,
  normalizeSpace,
  normalizeSpacesResponse,
  resetTokenCache,
  resolveSpace,
  type GchatConfig,
  type SpaceSummary,
} from '../modules/gchat/client'
import { listParamsFromArgs } from '../modules/gchat/commands/args'

const CFG: GchatConfig = { clientId: 'cid', clientSecret: 'csec', refreshToken: 'rtok' }

describe('URL builders', () => {
  test('spaces list encodes paging + filter params', () => {
    const url = buildSpacesListUrl({ pageSize: 20, pageToken: 'tok', filter: 'spaceType = "SPACE"' })
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://chat.googleapis.com/v1/spaces')
    expect(u.searchParams.get('pageSize')).toBe('20')
    expect(u.searchParams.get('pageToken')).toBe('tok')
    expect(u.searchParams.get('filter')).toBe('spaceType = "SPACE"')
  })

  test('spaces list with no params is the bare collection URL', () => {
    expect(buildSpacesListUrl()).toBe('https://chat.googleapis.com/v1/spaces')
  })

  test('space get appends the resource name without re-encoding the slash', () => {
    expect(buildSpaceGetUrl('spaces/AAAA')).toBe('https://chat.googleapis.com/v1/spaces/AAAA')
  })

  test('members list nests under the space resource name', () => {
    const u = new URL(buildMembersListUrl('spaces/AAAA', { pageSize: 5 }))
    expect(u.pathname).toBe('/v1/spaces/AAAA/members')
    expect(u.searchParams.get('pageSize')).toBe('5')
  })

  test('member get uses the full membership resource name', () => {
    expect(buildMemberGetUrl('spaces/AAAA/members/BBBB')).toBe(
      'https://chat.googleapis.com/v1/spaces/AAAA/members/BBBB',
    )
  })

  test('messages list carries filter + orderBy', () => {
    const u = new URL(buildMessagesListUrl('spaces/AAAA', { orderBy: 'createTime desc', filter: 'x' }))
    expect(u.pathname).toBe('/v1/spaces/AAAA/messages')
    expect(u.searchParams.get('orderBy')).toBe('createTime desc')
    expect(u.searchParams.get('filter')).toBe('x')
  })

  test('message get uses the full message resource name (dots preserved)', () => {
    expect(buildMessageGetUrl('spaces/AAAA/messages/CCCC.CCCC')).toBe(
      'https://chat.googleapis.com/v1/spaces/AAAA/messages/CCCC.CCCC',
    )
  })
})

describe('resource-name helpers', () => {
  test('looksLikeSpaceName recognises spaces/{id} but not display names', () => {
    expect(looksLikeSpaceName('spaces/AAAA')).toBe(true)
    expect(looksLikeSpaceName('  spaces/AAAA  ')).toBe(true)
    expect(looksLikeSpaceName('Engineering')).toBe(false)
    expect(looksLikeSpaceName('spaces/AAAA/members/BBBB')).toBe(false)
    expect(looksLikeSpaceName('')).toBe(false)
  })

  test('memberName combines a bare id with its space but passes full names through', () => {
    expect(memberName('spaces/AAAA', '1234')).toBe('spaces/AAAA/members/1234')
    expect(memberName('spaces/AAAA', 'spaces/ZZZZ/members/9999')).toBe('spaces/ZZZZ/members/9999')
  })

  test('messageName combines a bare id with its space but passes full names through', () => {
    expect(messageName('spaces/AAAA', 'CCCC.CCCC')).toBe('spaces/AAAA/messages/CCCC.CCCC')
    expect(messageName('spaces/AAAA', 'spaces/ZZZZ/messages/DD.DD')).toBe('spaces/ZZZZ/messages/DD.DD')
  })
})

describe('normalizers', () => {
  test('normalizeSpace trims to the LLM subset', () => {
    expect(
      normalizeSpace({
        name: 'spaces/AAAA',
        displayName: 'Engineering',
        spaceType: 'SPACE',
        spaceThreadingState: 'THREADED_MESSAGES',
        externalUserAllowed: false,
        createTime: '2024-01-01T00:00:00Z',
      }),
    ).toEqual({
      name: 'spaces/AAAA',
      displayName: 'Engineering',
      spaceType: 'SPACE',
      singleUserBotDm: undefined,
      threadingState: 'THREADED_MESSAGES',
      externalUserAllowed: false,
      createTime: '2024-01-01T00:00:00Z',
    })
  })

  test('normalizeSpace defaults a missing displayName to empty (DMs have none)', () => {
    expect(normalizeSpace({ name: 'spaces/DM', spaceType: 'DIRECT_MESSAGE' }).displayName).toBe('')
  })

  test('normalizeMember flattens the member sub-object', () => {
    expect(
      normalizeMember({
        name: 'spaces/AAAA/members/BBBB',
        state: 'JOINED',
        role: 'ROLE_MEMBER',
        member: { name: 'users/123', displayName: 'Jane', type: 'HUMAN', domainId: 'd1' },
        createTime: '2024-01-01T00:00:00Z',
      }),
    ).toEqual({
      name: 'spaces/AAAA/members/BBBB',
      state: 'JOINED',
      role: 'ROLE_MEMBER',
      member: { name: 'users/123', displayName: 'Jane', type: 'HUMAN' },
      createTime: '2024-01-01T00:00:00Z',
    })
  })

  test('normalizeMessage pulls thread/space names up and defaults text', () => {
    expect(
      normalizeMessage({
        name: 'spaces/AAAA/messages/CCCC.CCCC',
        text: 'hello',
        sender: { name: 'users/123', displayName: 'Jane', type: 'HUMAN' },
        createTime: '2024-01-01T00:00:00Z',
        thread: { name: 'spaces/AAAA/threads/TTTT' },
        space: { name: 'spaces/AAAA' },
      }),
    ).toEqual({
      name: 'spaces/AAAA/messages/CCCC.CCCC',
      text: 'hello',
      sender: { name: 'users/123', displayName: 'Jane', type: 'HUMAN' },
      createTime: '2024-01-01T00:00:00Z',
      lastUpdateTime: undefined,
      thread: 'spaces/AAAA/threads/TTTT',
      space: 'spaces/AAAA',
      argumentText: undefined,
    })
  })

  test('normalizeMessage tolerates a bare message (no sender/text)', () => {
    const out = normalizeMessage({ name: 'spaces/AAAA/messages/X' })
    expect(out.text).toBe('')
    expect(out.sender).toEqual({ name: undefined, displayName: undefined, type: undefined })
  })

  test('list normalizers map the envelope and carry nextPageToken', () => {
    expect(
      normalizeSpacesResponse({ spaces: [{ name: 'spaces/AAAA', displayName: 'Eng' }], nextPageToken: 'n1' }),
    ).toEqual({ spaces: [normalizeSpace({ name: 'spaces/AAAA', displayName: 'Eng' })], nextPageToken: 'n1' })

    expect(normalizeMembersResponse({ memberships: [{ name: 'spaces/AAAA/members/B' }] }).members).toHaveLength(1)
    expect(normalizeMessagesResponse({ messages: [{ name: 'spaces/AAAA/messages/C' }] }).messages).toHaveLength(1)
  })

  test('list normalizers default missing collections and filter null entries', () => {
    expect(normalizeSpacesResponse({})).toEqual({ spaces: [], nextPageToken: undefined })
    expect(
      normalizeSpacesResponse({ spaces: [null, { name: 'spaces/AAAA', displayName: 'Eng' }] as never }).spaces,
    ).toHaveLength(1)
  })
})

describe('matchSpace', () => {
  const spaces: SpaceSummary[] = [
    { name: 'spaces/AAAA', displayName: 'Engineering' },
    { name: 'spaces/BBBB', displayName: 'Engineering Leads' },
    { name: 'spaces/CCCC', displayName: 'Design' },
  ]

  test('exact resource name wins outright', () => {
    expect(matchSpace(spaces, 'spaces/BBBB')).toEqual({
      kind: 'ok',
      space: { name: 'spaces/BBBB', displayName: 'Engineering Leads' },
    })
  })

  test('exact display name (case-insensitive) beats the substring sibling', () => {
    expect(matchSpace(spaces, 'engineering')).toEqual({
      kind: 'ok',
      space: { name: 'spaces/AAAA', displayName: 'Engineering' },
    })
  })

  test('unique substring resolves', () => {
    expect(matchSpace(spaces, 'desi')).toEqual({
      kind: 'ok',
      space: { name: 'spaces/CCCC', displayName: 'Design' },
    })
  })

  test('non-unique substring is ambiguous with candidates', () => {
    const res = matchSpace(spaces, 'eng')
    expect(res.kind).toBe('ambiguous')
    if (res.kind === 'ambiguous') expect(res.matches.map((m) => m.name)).toEqual(['spaces/AAAA', 'spaces/BBBB'])
  })

  test('no match is not_found', () => {
    expect(matchSpace(spaces, 'marketing')).toEqual({ kind: 'not_found' })
  })
})

describe('listParamsFromArgs', () => {
  test('parses paging args and clamps pageSize to the max', () => {
    expect(listParamsFromArgs({ pageSize: 5000, pageToken: 't', filter: 'f' })).toEqual({
      params: { pageSize: 1000, pageToken: 't', filter: 'f' },
    })
  })

  test('rejects a non-positive pageSize', () => {
    expect(listParamsFromArgs({ pageSize: 0 })).toEqual({ error: 'pageSize must be a positive number' })
  })

  test('only reads orderBy when enabled', () => {
    expect(listParamsFromArgs({ orderBy: 'createTime desc' })).toEqual({ params: {} })
    expect(listParamsFromArgs({ orderBy: 'createTime desc' }, { orderBy: true })).toEqual({
      params: { orderBy: 'createTime desc' },
    })
  })
})

describe('getAccessToken', () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => resetTokenCache())
  afterEach(() => {
    globalThis.fetch = originalFetch
    resetTokenCache()
  })

  test('throws SystemError when any credential is missing', async () => {
    await expect(getAccessToken({ clientId: '', clientSecret: 'c', refreshToken: 'r' })).rejects.toThrow(/not configured/)
    await expect(getAccessToken({ clientId: 'c', clientSecret: '', refreshToken: 'r' })).rejects.toThrow(/not configured/)
    await expect(getAccessToken({ clientId: 'c', clientSecret: 'c', refreshToken: '' })).rejects.toThrow(/not configured/)
  })

  test('sends a refresh_token grant to the Google token endpoint', async () => {
    let url: string | undefined
    let init: RequestInit | undefined
    globalThis.fetch = (async (u: string, i?: RequestInit) => {
      url = String(u)
      init = i
      return new Response(JSON.stringify({ access_token: 'at', token_type: 'Bearer', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const token = await getAccessToken(CFG)
    expect(token).toBe('at')
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(init?.method).toBe('POST')
    const body = new URLSearchParams(String(init?.body))
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('client_id')).toBe('cid')
    expect(body.get('client_secret')).toBe('csec')
    expect(body.get('refresh_token')).toBe('rtok')
  })

  test('caches the token across calls', async () => {
    let tokenCalls = 0
    globalThis.fetch = (async (_u: string) => {
      tokenCalls++
      return new Response(JSON.stringify({ access_token: 'at', token_type: 'Bearer', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    await getAccessToken(CFG)
    await getAccessToken(CFG)
    expect(tokenCalls).toBe(1)
  })
})

describe('authedRequestJson 401 recovery', () => {
  const originalFetch = globalThis.fetch
  let fetchCalls: { url: string; init?: RequestInit }[]
  let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>

  const tokenResponse = (value: string) =>
    new Response(JSON.stringify({ access_token: value, token_type: 'Bearer', expires_in: 3600 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  beforeEach(() => {
    resetTokenCache()
    fetchCalls = []
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init })
      return fetchImpl(String(url), init)
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    resetTokenCache()
  })

  test('drops the cached token and retries once on 401', async () => {
    let tokenCalls = 0
    let apiCalls = 0
    fetchImpl = async (url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        tokenCalls++
        return tokenResponse(tokenCalls === 1 ? 'stale' : 'fresh')
      }
      apiCalls++
      if (apiCalls === 1) return new Response('unauthorized', { status: 401 })
      return new Response(JSON.stringify({ spaces: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const out = await authedRequestJson<{ spaces: unknown[] }>(CFG, 'https://chat.googleapis.com/v1/spaces')
    expect(out).toEqual({ spaces: [] })
    expect(tokenCalls).toBe(2)
    expect(apiCalls).toBe(2)
    expect(fetchCalls[1]!.init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer stale' }))
    expect(fetchCalls[3]!.init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer fresh' }))
  })

  test('does not retry on non-401 failures', async () => {
    let apiCalls = 0
    fetchImpl = async (url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) return tokenResponse('at')
      apiCalls++
      return new Response('forbidden', { status: 403 })
    }
    await expect(authedRequestJson(CFG, 'https://chat.googleapis.com/v1/spaces')).rejects.toThrow(/403/)
    expect(apiCalls).toBe(1)
  })
})

describe('resolveSpace', () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => resetTokenCache())
  afterEach(() => {
    globalThis.fetch = originalFetch
    resetTokenCache()
  })

  test('short-circuits a resource name without any network call', async () => {
    globalThis.fetch = (async (_u: string) => {
      throw new Error('fetch should not be called for a resource name')
    }) as unknown as typeof fetch
    expect(await resolveSpace(CFG, 'spaces/AAAA')).toEqual({ kind: 'ok', space: { name: 'spaces/AAAA' } })
  })

  test('resolves a display name by listing spaces', async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'at', token_type: 'Bearer', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          spaces: [
            { name: 'spaces/AAAA', displayName: 'Engineering' },
            { name: 'spaces/CCCC', displayName: 'Design' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    expect(await resolveSpace(CFG, 'design')).toEqual({
      kind: 'ok',
      space: { name: 'spaces/CCCC', displayName: 'Design' },
    })
  })
})
