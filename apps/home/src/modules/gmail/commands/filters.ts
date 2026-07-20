import type { CommandSpec } from '../../../core/types'
import { createFilter, deleteFilter, listFilters, readGmailCredentials } from '../client'
import { buildFilterSpec } from './shared'

export const filtersList: CommandSpec = {
  path: ['filters', 'list'],
  effect: 'read',
  description: 'List the mailbox filters (routing rules).',
  args: [],
  examples: ['home gmail filters list --json', 'home gmail filters list --json | jq \'.filter[] | {id, criteria}\''],
  async run() {
    const cfg = readGmailCredentials()
    const data = await listFilters(cfg)
    return { ok: true, data }
  },
}

export const filtersCreate: CommandSpec = {
  path: ['filters', 'create'],
  effect: 'write',
  description:
    'Create a routing rule: match incoming mail by criteria, relabel it. Applies to FUTURE mail only — use `messages modify` for the existing backlog. Dry-run unless --yes.',
  args: [
    { name: 'from', kind: 'string', description: 'Match sender (e.g. news@shop.com or a domain)' },
    { name: 'to', kind: 'string', description: 'Match recipient' },
    { name: 'subject', kind: 'string', description: 'Match subject text' },
    { name: 'query', kind: 'string', description: 'Match an arbitrary Gmail query (e.g. "older_than:1y")' },
    { name: 'has-attachment', kind: 'boolean', description: 'Match only messages with an attachment' },
    { name: 'add', kind: 'string', description: 'Comma-separated label ids to apply' },
    { name: 'archive', kind: 'boolean', description: 'Skip the inbox (removes INBOX)' },
    { name: 'mark-read', kind: 'boolean', description: 'Mark read (removes UNREAD)' },
    { name: 'yes', kind: 'boolean', description: 'Create the filter. Without it, the command previews only.' },
  ],
  examples: [
    'home gmail filters create --from news@shop.com --archive',
    'home gmail filters create --from news@shop.com --add Label_5 --archive --mark-read --yes',
  ],
  async run(ctx) {
    const spec = buildFilterSpec(ctx.args)
    if ('error' in spec) return { ok: false, kind: 'user', message: spec.error, code: 'bad_arg' }

    if (!ctx.args.yes) {
      return {
        ok: true,
        data: { dryRun: true, action: spec.summary, criteria: spec.criteria, filterAction: spec.action, hint: 're-run with --yes to create' },
      }
    }

    const cfg = readGmailCredentials()
    const data = await createFilter(cfg, { criteria: spec.criteria, action: spec.action })
    return { ok: true, data }
  },
}

export const filtersDelete: CommandSpec = {
  path: ['filters', 'delete'],
  effect: 'write',
  description: 'Delete a filter by id. Dry-run unless --yes.',
  args: [
    { name: 'id', kind: 'positional', description: 'Filter id (from `filters list`)', required: true },
    { name: 'yes', kind: 'boolean', description: 'Delete the filter. Without it, the command previews only.' },
  ],
  examples: ['home gmail filters delete ABC123', 'home gmail filters delete ABC123 --yes'],
  async run(ctx) {
    const id = String(ctx.args.id ?? '').trim()
    if (!id) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }

    if (!ctx.args.yes) {
      return { ok: true, data: { dryRun: true, id, hint: 're-run with --yes to delete' } }
    }

    const cfg = readGmailCredentials()
    await deleteFilter(cfg, id)
    return { ok: true, data: { deleted: true, id } }
  },
}
