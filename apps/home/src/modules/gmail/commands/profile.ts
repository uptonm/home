import type { CommandSpec } from '../../../core/types'
import { getProfile, readGmailCredentials } from '../client'

export const profileGet: CommandSpec = {
  path: ['profile'],
  effect: 'read',
  description: 'Get the mailbox profile: email address, message/thread totals, historyId.',
  args: [],
  examples: [
    'home gmail profile --json',
    'home gmail profile --json | jq .emailAddress',
  ],
  async run(ctx) {
    const cfg = readGmailCredentials()
    const data = await getProfile(cfg)
    return { ok: true, data }
  },
}
