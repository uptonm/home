import { writeFileSync } from 'node:fs'
import type { CommandSpec } from '../../../core/types'
import {
  EXPORT_MIME_ALIASES,
  extensionForExportMime,
  fetchFileExport,
  isGoogleNativeMime,
  readGdriveCredentials,
  resolveExportMime,
  resolveFile,
} from '../client'
import { safeFilename, unwrapResolution } from './util'

const ALIAS_LIST = Object.keys(EXPORT_MIME_ALIASES).join(', ')

export const filesExport: CommandSpec = {
  path: ['files', 'export'],
  effect: 'write', // writes a local file by default — must stay out of e2e auto-reads
  description:
    'Export a Google-native doc (Docs/Sheets/Slides/Drawings) to another format. --mime accepts a friendly alias or a full MIME type. Use `files download` for uploaded/binary files.',
  args: [
    { name: 'file', kind: 'positional', description: 'File id or name', required: true },
    { name: 'mime', kind: 'string', description: `Target format — alias (${ALIAS_LIST}) or a full MIME type`, required: true },
    { name: 'out', kind: 'string', description: 'Output path (default ./<file name>.<ext>)' },
    { name: 'stdout', kind: 'boolean', description: 'Write bytes to stdout instead of a file' },
  ],
  examples: [
    'home gdrive files export "Q3 Budget" --mime xlsx --out ./q3.xlsx',
    'home gdrive files export 1AbCd... --mime pdf --json',
    'home gdrive files export 1AbCd... --mime csv --stdout',
  ],
  async run(ctx) {
    const ref = String(ctx.args.file ?? '').trim()
    if (!ref) return { ok: false, kind: 'user', message: 'file is required', code: 'missing_arg' }
    const mimeArg = ctx.args.mime !== undefined ? String(ctx.args.mime).trim() : ''
    if (!mimeArg) return { ok: false, kind: 'user', message: '--mime is required', code: 'missing_arg' }

    const creds = readGdriveCredentials()
    const resolution = unwrapResolution(await resolveFile(creds, ref), ref)
    if (!resolution.ok) return resolution.error
    const file = resolution.file
    const id = String(file.id)

    // export only applies to Google-native editor files.
    if (!isGoogleNativeMime(file.mimeType)) {
      return {
        ok: false,
        kind: 'user',
        message: `"${file.name ?? id}" is not a Google-native doc (${file.mimeType ?? 'unknown'}) — use \`home gdrive files download ${id}\``,
        code: 'not_native',
      }
    }

    const mimeType = resolveExportMime(mimeArg)
    const res = await fetchFileExport(creds, id, mimeType)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // 400 usually means the export MIME is invalid for this doc type; 403 can be the 10MB export cap.
      return {
        ok: false,
        kind: res.status === 400 ? 'user' : 'system',
        message: `export to ${mimeType} failed (HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
        code: `http_${res.status}`,
      }
    }
    const buf = Buffer.from(await res.arrayBuffer())

    if (Boolean(ctx.args.stdout)) {
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(buf, (err) => (err ? reject(err) : resolve()))
      })
      return { ok: true }
    }

    const ext = extensionForExportMime(mimeType)
    const out = ctx.args.out ? String(ctx.args.out) : `./${safeFilename(file.name ?? id, id)}.${ext}`
    writeFileSync(out, buf)
    return { ok: true, data: { path: out, bytes: buf.length, name: file.name ?? null, mimeType } }
  },
}
