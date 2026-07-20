import type { CommandSpec } from '../../../core/types'
import { createLabel, deleteLabel, getLabel, listLabels, readGmailCredentials } from '../client'
import { optionalString } from './shared'

export const labelsList: CommandSpec = {
  path: ['labels', 'list'],
  effect: 'read',
  description: 'List all labels in the mailbox (system + user labels).',
  args: [],
  examples: [
    'home gmail labels list --json',
    'home gmail labels list --json | jq \'.labels[] | {id, name}\'',
  ],
  async run(ctx) {
    const cfg = readGmailCredentials()
    const data = await listLabels(cfg)
    return { ok: true, data }
  },
}

export const labelsGet: CommandSpec = {
  path: ['labels', 'get'],
  effect: 'read',
  description: 'Get a single label by id, including message/thread counts.',
  args: [{ name: 'id', kind: 'positional', description: 'Label id (e.g. INBOX, or a user label id)', required: true }],
  examples: [
    'home gmail labels get INBOX --json',
    'home gmail labels get UNREAD --json | jq \'{messagesUnread, threadsUnread}\'',
  ],
  async run(ctx) {
    const id = String(ctx.args.id ?? '').trim()
    if (!id) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }

    const cfg = readGmailCredentials()
    const data = await getLabel(cfg, id)
    return { ok: true, data }
  },
}

export const labelsCreate: CommandSpec = {
  path: ['labels', 'create'],
  effect: 'write',
  description: 'Create a user label. Prints the new label id (needed to apply it via `messages modify --add`).',
  args: [{ name: 'name', kind: 'string', description: 'Label name (use "/" for nesting, e.g. "Triage/Receipts")', required: true }],
  examples: ['home gmail labels create --name Newsletters --json', 'home gmail labels create --name "Triage/Receipts" --json'],
  async run(ctx) {
    const name = optionalString(ctx, 'name')
    if (!name) return { ok: false, kind: 'user', message: '--name is required', code: 'missing_arg' }

    const cfg = readGmailCredentials()
    const data = await createLabel(cfg, { name })
    return { ok: true, data }
  },
}

export const labelsDelete: CommandSpec = {
  path: ['labels', 'delete'],
  effect: 'write',
  description:
    'Delete a user label. Removes it from every message it was on (the messages themselves stay). Not recoverable. Dry-run unless --yes.',
  args: [
    { name: 'id', kind: 'positional', description: 'User label id (from `labels list`; system labels cannot be deleted)', required: true },
    { name: 'yes', kind: 'boolean', description: 'Delete the label. Without it, the command previews only.' },
  ],
  examples: ['home gmail labels delete Label_20', 'home gmail labels delete Label_20 --yes'],
  async run(ctx) {
    const id = String(ctx.args.id ?? '').trim()
    if (!id) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }

    if (!ctx.args.yes) {
      return { ok: true, data: { dryRun: true, id, hint: 're-run with --yes to delete' } }
    }

    const cfg = readGmailCredentials()
    await deleteLabel(cfg, id)
    return { ok: true, data: { deleted: true, id } }
  },
}
