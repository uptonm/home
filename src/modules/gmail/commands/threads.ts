import type { CommandSpec } from '../../../core/types'
import { THREAD_FORMATS, getThread, listThreads, readGmailConfig } from '../client'
import { optionalString, parseFormat, parseLabels, parseMax } from './shared'

export const threadsList: CommandSpec = {
  path: ['threads', 'list'],
  description: 'List thread ids matching a Gmail search query.',
  args: [
    { name: 'q', kind: 'string', description: 'Gmail search query (same syntax as messages list)' },
    { name: 'label', kind: 'string', description: 'Comma-separated label ids to filter by (e.g. INBOX)' },
    { name: 'max', kind: 'number', description: 'Max results per page (1-500, default 25)' },
    { name: 'page-token', kind: 'string', description: 'nextPageToken from a previous page' },
    { name: 'include-spam-trash', kind: 'boolean', description: 'Include threads in SPAM and TRASH' },
  ],
  examples: [
    'home gmail threads list --q "from:notifications@github.com" --json',
    'home gmail threads list --label INBOX --max 10 --json | jq \'.threads[].id\'',
  ],
  async run(ctx) {
    const max = parseMax(ctx)
    if (max.error) return { ok: false, kind: 'user', message: max.error, code: 'bad_arg' }

    const cfg = readGmailConfig(ctx.config)
    const data = await listThreads(cfg, {
      q: optionalString(ctx, 'q'),
      labelIds: parseLabels(ctx),
      maxResults: max.value,
      pageToken: optionalString(ctx, 'page-token'),
      includeSpamTrash: Boolean(ctx.args['include-spam-trash']),
    })
    return { ok: true, data }
  },
}

export const threadsGet: CommandSpec = {
  path: ['threads', 'get'],
  description: 'Get a thread and all of its messages by id.',
  args: [
    { name: 'id', kind: 'positional', description: 'Thread id', required: true },
    {
      name: 'format',
      kind: 'string',
      description: `Projection: ${THREAD_FORMATS.join(' | ')} (default full)`,
      enum: THREAD_FORMATS,
    },
  ],
  examples: [
    'home gmail threads get 18c9f0a1b2c3d4e5 --json',
    'home gmail threads get 18c9f0a1b2c3d4e5 --format metadata --json',
  ],
  async run(ctx) {
    const id = String(ctx.args.id ?? '').trim()
    if (!id) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }

    const fmt = parseFormat(ctx, THREAD_FORMATS)
    if (fmt.error) return { ok: false, kind: 'user', message: fmt.error, code: 'bad_arg' }

    const cfg = readGmailConfig(ctx.config)
    const data = await getThread(cfg, id, { format: fmt.value })
    return { ok: true, data }
  },
}
