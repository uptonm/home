import type { CommandSpec } from '../../../core/types'
import { requestJson, readDiscordConfig } from '../client'

export interface DiscordChannel {
  id: string
  name: string
  topic: string | null
  type: number
}

export const listChannelsCmd: CommandSpec = {
  path: ['list-channels'],
  description: 'List text channels (type 0) for the configured guild',
  args: [
    { name: 'guildId', kind: 'positional', description: 'Discord guild ID (overrides configured guildId)', required: false },
  ],
  examples: [
    'home discord list-channels',
    'home discord list-channels 123456789012345678 --json',
  ],
  async run(ctx) {
    const cfg = readDiscordConfig(ctx.config)
    const guildId = String(ctx.args.guildId ?? cfg.guildId)
    if (!guildId) {
      return { ok: false, kind: 'user', message: 'guildId is required (either in config or as positional arg)', code: 'missing_arg' }
    }

    try {
      type ChannelResponse = { id: string; name: string; topic: string | null; type: number }
      const channels = await requestJson<ChannelResponse[]>(`/guilds/${guildId}/channels`, {}, cfg)
      const textChannels = channels
        .filter((ch) => ch.type === 0)
        .map((ch) => ({
          id: ch.id,
          name: ch.name,
          topic: ch.topic,
        }))
      return { ok: true, data: textChannels }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'list_channels_failed' }
    }
  },
}
