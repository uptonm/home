import type { CommandSpec } from '../../../core/types'
import { listNotifications, readGithubConfig } from '../client'
import { limitArg, optionalString, parseLimit } from './shared'

export const notificationsList: CommandSpec = {
  path: ['notifications', 'list'],
  effect: 'read',
  description: 'Unread notifications from your inbox: reason, repo, subject title/type, and when they last moved',
  args: [
    {
      name: 'reason',
      kind: 'string',
      description: 'Filter by reason (e.g. review_requested, mention, assign, author, ci_activity, subscribed)',
    },
    limitArg,
  ],
  examples: [
    'home github notifications list --json',
    'home github notifications list --reason review_requested --json',
    'home github notifications list --reason mention --limit 10 --json',
  ],
  async run(ctx) {
    const cfg = readGithubConfig(ctx.config)
    const data = await listNotifications(cfg, {
      reason: optionalString(ctx, 'reason'),
      limit: parseLimit(ctx),
    })
    return { ok: true, data }
  },
}
