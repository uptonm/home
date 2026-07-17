import type { CommandSpec } from '../../../core/types'
import { requestJson, readDiscordConfig } from '../client'

export const sendMessageCmd: CommandSpec = {
  path: ['send-message'],
  effect: 'write',
  description: 'Send a text message to a Discord channel.',
  args: [
    { name: 'channelId', kind: 'positional', description: 'Discord channel ID', required: true },
    { name: 'text', kind: 'positional', description: 'Message content to send', required: true },
  ],
  examples: [
    'home discord send-message 1234567890 "Hello world" --json',
    'home discord send-message 1234567890 "Bot is online" --json',
  ],
  async run(ctx) {
    const channelId = String(ctx.args.channelId ?? '').trim()
    if (!channelId) return { ok: false, kind: 'user', message: 'channelId is required', code: 'missing_arg' }

    const text = String(ctx.args.text ?? '').trim()
    if (!text) return { ok: false, kind: 'user', message: 'text is required', code: 'missing_arg' }

    const cfg = readDiscordConfig(ctx.config)
    const body = { content: text }

    const data = await requestJson<{ id: string; content: string; timestamp: string }>(
      `/channels/${channelId}/messages`,
      { method: 'POST', body: JSON.stringify(body) },
      cfg,
    )

    return { ok: true, data: { id: data.id, content: data.content, timestamp: data.timestamp } }
  },
}
