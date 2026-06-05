import type { CommandSpec } from '../../../core/types'
import { getProfile, readGmailConfig } from '../client'

export const profileGet: CommandSpec = {
  path: ['profile'],
  description: 'Get the mailbox profile: email address, message/thread totals, historyId.',
  args: [],
  examples: [
    'home gmail profile --json',
    'home gmail profile --json | jq .emailAddress',
  ],
  async run(ctx) {
    const cfg = readGmailConfig(ctx.config)
    const data = await getProfile(cfg)
    return { ok: true, data }
  },
}
