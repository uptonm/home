import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetGoogleTokenCache } from '../core/google-auth'
import {
  GMAIL_API_BASE,
  GMAIL_MODIFY_SCOPE,
  GMAIL_SCOPES,
  GMAIL_SETTINGS_BASIC_SCOPE,
  batchModifyMessages,
  chunk,
  createFilter,
  createLabel,
  deleteFilter,
  filterDeleteUrl,
  filtersListUrl,
  listFilters,
  messageTrashUrl,
  messageUntrashUrl,
  messagesBatchModifyUrl,
  trashMessages,
  untrashMessages,
  type GmailConfig,
} from '../modules/gmail/client'

describe('scope constants', () => {
  test('GMAIL_SCOPES grants modify + settings.basic (write spine), not just readonly', () => {
    expect(GMAIL_MODIFY_SCOPE).toBe('https://www.googleapis.com/auth/gmail.modify')
    expect(GMAIL_SETTINGS_BASIC_SCOPE).toBe('https://www.googleapis.com/auth/gmail.settings.basic')
    expect(GMAIL_SCOPES).toEqual([GMAIL_MODIFY_SCOPE, GMAIL_SETTINGS_BASIC_SCOPE])
  })
})

describe('chunk', () => {
  test('splits into fixed-size groups, last one short', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
  test('exact multiple yields full groups only', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })
  test('empty input yields no groups', () => {
    expect(chunk([], 1000)).toEqual([])
  })
})

describe('write URL builders', () => {
  test('messagesBatchModifyUrl', () => {
    expect(messagesBatchModifyUrl()).toBe(`${GMAIL_API_BASE}/messages/batchModify`)
  })
  test('messageTrashUrl encodes the id', () => {
    expect(messageTrashUrl('m1')).toBe(`${GMAIL_API_BASE}/messages/m1/trash`)
    expect(messageTrashUrl('a/b')).toBe(`${GMAIL_API_BASE}/messages/a%2Fb/trash`)
  })
  test('messageUntrashUrl encodes the id', () => {
    expect(messageUntrashUrl('m1')).toBe(`${GMAIL_API_BASE}/messages/m1/untrash`)
    expect(messageUntrashUrl('a/b')).toBe(`${GMAIL_API_BASE}/messages/a%2Fb/untrash`)
  })
  test('filters endpoints', () => {
    expect(filtersListUrl()).toBe(`${GMAIL_API_BASE}/settings/filters`)
    expect(filterDeleteUrl('f1')).toBe(`${GMAIL_API_BASE}/settings/filters/f1`)
  })
})

