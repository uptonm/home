import type { CommandSpec } from '../../../core/types'
import { getFile, readGdriveCredentials, resolveFile } from '../client'
import { unwrapResolution } from './util'

export const filesGet: CommandSpec = {
  path: ['files', 'get'],
  description: 'Fetch full metadata for one file by id or name (name resolves via a scoped search; ambiguous → candidates listed)',
  args: [
    { name: 'file', kind: 'positional', description: 'File id or name (case-insensitive, substring ok)', required: true },
    { name: 'fields', kind: 'string', description: 'Drive `fields` mask (default `*` — the full resource)' },
  ],
  examples: [
    'home gdrive files get 1AbCdEfGhIjKlMnOpQrStUvWxYz0 --json',
    'home gdrive files get "Q3 Budget" --json',
    'home gdrive files get 1AbCd... --fields "id,name,mimeType,size,parents,permissions" --json',
  ],
  async run(ctx) {
    const ref = String(ctx.args.file ?? '').trim()
    if (!ref) return { ok: false, kind: 'user', message: 'file is required', code: 'missing_arg' }

    const creds = readGdriveCredentials(ctx.config)
    const resolution = unwrapResolution(await resolveFile(creds, ref), ref)
    if (!resolution.ok) return resolution.error

    const fields = ctx.args.fields !== undefined ? String(ctx.args.fields) : '*'
    const file = await getFile(creds, String(resolution.file.id), { fields })
    return { ok: true, data: file }
  },
}
