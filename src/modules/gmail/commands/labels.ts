import type { CommandSpec } from '../../../core/types'
import { getLabel, listLabels, readGmailConfig } from '../client'

export const labelsList: CommandSpec = {
  path: ['labels', 'list'],
  description: 'List all labels in the mailbox (system + user labels).',
  args: [],
  examples: [
    'home gmail labels list --json',
    'home gmail labels list --json | jq \'.labels[] | {id, name}\'',
  ],
  async run(ctx) {
    const cfg = readGmailConfig(ctx.config)
    const data = await listLabels(cfg)
    return { ok: true, data }
  },
}

export const labelsGet: CommandSpec = {
  path: ['labels', 'get'],
  description: 'Get a single label by id, including message/thread counts.',
  args: [{ name: 'id', kind: 'positional', description: 'Label id (e.g. INBOX, or a user label id)', required: true }],
  examples: [
    'home gmail labels get INBOX --json',
    'home gmail labels get UNREAD --json | jq \'{messagesUnread, threadsUnread}\'',
  ],
  async run(ctx) {
    const id = String(ctx.args.id ?? '').trim()
    if (!id) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }

    const cfg = readGmailConfig(ctx.config)
    const data = await getLabel(cfg, id)
    return { ok: true, data }
  },
}
