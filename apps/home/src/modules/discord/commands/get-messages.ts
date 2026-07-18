import type { CommandSpec } from '../../../core/types'
import { requestJson, readDiscordConfig } from '../client'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export interface DiscordMessage {
  id: string
  author: { username: string }
  content: string
  timestamp: string
}

export const getMessagesCmd: CommandSpec = {
  path: ['get-messages'],
  effect: 'read',
  description: 'Read recent messages from a text channel',
  args: [
    { name: 'channelId', kind: 'positional', description: 'Discord channel ID', required: true },
    { name: 'limit', kind: 'number', description: `Message count to fetch (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT})` },
  ],
  examples: [
    'home discord get-messages 987654321098765432',
    'home discord get-messages 987654321098765432 --limit 50 --json',
  ],
  async run(ctx) {
    const cfg = readDiscordConfig(ctx.config)
    const channelId = String(ctx.args.channelId ?? '').trim()
    if (!channelId) {
      return { ok: false, kind: 'user', message: 'channelId is required', code: 'missing_arg' }
    }

    const limitRaw = ctx.args.limit !== undefined ? Number(ctx.args.limit) : DEFAULT_LIMIT
    if (!Number.isFinite(limitRaw) || limitRaw < 1) {
      return { ok: false, kind: 'user', message: 'limit must be ≥ 1', code: 'bad_arg' }
    }
    const limit = Math.min(Math.floor(limitRaw), MAX_LIMIT)

    try {
      type MessageResponse = {
        id: string
        author: { username: string }
        content: string
        timestamp: string
      }
      const messages = await requestJson<MessageResponse[]>(
        `/channels/${channelId}/messages?limit=${limit}`,
        {},
        cfg,
      )
      const shaped = messages.map((msg) => ({
        id: msg.id,
        author: { username: msg.author.username },
        content: msg.content,
        timestamp: msg.timestamp,
      }))
      return { ok: true, data: shaped }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'get_messages_failed' }
    }
  },
}