describe('network write functions over mocked fetch', () => {
  const cfg: GmailConfig = { clientId: 'c', clientSecret: 's', refreshToken: 'r' }
  const originalFetch = globalThis.fetch
  const tokenResponse = () =>
    new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  beforeEach(() => resetGoogleTokenCache())
  afterEach(() => {
    globalThis.fetch = originalFetch
    resetGoogleTokenCache()
  })

  test('batchModifyMessages posts one batch per <=1000-id chunk with the label deltas', async () => {
    const bodies: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const s = String(url)
      if (s.includes('oauth2.googleapis.com')) return tokenResponse()
      expect(s).toBe(`${GMAIL_API_BASE}/messages/batchModify`)
      expect(init?.method).toBe('POST')
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(null, { status: 204 })
    }) as typeof fetch

    const ids = Array.from({ length: 1500 }, (_, i) => `m${i}`)
    const affected = await batchModifyMessages(cfg, { ids, removeLabelIds: ['INBOX', 'UNREAD'] })

    expect(affected).toBe(1500)
    expect(bodies.length).toBe(2)
    expect(bodies[0]!.ids).toHaveLength(1000)
    expect(bodies[1]!.ids).toHaveLength(500)
    expect(bodies[0]!.removeLabelIds).toEqual(['INBOX', 'UNREAD'])
    expect(bodies[0]!.addLabelIds).toBeUndefined()
  })

  test('batchModifyMessages makes no request for an empty id set', async () => {
    let calls = 0
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('oauth2.googleapis.com')) return tokenResponse()
      calls++
      return new Response(null, { status: 204 })
    }) as typeof fetch

    expect(await batchModifyMessages(cfg, { ids: [], addLabelIds: ['X'] })).toBe(0)
    expect(calls).toBe(0)
  })

  test('trashMessages POSTs each id to its trash endpoint', async () => {
    const trashed: string[] = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const s = String(url)
      if (s.includes('oauth2.googleapis.com')) return tokenResponse()
      expect(init?.method).toBe('POST')
      const u = new URL(s)
      expect(u.pathname.endsWith('/trash')).toBe(true)
      trashed.push(u.pathname.split('/').slice(-2, -1)[0]!)
      return new Response(JSON.stringify({ id: 'x' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const affected = await trashMessages(cfg, ['m1', 'm2', 'm3'])
    expect(affected).toBe(3)
    expect(trashed.sort()).toEqual(['m1', 'm2', 'm3'])
  })

  test('untrashMessages POSTs each id to its untrash endpoint', async () => {
    const restored: string[] = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const s = String(url)
      if (s.includes('oauth2.googleapis.com')) return tokenResponse()
      expect(init?.method).toBe('POST')
      const u = new URL(s)
      expect(u.pathname.endsWith('/untrash')).toBe(true)
      restored.push(u.pathname.split('/').slice(-2, -1)[0]!)
      return new Response(JSON.stringify({ id: 'x' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const affected = await untrashMessages(cfg, ['m1', 'm2'])
    expect(affected).toBe(2)
    expect(restored.sort()).toEqual(['m1', 'm2'])
  })

  test('createLabel posts the name and returns the created label', async () => {
    let body: Record<string, unknown> = {}
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const s = String(url)
      if (s.includes('oauth2.googleapis.com')) return tokenResponse()
      expect(s).toBe(`${GMAIL_API_BASE}/labels`)
      expect(init?.method).toBe('POST')
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ id: 'Label_9', name: body.name, type: 'user' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const label = await createLabel(cfg, { name: 'Newsletters' })
    expect(body.name).toBe('Newsletters')
    expect(label).toEqual({ id: 'Label_9', name: 'Newsletters', type: 'user' })
  })

  test('listFilters returns the filter array', async () => {
    globalThis.fetch = (async (url: string) => {
      const s = String(url)
      if (s.includes('oauth2.googleapis.com')) return tokenResponse()
      expect(s).toBe(`${GMAIL_API_BASE}/settings/filters`)
      return new Response(JSON.stringify({ filter: [{ id: 'f1', criteria: { from: 'x@y.com' }, action: { addLabelIds: ['Label_1'] } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const res = await listFilters(cfg)
    expect(res.filter).toEqual([{ id: 'f1', criteria: { from: 'x@y.com' }, action: { addLabelIds: ['Label_1'] } }])
  })

  test('createFilter posts criteria + action and returns the created filter', async () => {
    let body: Record<string, unknown> = {}
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const s = String(url)
      if (s.includes('oauth2.googleapis.com')) return tokenResponse()
      expect(s).toBe(`${GMAIL_API_BASE}/settings/filters`)
      expect(init?.method).toBe('POST')
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ id: 'f2', ...body }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const filter = await createFilter(cfg, { criteria: { from: 'news@shop.com' }, action: { removeLabelIds: ['INBOX'], addLabelIds: ['Label_3'] } })
    expect(body).toEqual({ criteria: { from: 'news@shop.com' }, action: { removeLabelIds: ['INBOX'], addLabelIds: ['Label_3'] } })
    expect(filter.id).toBe('f2')
  })

  test('deleteFilter issues a DELETE to the filter id', async () => {
    let seen = ''
    let method = ''
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const s = String(url)
      if (s.includes('oauth2.googleapis.com')) return tokenResponse()
      seen = s
      method = String(init?.method)
      return new Response(null, { status: 204 })
    }) as typeof fetch

    await deleteFilter(cfg, 'f1')
    expect(seen).toBe(`${GMAIL_API_BASE}/settings/filters/f1`)
    expect(method).toBe('DELETE')
  })
})
