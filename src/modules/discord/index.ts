import type { ModuleManifest } from '../../core/types'
import { requestJson, readDiscordConfig } from './client'

export const manifest: ModuleManifest = {
  name: 'discord',
  description: 'Read and write Discord messages via bot token',
  whenToUse: 'Use to list channels, read messages, or send a message to a Discord channel',
  configSchema: [
    {
      key: 'botToken',
      label: 'Bot Token',
      kind: 'secret',
      required: true,
      help: 'Create a bot at discord.com/developers',
    },
    {
      key: 'guildId',
      label: 'Guild ID',
      kind: 'string',
      required: true,
      help: 'Right-click your server -> Copy Server ID',
    },
  ],
  commands: [],
  async status(cfg) {
    try {
      const user = await requestJson<{ username: string }>('/users/@me', {}, readDiscordConfig(cfg))
      return { ok: true, data: { username: user.username } }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
