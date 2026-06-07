import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getMessagesCmd } from '../commands/get-messages'

describe('getMessagesCmd', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    // nothing
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('fetches messages with default limit and shapes response', async () => {
    globalThis.fetch = (async (url: string, _init?: RequestInit) => {
      expect(String(url)).toContain('/channels/chan123/messages')
      expect(String(url)).toContain('limit=25')
      return new Response(
        JSON.stringify([
          {
            id: 'm1',
            author: { username: 'alice' },
            content: 'Hello',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'm2',
            author: { username: 'bob' },
            content: 'Hi there',
            timestamp: '2024-01-01T00:01:00.000Z',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const result = await getMessagesCmd.run({
      args: { channelId: 'chan123' },
      json: true,
      quiet: true,
      verbose: false,
      log: {} as any,
      config: { botToken: 't', guildId: '' },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const data = result.data as { id: string; author: { username: string }; content: string; timestamp: string }[]
      expect(data).toHaveLength(2)
      expect(data[0]).toEqual({
        id: 'm1',
        author: { username: 'alice' },
        content: 'Hello',
        timestamp: '2024-01-01T00:00:00.000Z',
      })
      expect(data[1]).toEqual({
        id: 'm2',
        author: { username: 'bob' },
        content: 'Hi there',
        timestamp: '2024-01-01T00:01:00.000Z',
      })
    }
  })

  test('respects custom --limit parameter', async () => {
    let seenUrl = ''
    globalThis.fetch = (async (url: string, _init?: RequestInit) => {
      seenUrl = String(url)
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as unknown as typeof fetch

    const result = await getMessagesCmd.run({
      args: { channelId: 'chan123', limit: 50 },
      json: true,
      quiet: true,
      verbose: false,
      log: {} as any,
      config: { botToken: 't', guildId: '' },
    })

    expect(result.ok).toBe(true)
    expect(seenUrl).toContain('limit=50')
  })

  test('caps limit at 100', async () => {
    let seenUrl = ''
    globalThis.fetch = (async (url: string, _init?: RequestInit) => {
      seenUrl = String(url)
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as unknown as typeof fetch

    const result = await getMessagesCmd.run({
      args: { channelId: 'chan123', limit: 500 },
      json: true,
      quiet: true,
      verbose: false,
      log: {} as any,
      config: { botToken: 't', guildId: '' },
    })

    expect(result.ok).toBe(true)
    expect(seenUrl).toContain('limit=100')
    expect(seenUrl).not.toContain('limit=500')
  })

  test('returns user error when channelId is missing', async () => {
    const result = await getMessagesCmd.run({
      args: {},
      json: true,
      quiet: true,
      verbose: false,
      log: {} as any,
      config: { botToken: 't', guildId: '' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('user')
      expect(result.code).toBe('missing_arg')
    }
  })

  test('returns user error when limit is invalid', async () => {
    const result = await getMessagesCmd.run({
      args: { channelId: 'chan123', limit: 'bad' },
      json: true,
      quiet: true,
      verbose: false,
      log: {} as any,
      config: { botToken: 't', guildId: '' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('user')
      expect(result.code).toBe('bad_arg')
      expect(result.message).toContain('1')
    }
  })
})
