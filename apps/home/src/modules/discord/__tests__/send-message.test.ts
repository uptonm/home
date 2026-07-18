import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sendMessageCmd } from '../commands/send-message'
import type { DiscordConfig } from '../client'

const cfg: DiscordConfig = { botToken: 'test-token', guildId: 'g1' }
const originalFetch = globalThis.fetch

beforeEach(() => {
  // nothing
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('sendMessageCmd.run', () => {
  test('validates missing channelId', async () => {
    const result = await sendMessageCmd.run({
      args: { channelId: undefined, text: 'hi' },
      json: true,
      quiet: false,
      verbose: false,
      log: {} as any,
      config: cfg as any,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('channelId')
  })

  test('validates missing text', async () => {
    const result = await sendMessageCmd.run({
      args: { channelId: 'ch1', text: undefined },
      json: true,
      quiet: false,
      verbose: false,
      log: {} as any,
      config: cfg as any,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('text')
  })

  test('POSTs to /channels/:channelId/messages with correct body shape and headers', async () => {
    let seenUrl: string | undefined
    let seenInit: RequestInit | undefined

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seenUrl = url
      seenInit = init
      return new Response(JSON.stringify({ id: 'msg-7', content: 'Hello bot', timestamp: '2025-01-01T00:00:00.000Z' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const result = await sendMessageCmd.run({
      args: { channelId: '1234567890', text: 'Hello bot' },
      json: true,
      quiet: false,
      verbose: false,
      log: {} as any,
      config: cfg as any,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(seenUrl).toBe('https://discord.com/api/v10/channels/1234567890/messages')
    expect(seenInit?.method).toBe('POST')
    const bodyParsed = JSON.parse(seenInit?.body as string)
    expect(bodyParsed).toEqual({ content: 'Hello bot' })
    expect((seenInit?.headers as Record<string, string>)?.Authorization).toBe('Bot test-token')
    expect((seenInit?.headers as Record<string, string>)?.['Content-Type']).toBe('application/json')

    expect(result.data).toEqual({ id: 'msg-7', content: 'Hello bot', timestamp: '2025-01-01T00:00:00.000Z' })
  })
})
