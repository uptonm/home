import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { requestJson, readDiscordConfig, DISCORD_API_BASE } from '../client'
import type { DiscordConfig } from '../client'

describe('readDiscordConfig', () => {
  test('pulls botToken and guildId from module config, coercing missing values to empty', () => {
    expect(readDiscordConfig({ botToken: 'tk', guildId: '123' })).toEqual({ botToken: 'tk', guildId: '123' })
    expect(readDiscordConfig({})).toEqual({ botToken: '', guildId: '' })
  })
})

describe('requestJson over mocked fetch', () => {
  const cfg: DiscordConfig = { botToken: 'test-token', guildId: '123' }
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    // nothing
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('sets Authorization header with Bot prefix', async () => {
    let seenAuth: string | undefined
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenAuth = (init?.headers as Record<string, string>)?.Authorization
      return new Response(JSON.stringify({ id: 'u1', username: 'testbot' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const data = await requestJson<{ username: string }>('/users/@me', {}, cfg)
    expect(data.username).toBe('testbot')
    expect(seenAuth).toBe('Bot test-token')
  })

  test('throws on 401 response', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ message: '401: Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch

    await expect(requestJson('/users/@me', {}, cfg)).rejects.toThrow('401')
  })
})
