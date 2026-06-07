import type { CommandSpec } from '../../../core/types'
import {
  MESSAGE_FORMATS,
  getMessage,
  listMessages,
  listMessagesHydrated,
  readGmailConfig,
} from '../client'
import { optionalString, parseFormat, parseLabels, parseMax } from './shared'

export const messagesList: CommandSpec = {
  path: ['messages', 'list'],
  description:
    'List message ids matching a Gmail search query. Use --hydrate to fetch From/Subject/Date/snippet per message in one call.',
  args: [
    {
      name: 'q',
      kind: 'string',
      description:
        'Gmail search query (e.g. "is:unread from:boss newer_than:7d has:attachment"). Same syntax as the Gmail search box.',
    },
    { name: 'label', kind: 'string', description: 'Comma-separated label ids to filter by (e.g. INBOX,UNREAD)' },
    { name: 'max', kind: 'number', description: 'Max results per page (1-500, default 25)' },
    { name: 'page-token', kind: 'string', description: 'nextPageToken from a previous page' },
    { name: 'hydrate', kind: 'boolean', description: 'Fetch From/To/Subject/Date/snippet for each message (extra API calls)' },
    { name: 'include-spam-trash', kind: 'boolean', description: 'Include messages in SPAM and TRASH' },
  ],
  examples: [
    'home gmail messages list --q "is:unread" --hydrate --json',
    'home gmail messages list --q "from:github.com newer_than:2d" --json | jq \'.messages[].id\'',
    'home gmail messages list --label INBOX --max 10 --json',
  ],
  async run(ctx) {
    const max = parseMax(ctx)
    if (max.error) return { ok: false, kind: 'user', message: max.error, code: 'bad_arg' }
    if (max.warning && ctx.log) ctx.log.warn(max.warning)

    const opts = {
      q: optionalString(ctx, 'q'),
      labelIds: parseLabels(ctx),
      maxResults: max.value,
      pageToken: optionalString(ctx, 'page-token'),
      includeSpamTrash: Boolean(ctx.args['include-spam-trash']),
    }

    const cfg = readGmailConfig(ctx.config)
    if (ctx.args.hydrate) {
      const data = await listMessagesHydrated(cfg, opts)
      return { ok: true, data }
    }
    const data = await listMessages(cfg, opts)
    return { ok: true, data }
  },
}

export const messagesGet: CommandSpec = {
  path: ['messages', 'get'],
  description: 'Get a single message by id.',
  args: [
    { name: 'id', kind: 'positional', description: 'Message id', required: true },
    {
      name: 'format',
      kind: 'string',
      description: `Projection: ${MESSAGE_FORMATS.join(' | ')} (default full)`,
      enum: MESSAGE_FORMATS,
    },
  ],
  examples: [
    'home gmail messages get 18c9f0a1b2c3d4e5 --json',
    'home gmail messages get 18c9f0a1b2c3d4e5 --format metadata --json',
    'home gmail messages get 18c9f0a1b2c3d4e5 --format raw --json | jq -r .raw',
  ],
  async run(ctx) {
    const id = String(ctx.args.id ?? '').trim()
    if (!id) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }

    const fmt = parseFormat(ctx, MESSAGE_FORMATS)
    if (fmt.error) return { ok: false, kind: 'user', message: fmt.error, code: 'bad_arg' }

    const cfg = readGmailConfig(ctx.config)
    const data = await getMessage(cfg, id, { format: fmt.value })
    return { ok: true, data }
  },
}
