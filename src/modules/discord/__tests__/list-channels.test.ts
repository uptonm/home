import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { listChannelsCmd } from '../commands/list-channels'

describe('listChannelsCmd', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    // nothing
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('returns filtered text channels (type 0) with id, name, topic', async () => {
    globalThis.fetch = (async (url: string, _init?: RequestInit) => {
      expect(String(url)).toContain('/guilds/123456/channels')
      return new Response(
        JSON.stringify([
          { id: '1', name: 'general', topic: 'General chat', type: 0 },
          { id: '2', name: 'random', topic: null, type: 0 },
          { id: '3', name: 'Voice Chat', topic: null, type: 2 },
          { id: '4', name: 'announcements', topic: 'Official news', type: 0 },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const result = await listChannelsCmd.run({
      args: { guildId: '123456' },
      json: true,
      quiet: true,
      verbose: false,
      log: {} as any,
      config: { botToken: 't', guildId: '' },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const data = result.data as { id: string; name: string; topic: string | null }[]
      expect(data).toHaveLength(3)
      expect(data.map((ch) => ch.name)).toEqual(['general', 'random', 'announcements'])
      expect(data[0]).toEqual({ id: '1', name: 'general', topic: 'General chat' })
      expect(data[1]).toEqual({ id: '2', name: 'random', topic: null })
    }
  })

  test('uses guildId from config when positional arg not provided', async () => {
    let seenUrl = ''
    globalThis.fetch = (async (url: string, _init?: RequestInit) => {
      seenUrl = String(url)
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as unknown as typeof fetch

    await listChannelsCmd.run({
      args: {},
      json: true,
      quiet: true,
      verbose: false,
      log: {} as any,
      config: { botToken: 't', guildId: 'configured-guild' },
    })

    expect(seenUrl).toContain('/guilds/configured-guild/channels')
  })

  test('prefers positional arg guildId over config', async () => {
    let seenUrl = ''
    globalThis.fetch = (async (url: string, _init?: RequestInit) => {
      seenUrl = String(url)
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as unknown as typeof fetch

    await listChannelsCmd.run({
      args: { guildId: 'override-guild' },
      json: true,
      quiet: true,
      verbose: false,
      log: {} as any,
      config: { botToken: 't', guildId: 'configured-guild' },
    })

    expect(seenUrl).toContain('/guilds/override-guild/channels')
  })

  test('returns user error when no guildId is available', async () => {
    const result = await listChannelsCmd.run({
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
      expect(result.message).toContain('guildId is required')
    }
  })
})
