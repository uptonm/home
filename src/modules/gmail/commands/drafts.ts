import type { CommandSpec } from '../../../core/types'
import { MESSAGE_FORMATS, getDraft, listDrafts, readGmailConfig } from '../client'
import { optionalString, parseFormat, parseMax } from './shared'

export const draftsList: CommandSpec = {
  path: ['drafts', 'list'],
  description: 'List draft ids (each carries a message id/threadId).',
  args: [
    { name: 'q', kind: 'string', description: 'Gmail search query to filter drafts' },
    { name: 'max', kind: 'number', description: 'Max results per page (1-500, default 25)' },
    { name: 'page-token', kind: 'string', description: 'nextPageToken from a previous page' },
    { name: 'include-spam-trash', kind: 'boolean', description: 'Include drafts in SPAM and TRASH' },
  ],
  examples: [
    'home gmail drafts list --json',
    'home gmail drafts list --max 10 --json | jq \'.drafts[].id\'',
  ],
  async run(ctx) {
    const max = parseMax(ctx)
    if (max.error) return { ok: false, kind: 'user', message: max.error, code: 'bad_arg' }

    const cfg = readGmailConfig(ctx.config)
    const data = await listDrafts(cfg, {
      q: optionalString(ctx, 'q'),
      maxResults: max.value,
      pageToken: optionalString(ctx, 'page-token'),
      includeSpamTrash: Boolean(ctx.args['include-spam-trash']),
    })
    return { ok: true, data }
  },
}

export const draftsGet: CommandSpec = {
  path: ['drafts', 'get'],
  description: 'Get a single draft (and its message) by id.',
  args: [
    { name: 'id', kind: 'positional', description: 'Draft id', required: true },
    {
      name: 'format',
      kind: 'string',
      description: `Projection for the draft's message: ${MESSAGE_FORMATS.join(' | ')} (default full)`,
      enum: MESSAGE_FORMATS,
    },
  ],
  examples: [
    'home gmail drafts get r-1234567890 --json',
    'home gmail drafts get r-1234567890 --format metadata --json',
  ],
  async run(ctx) {
    const id = String(ctx.args.id ?? '').trim()
    if (!id) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }

    const fmt = parseFormat(ctx, MESSAGE_FORMATS)
    if (fmt.error) return { ok: false, kind: 'user', message: fmt.error, code: 'bad_arg' }

    const cfg = readGmailConfig(ctx.config)
    const data = await getDraft(cfg, id, { format: fmt.value })
    return { ok: true, data }
  },
}
