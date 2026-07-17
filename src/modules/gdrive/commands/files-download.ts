import { writeFileSync } from 'node:fs'
import type { CommandSpec } from '../../../core/types'
import {
  fetchFileMedia,
  GOOGLE_FOLDER_MIME,
  isGoogleNativeMime,
  readGdriveCredentials,
  resolveFile,
} from '../client'
import { safeFilename, unwrapResolution } from './util'

export const filesDownload: CommandSpec = {
  path: ['files', 'download'],
  effect: 'read',
  description:
    'Download a binary/uploaded file’s bytes (alt=media) to a path or stdout. Google-native docs (Docs/Sheets/Slides) cannot be downloaded — use `files export`.',
  args: [
    { name: 'file', kind: 'positional', description: 'File id or name', required: true },
    { name: 'out', kind: 'string', description: 'Output path (default ./<file name>)' },
    { name: 'stdout', kind: 'boolean', description: 'Write bytes to stdout instead of a file' },
  ],
  examples: [
    'home gdrive files download 1AbCd... --out ./report.pdf',
    'home gdrive files download "vacation.jpg" --json',
    'home gdrive files download 1AbCd... --stdout > ./image.png',
  ],
  async run(ctx) {
    const ref = String(ctx.args.file ?? '').trim()
    if (!ref) return { ok: false, kind: 'user', message: 'file is required', code: 'missing_arg' }

    const creds = readGdriveCredentials(ctx.config)
    const resolution = unwrapResolution(await resolveFile(creds, ref), ref)
    if (!resolution.ok) return resolution.error
    const file = resolution.file
    const id = String(file.id)

    // Native-vs-binary guard: alt=media only works on uploaded/binary files.
    if (file.mimeType === GOOGLE_FOLDER_MIME) {
      return { ok: false, kind: 'user', message: `"${file.name ?? id}" is a folder — folders have no downloadable bytes`, code: 'is_folder' }
    }
    if (isGoogleNativeMime(file.mimeType)) {
      return {
        ok: false,
        kind: 'user',
        message: `"${file.name ?? id}" is a Google-native doc (${file.mimeType}) — use \`home gdrive files export ${id} --mime <pdf|docx|xlsx|…>\``,
        code: 'native_needs_export',
      }
    }

    const res = await fetchFileMedia(creds, id)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, kind: 'system', message: `download failed (HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`, code: `http_${res.status}` }
    }
    const buf = Buffer.from(await res.arrayBuffer())

    if (Boolean(ctx.args.stdout)) {
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(buf, (err) => (err ? reject(err) : resolve()))
      })
      return { ok: true }
    }

    const out = ctx.args.out ? String(ctx.args.out) : `./${safeFilename(file.name ?? id, id)}`
    writeFileSync(out, buf)
    return { ok: true, data: { path: out, bytes: buf.length, name: file.name ?? null, mimeType: file.mimeType ?? null } }
  },
}
