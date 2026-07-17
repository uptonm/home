import type { CommandSpec } from '../../../core/types'
import { listFiles, readGdriveCredentials, type FilesListParams } from '../client'

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 1000

export const filesList: CommandSpec = {
  path: ['files', 'list'],
  effect: 'read',
  description:
    "List Drive files. --q takes the Drive query language (e.g. \"name contains 'report'\", \"mimeType='application/pdf'\", \"'<folderId>' in parents\", \"modifiedTime > '2024-01-01T00:00:00'\"). With no --q, lists live (non-trashed) files.",
  args: [
    {
      name: 'q',
      kind: 'string',
      description:
        "Drive query language filter (used verbatim). Combine clauses with `and`/`or`, e.g. \"name contains 'budget' and trashed=false\".",
    },
    { name: 'order-by', kind: 'string', description: "Sort key(s), e.g. 'modifiedTime desc', 'name', 'folder,name'" },
    { name: 'drive', kind: 'string', description: 'Restrict to a shared drive by id (sets corpora=drive)' },
    { name: 'limit', kind: 'number', description: `Page size 1-${MAX_PAGE_SIZE} (default ${DEFAULT_PAGE_SIZE})` },
    { name: 'page-token', kind: 'string', description: 'nextPageToken from a previous page to fetch the next one' },
    { name: 'fields', kind: 'string', description: 'Override the Drive `fields` mask for the response' },
  ],
  examples: [
    'home gdrive files list --json',
    'home gdrive files list --q "name contains \'invoice\' and mimeType=\'application/pdf\'" --json',
    'home gdrive files list --q "\'0ABcdEfGhIjKlUk9PVA\' in parents" --order-by "modifiedTime desc" --json',
    'home gdrive files list --drive 0ABcdEfGhIjKlUk9PVA --limit 50 --json',
  ],
  async run(ctx) {
    const limitRaw = ctx.args.limit !== undefined ? Number(ctx.args.limit) : DEFAULT_PAGE_SIZE
    if (!Number.isFinite(limitRaw) || limitRaw < 1) {
      return { ok: false, kind: 'user', message: 'limit must be a positive number', code: 'bad_arg' }
    }
    const pageSize = Math.min(Math.floor(limitRaw), MAX_PAGE_SIZE)

    const q = ctx.args.q !== undefined ? String(ctx.args.q) : undefined
    const params: FilesListParams = {
      // Bare listing → exclude trash. A user-supplied --q is honored verbatim
      // (they own the full query, including any trashed clause they want).
      q: q ?? 'trashed = false',
      pageSize,
    }
    if (ctx.args['order-by'] !== undefined) params.orderBy = String(ctx.args['order-by'])
    if (ctx.args.drive !== undefined) params.driveId = String(ctx.args.drive)
    if (ctx.args['page-token'] !== undefined) params.pageToken = String(ctx.args['page-token'])
    if (ctx.args.fields !== undefined) params.fields = String(ctx.args.fields)

    const creds = readGdriveCredentials(ctx.config)
    const result = await listFiles(creds, params)
    return { ok: true, data: result }
  },
}
