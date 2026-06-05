import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetTokenCache } from '../core/google-auth'
import {
  GMAIL_API_BASE,
  draftGetUrl,
  draftsListUrl,
  getMessage,
  headerValue,
  labelGetUrl,
  labelsListUrl,
  listMessagesHydrated,
  mapWithConcurrency,
  messageGetUrl,
  messagesListUrl,
  profileUrl,
  readGmailConfig,
  summarizeMessage,
  threadGetUrl,
  threadsListUrl,
  type GmailConfig,
  type GmailMessage,
} from '../modules/gmail/client'

describe('messagesListUrl', () => {
  test('no options → bare endpoint', () => {
    expect(messagesListUrl()).toBe(`${GMAIL_API_BASE}/messages`)
  })

  test('encodes the Gmail q query verbatim', () => {
    const u = new URL(messagesListUrl({ q: 'is:unread from:boss newer_than:7d' }))
    expect(u.pathname).toBe('/gmail/v1/users/me/messages')
    expect(u.searchParams.get('q')).toBe('is:unread from:boss newer_than:7d')
    // spaces become + (or %20) — never a literal space
    expect(messagesListUrl({ q: 'a b' })).not.toContain(' ')
  })

  test('repeats labelIds as multiple params and sets paging fields', () => {
    const u = new URL(
      messagesListUrl({ labelIds: ['INBOX', 'UNREAD'], maxResults: 10, pageToken: 'NPT', includeSpamTrash: true }),
    )
    expect(u.searchParams.getAll('labelIds')).toEqual(['INBOX', 'UNREAD'])
    expect(u.searchParams.get('maxResults')).toBe('10')
    expect(u.searchParams.get('pageToken')).toBe('NPT')
    expect(u.searchParams.get('includeSpamTrash')).toBe('true')
  })

  test('omits includeSpamTrash when false', () => {
    expect(new URL(messagesListUrl({ includeSpamTrash: false })).searchParams.has('includeSpamTrash')).toBe(false)
  })
})

describe('messageGetUrl', () => {
  test('sets format and repeats metadataHeaders', () => {
    const u = new URL(messageGetUrl('m1', { format: 'metadata', metadataHeaders: ['From', 'Subject'] }))
    expect(u.pathname).toBe('/gmail/v1/users/me/messages/m1')
    expect(u.searchParams.get('format')).toBe('metadata')
    expect(u.searchParams.getAll('metadataHeaders')).toEqual(['From', 'Subject'])
  })

  test('URL-encodes the id', () => {
    expect(messageGetUrl('a/b c')).toContain('/messages/a%2Fb%20c')
  })

  test('bare id with no options', () => {
    expect(messageGetUrl('m1')).toBe(`${GMAIL_API_BASE}/messages/m1`)
  })
})

describe('other URL builders', () => {
  test('threadsListUrl mirrors messages list params', () => {
    const u = new URL(threadsListUrl({ q: 'subject:hi', maxResults: 5 }))
    expect(u.pathname).toBe('/gmail/v1/users/me/threads')
    expect(u.searchParams.get('q')).toBe('subject:hi')
    expect(u.searchParams.get('maxResults')).toBe('5')
  })

  test('threadGetUrl carries format', () => {
    expect(threadGetUrl('t1', { format: 'metadata' })).toBe(`${GMAIL_API_BASE}/threads/t1?format=metadata`)
    expect(threadGetUrl('t1')).toBe(`${GMAIL_API_BASE}/threads/t1`)
  })

  test('labels + profile endpoints', () => {
    expect(labelsListUrl()).toBe(`${GMAIL_API_BASE}/labels`)
    expect(labelGetUrl('INBOX')).toBe(`${GMAIL_API_BASE}/labels/INBOX`)
    expect(profileUrl()).toBe(`${GMAIL_API_BASE}/profile`)
  })

  test('drafts endpoints', () => {
    expect(draftsListUrl()).toBe(`${GMAIL_API_BASE}/drafts`)
    expect(new URL(draftsListUrl({ q: 'x', maxResults: 3 })).searchParams.get('maxResults')).toBe('3')
    expect(draftGetUrl('d1', { format: 'metadata' })).toBe(`${GMAIL_API_BASE}/drafts/d1?format=metadata`)
  })
})

describe('readGmailConfig', () => {
  test('pulls credentials from module config, coercing missing values to empty', () => {
    expect(readGmailConfig({ clientId: 'c', clientSecret: 's', refreshToken: 'r' })).toEqual({
      clientId: 'c',
      clientSecret: 's',
      refreshToken: 'r',
    })
    expect(readGmailConfig({})).toEqual({ clientId: '', clientSecret: '', refreshToken: '' })
  })
})

