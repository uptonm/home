import type { CommandSpec } from '../../../core/types'
import {
  MESSAGE_FORMATS,
  batchModifyMessages,
  getMessage,
  listMessages,
  listMessagesHydrated,
  readGmailCredentials,
  trashMessages,
  type GmailConfig,
} from '../client'
import { optionalString, parseFormat, parseLabels, parseMax, planMessageModify, type MessageSelection } from './shared'

export const messagesList: CommandSpec = {
  path: ['messages', 'list'],
  effect: 'read',
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

    const cfg = readGmailCredentials()
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
  effect: 'read',
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

    const cfg = readGmailCredentials()
    const data = await getMessage(cfg, id, { format: fmt.value })
    return { ok: true, data }
  },
}

// Page size for resolving a query to its full id set. Gmail caps list at 500.
const ID_PAGE_SIZE = 500
const SAMPLE_SIZE = 10

/** Paginate a query to every matching message id. */
async function collectMessageIds(cfg: GmailConfig, q: string): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const page = await listMessages(cfg, { q, maxResults: ID_PAGE_SIZE, pageToken })
    for (const m of page.messages ?? []) ids.push(m.id)
    pageToken = page.nextPageToken
  } while (pageToken)
  return ids
}

/** A short from/subject preview of the selection, for the dry-run. */
async function previewSample(
  cfg: GmailConfig,
  selection: MessageSelection,
  ids: string[],
): Promise<Array<{ id: string; from?: string; subject?: string }>> {
  if (selection.kind === 'query') {
    const page = await listMessagesHydrated(cfg, { q: selection.q, maxResults: SAMPLE_SIZE })
    return page.messages.map((m) => ({ id: m.id, from: m.from, subject: m.subject }))
  }
  return ids.slice(0, SAMPLE_SIZE).map((id) => ({ id }))
}

export const messagesModify: CommandSpec = {
  path: ['messages', 'modify'],
  effect: 'write',
  description:
    'Bulk archive/label/mark-read/trash messages matched by a Gmail query or id list. Dry-run unless --yes.',
  args: [
    { name: 'q', kind: 'string', description: 'Gmail search query selecting the messages to act on (e.g. "from:github.com")' },
    { name: 'ids', kind: 'string', description: 'Comma-separated message ids to act on (alternative to --q)' },
    { name: 'archive', kind: 'boolean', description: 'Remove from inbox (removes the INBOX label)' },
    { name: 'mark-read', kind: 'boolean', description: 'Mark as read (removes the UNREAD label)' },
    { name: 'trash', kind: 'boolean', description: 'Move to Trash (recoverable ~30 days); exclusive with other actions' },
    { name: 'add', kind: 'string', description: 'Comma-separated label ids to add' },
    { name: 'remove', kind: 'string', description: 'Comma-separated label ids to remove' },
    { name: 'yes', kind: 'boolean', description: 'Apply the change. Without it, the command previews and mutates nothing.' },
  ],
  examples: [
    'home gmail messages modify --q "from:notifications@github.com" --archive --mark-read',
    'home gmail messages modify --q "from:notifications@github.com" --archive --mark-read --yes',
    'home gmail messages modify --ids m1,m2,m3 --add Label_5 --yes',
    'home gmail messages modify --q "older_than:2y label:promotions" --trash --yes',
  ],
  async run(ctx) {
    const plan = planMessageModify(ctx.args)
    if ('error' in plan) return { ok: false, kind: 'user', message: plan.error, code: 'bad_arg' }

    const cfg = readGmailCredentials()
    const ids =
      plan.selection.kind === 'ids' ? plan.selection.ids : await collectMessageIds(cfg, plan.selection.q)

    if (ids.length === 0) {
      return { ok: true, data: { applied: false, matched: 0, action: plan.summary, note: 'no messages matched' } }
    }

    if (!ctx.args.yes) {
      const sample = await previewSample(cfg, plan.selection, ids)
      return {
        ok: true,
        data: {
          dryRun: true,
          action: plan.summary,
          matched: ids.length,
          addLabelIds: plan.addLabelIds,
          removeLabelIds: plan.removeLabelIds,
          trash: plan.trash,
          sample,
          hint: 're-run with --yes to apply',
        },
      }
    }

    const affected = plan.trash
      ? await trashMessages(cfg, ids)
      : await batchModifyMessages(cfg, { ids, addLabelIds: plan.addLabelIds, removeLabelIds: plan.removeLabelIds })
    return { ok: true, data: { applied: true, action: plan.summary, matched: ids.length, affected } }
  },
}