describe('headerValue / summarizeMessage', () => {
  const message: GmailMessage = {
    id: 'm1',
    threadId: 't1',
    labelIds: ['INBOX', 'UNREAD'],
    snippet: 'hello there',
    payload: {
      headers: [
        { name: 'Delivered-To', value: 'me@gmail.com' },
        { name: 'From', value: 'Boss <boss@example.com>' },
        { name: 'Subject', value: 'Q3 plan' },
        { name: 'Date', value: 'Mon, 1 Jun 2026 10:00:00 -0700' },
      ],
    },
  }

  test('headerValue is case-insensitive', () => {
    expect(headerValue(message, 'from')).toBe('Boss <boss@example.com>')
    expect(headerValue(message, 'SUBJECT')).toBe('Q3 plan')
    expect(headerValue(message, 'Cc')).toBeUndefined()
  })

  test('summarizeMessage flattens to the compact listing row', () => {
    expect(summarizeMessage(message)).toEqual({
      id: 'm1',
      threadId: 't1',
      from: 'Boss <boss@example.com>',
      to: undefined,
      subject: 'Q3 plan',
      date: 'Mon, 1 Jun 2026 10:00:00 -0700',
      snippet: 'hello there',
      labelIds: ['INBOX', 'UNREAD'],
    })
  })

  test('tolerates a message with no payload/headers', () => {
    const bare: GmailMessage = { id: 'm2' }
    expect(headerValue(bare, 'From')).toBeUndefined()
    expect(summarizeMessage(bare)).toEqual({
      id: 'm2',
      threadId: undefined,
      from: undefined,
      to: undefined,
      subject: undefined,
      date: undefined,
      snippet: undefined,
      labelIds: undefined,
    })
  })
})

describe('mapWithConcurrency', () => {
  test('caps in-flight tasks at the concurrency limit', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 20 }, (_, i) => i)
    await mapWithConcurrency(items, 8, async (i) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return i
    })
    expect(peak).toBe(8)
  })

  test('preserves input order and passes the index', async () => {
    const items = ['a', 'b', 'c']
    const out = await mapWithConcurrency(items, 2, async (s, i) => `${i}:${s.toUpperCase()}`)
    expect(out).toEqual(['0:A', '1:B', '2:C'])
  })

  test('empty input spins up no workers', async () => {
    expect(await mapWithConcurrency<number, number>([], 4, async (n) => n)).toEqual([])
  })
})

describe('network functions over mocked fetch', () => {
  const cfg: GmailConfig = { clientId: 'c', clientSecret: 's', refreshToken: 'r' }
  const originalFetch = globalThis.fetch

  const tokenResponse = () =>
    new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  beforeEach(() => resetTokenCache())
  afterEach(() => {
    globalThis.fetch = originalFetch
    resetTokenCache()
  })

  test('getMessage hits the per-message endpoint with a bearer token', async () => {
    let seenUrl = ''
    let seenAuth: string | undefined
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('oauth2.googleapis.com')) return tokenResponse()
      seenUrl = String(url)
      seenAuth = (init?.headers as Record<string, string>)?.Authorization
      return new Response(JSON.stringify({ id: 'm1', threadId: 't1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const msg = await getMessage(cfg, 'm1', { format: 'minimal' })
    expect(msg).toEqual({ id: 'm1', threadId: 't1' })
    expect(seenUrl).toBe(`${GMAIL_API_BASE}/messages/m1?format=minimal`)
    expect(seenAuth).toBe('Bearer tok')
  })

  test('listMessagesHydrated lists then fetches metadata per id and summarizes', async () => {
    const messagesById: Record<string, GmailMessage> = {
      m1: {
        id: 'm1',
        threadId: 't1',
        snippet: 'first',
        payload: { headers: [{ name: 'Subject', value: 'One' }, { name: 'From', value: 'a@x.com' }] },
      },
      m2: {
        id: 'm2',
        threadId: 't2',
        snippet: 'second',
        payload: { headers: [{ name: 'Subject', value: 'Two' }, { name: 'From', value: 'b@x.com' }] },
      },
    }

    const metadataCalls: string[] = []
    globalThis.fetch = (async (url: string) => {
      const s = String(url)
      if (s.includes('oauth2.googleapis.com')) return tokenResponse()
      const u = new URL(s)
      // list endpoint: path ends exactly with /messages
      if (u.pathname.endsWith('/messages')) {
        expect(u.searchParams.get('q')).toBe('is:unread')
        return new Response(
          JSON.stringify({
            messages: [{ id: 'm1', threadId: 't1' }, { id: 'm2', threadId: 't2' }],
            nextPageToken: 'NPT',
            resultSizeEstimate: 2,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      // per-message metadata get
      const id = u.pathname.split('/').pop()!
      metadataCalls.push(id)
      expect(u.searchParams.get('format')).toBe('metadata')
      expect(u.searchParams.getAll('metadataHeaders')).toEqual(['From', 'To', 'Subject', 'Date'])
      return new Response(JSON.stringify(messagesById[id]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const out = await listMessagesHydrated(cfg, { q: 'is:unread' })
    expect(metadataCalls.sort()).toEqual(['m1', 'm2'])
    expect(out.nextPageToken).toBe('NPT')
    expect(out.resultSizeEstimate).toBe(2)
    expect(out.messages).toEqual([
      { id: 'm1', threadId: 't1', from: 'a@x.com', to: undefined, subject: 'One', date: undefined, snippet: 'first', labelIds: undefined },
      { id: 'm2', threadId: 't2', from: 'b@x.com', to: undefined, subject: 'Two', date: undefined, snippet: 'second', labelIds: undefined },
    ])
  })

  test('listMessagesHydrated returns an empty page without per-message calls', async () => {
    let metadataCalls = 0
    globalThis.fetch = (async (url: string) => {
      const s = String(url)
      if (s.includes('oauth2.googleapis.com')) return tokenResponse()
      const u = new URL(s)
      if (u.pathname.endsWith('/messages')) {
        return new Response(JSON.stringify({ resultSizeEstimate: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      metadataCalls++
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const out = await listMessagesHydrated(cfg, {})
    expect(out.messages).toEqual([])
    expect(metadataCalls).toBe(0)
  })
})
