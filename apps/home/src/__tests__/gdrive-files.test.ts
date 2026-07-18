import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConsola } from 'consola'
import type { RunContext } from '../core/types'
import * as realClientNS from '../modules/gdrive/client'
import type { DriveFile, FilesListParams, ResolveFileResult } from '../modules/gdrive/client'

// Snapshot the real exports *before* mocking so the pure helpers
// (isGoogleNativeMime, resolveExportMime, EXPORT_MIME_ALIASES, …) stay real and
// the overrides can fall back to the genuine implementations.
const real = { ...realClientNS }

// Per-test overridable seams. They default to the real implementations so that
// if this module mock ever leaks into another test file, the client still
// behaves normally instead of throwing.
let resolveFileImpl: typeof real.resolveFile = real.resolveFile
let listFilesImpl: typeof real.listFiles = real.listFiles
let getFileImpl: typeof real.getFile = real.getFile
let fetchMediaImpl: typeof real.fetchFileMedia = real.fetchFileMedia
let fetchExportImpl: typeof real.fetchFileExport = real.fetchFileExport

mock.module('../modules/gdrive/client', () => ({
  ...real,
  readGdriveCredentials: () => ({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }),
  resolveFile: (...a: Parameters<typeof real.resolveFile>) => resolveFileImpl(...a),
  listFiles: (...a: Parameters<typeof real.listFiles>) => listFilesImpl(...a),
  getFile: (...a: Parameters<typeof real.getFile>) => getFileImpl(...a),
  fetchFileMedia: (...a: Parameters<typeof real.fetchFileMedia>) => fetchMediaImpl(...a),
  fetchFileExport: (...a: Parameters<typeof real.fetchFileExport>) => fetchExportImpl(...a),
}))

// Commands must be imported *after* the mock is registered.
const { filesList } = await import('../modules/gdrive/commands/files-list')
const { filesGet } = await import('../modules/gdrive/commands/files-get')
const { filesDownload } = await import('../modules/gdrive/commands/files-download')
const { filesExport } = await import('../modules/gdrive/commands/files-export')

function ctx(args: Record<string, string | number | boolean | undefined>): RunContext {
  return { args, json: true, quiet: true, verbose: false, log: createConsola({ level: 0 }), config: {} }
}

const ok = (file: DriveFile): ResolveFileResult => ({ kind: 'ok', file })

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gdrive-test-'))
})
afterEach(() => {
  resolveFileImpl = real.resolveFile
  listFilesImpl = real.listFiles
  getFileImpl = real.getFile
  fetchMediaImpl = real.fetchFileMedia
  fetchExportImpl = real.fetchFileExport
  rmSync(tmp, { recursive: true, force: true })
})

describe('files list', () => {
  test('defaults to non-trashed and maps args onto FilesListParams', async () => {
    let seen: FilesListParams | undefined
    listFilesImpl = (async (_creds, p) => {
      seen = p
      return { files: [{ id: 'f1', name: 'A' }], nextPageToken: 'NPT' }
    }) as typeof real.listFiles

    const res = await filesList.run(ctx({ limit: 25, 'order-by': 'name', drive: 'D1', 'page-token': 'PT', fields: 'files(id)' }))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data).toEqual({ files: [{ id: 'f1', name: 'A' }], nextPageToken: 'NPT' })
    expect(seen).toEqual({ q: 'trashed = false', pageSize: 25, orderBy: 'name', driveId: 'D1', pageToken: 'PT', fields: 'files(id)' })
  })

  test('passes a user --q through verbatim', async () => {
    let seen: FilesListParams | undefined
    listFilesImpl = (async (_creds, p) => {
      seen = p
      return { files: [] }
    }) as typeof real.listFiles

    await filesList.run(ctx({ q: "name contains 'x' and trashed=true" }))
    expect(seen?.q).toBe("name contains 'x' and trashed=true")
    expect(seen?.pageSize).toBe(100)
  })

  test('rejects a non-positive limit before calling the API', async () => {
    let called = false
    listFilesImpl = (async () => {
      called = true
      return { files: [] }
    }) as typeof real.listFiles

    const res = await filesList.run(ctx({ limit: -3 }))
    expect(res).toMatchObject({ ok: false, code: 'bad_arg' })
    expect(called).toBe(false)
  })
})

describe('files get', () => {
  test('resolves then fetches full metadata (default fields=*)', async () => {
    resolveFileImpl = (async () => ok({ id: 'ID9', name: 'Doc' })) as typeof real.resolveFile
    let gotId = ''
    let gotFields: string | undefined
    getFileImpl = (async (_creds, id, opts) => {
      gotId = id
      gotFields = opts?.fields
      return { id, name: 'Doc', mimeType: 'application/pdf' }
    }) as typeof real.getFile

    const res = await filesGet.run(ctx({ file: 'Doc' }))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data).toMatchObject({ id: 'ID9', name: 'Doc' })
    expect(gotId).toBe('ID9')
    expect(gotFields).toBe('*')
  })

  test('honors a custom --fields mask', async () => {
    resolveFileImpl = (async () => ok({ id: 'ID9' })) as typeof real.resolveFile
    let gotFields: string | undefined
    getFileImpl = (async (_creds, id, opts) => {
      gotFields = opts?.fields
      return { id }
    }) as typeof real.getFile

    await filesGet.run(ctx({ file: 'ID9', fields: 'id,name,size' }))
    expect(gotFields).toBe('id,name,size')
  })

  test('not_found → user error', async () => {
    resolveFileImpl = (async () => ({ kind: 'not_found' })) as typeof real.resolveFile
    const res = await filesGet.run(ctx({ file: 'ghost' }))
    expect(res).toMatchObject({ ok: false, code: 'not_found' })
  })

  test('ambiguous → user error listing candidates', async () => {
    resolveFileImpl = (async () => ({ kind: 'ambiguous', matches: [{ id: 'a', name: 'Plan A' }, { id: 'b', name: 'Plan B' }] })) as typeof real.resolveFile
    const res = await filesGet.run(ctx({ file: 'Plan' }))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('ambiguous')
      expect(res.message).toContain('Plan A (a)')
      expect(res.message).toContain('Plan B (b)')
    }
  })

  test('missing file arg → missing_arg', async () => {
    const res = await filesGet.run(ctx({ file: '   ' }))
    expect(res).toMatchObject({ ok: false, code: 'missing_arg' })
  })
})

describe('files download', () => {
  test('refuses a folder', async () => {
    resolveFileImpl = (async () => ok({ id: 'F', name: 'Stuff', mimeType: real.GOOGLE_FOLDER_MIME })) as typeof real.resolveFile
    const res = await filesDownload.run(ctx({ file: 'Stuff' }))
    expect(res).toMatchObject({ ok: false, code: 'is_folder' })
  })

  test('points Google-native docs at export', async () => {
    resolveFileImpl = (async () => ok({ id: 'D', name: 'Notes', mimeType: 'application/vnd.google-apps.document' })) as typeof real.resolveFile
    const res = await filesDownload.run(ctx({ file: 'Notes' }))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('native_needs_export')
      expect(res.message).toContain('files export')
    }
  })

  test('writes binary bytes to --out and reports path/bytes', async () => {
    resolveFileImpl = (async () => ok({ id: 'B', name: 'pic.png', mimeType: 'image/png' })) as typeof real.resolveFile
    let mediaId = ''
    fetchMediaImpl = (async (_creds, id) => {
      mediaId = id
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
    }) as typeof real.fetchFileMedia

    const out = join(tmp, 'pic.png')
    const res = await filesDownload.run(ctx({ file: 'pic.png', out }))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data).toEqual({ path: out, bytes: 4, name: 'pic.png', mimeType: 'image/png' })
    expect(mediaId).toBe('B')
    expect(existsSync(out)).toBe(true)
    expect(readFileSync(out)).toEqual(Buffer.from([1, 2, 3, 4]))
  })

  test('surfaces a non-ok media response as a system error', async () => {
    resolveFileImpl = (async () => ok({ id: 'B', name: 'pic.png', mimeType: 'image/png' })) as typeof real.resolveFile
    fetchMediaImpl = (async () => new Response('denied', { status: 403 })) as typeof real.fetchFileMedia

    const res = await filesDownload.run(ctx({ file: 'pic.png', out: join(tmp, 'x.png') }))
    expect(res).toMatchObject({ ok: false, kind: 'system', code: 'http_403' })
  })
})

describe('files export', () => {
  test('refuses a non-native (binary) file', async () => {
    resolveFileImpl = (async () => ok({ id: 'P', name: 'report.pdf', mimeType: 'application/pdf' })) as typeof real.resolveFile
    const res = await filesExport.run(ctx({ file: 'report.pdf', mime: 'pdf' }))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('not_native')
      expect(res.message).toContain('files download')
    }
  })

  test('exports a native doc, resolving the --mime alias to a full MIME', async () => {
    resolveFileImpl = (async () => ok({ id: 'S', name: 'Q3 Budget', mimeType: 'application/vnd.google-apps.spreadsheet' })) as typeof real.resolveFile
    let exportedMime = ''
    fetchExportImpl = (async (_creds, _id, mime) => {
      exportedMime = mime
      return new Response(new Uint8Array([9, 9]), { status: 200 })
    }) as typeof real.fetchFileExport

    const out = join(tmp, 'q3.xlsx')
    const res = await filesExport.run(ctx({ file: 'Q3 Budget', mime: 'xlsx', out }))
    expect(res.ok).toBe(true)
    expect(exportedMime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    if (res.ok) expect(res.data).toMatchObject({ path: out, bytes: 2, mimeType: exportedMime })
    expect(existsSync(out)).toBe(true)
  })

  test('requires --mime', async () => {
    resolveFileImpl = (async () => ok({ id: 'S', mimeType: 'application/vnd.google-apps.document' })) as typeof real.resolveFile
    const res = await filesExport.run(ctx({ file: 'S', mime: '   ' }))
    expect(res).toMatchObject({ ok: false, code: 'missing_arg' })
  })

  test('maps a 400 export failure to a user error', async () => {
    resolveFileImpl = (async () => ok({ id: 'S', name: 'Slides', mimeType: 'application/vnd.google-apps.presentation' })) as typeof real.resolveFile
    fetchExportImpl = (async () => new Response('bad mime', { status: 400 })) as typeof real.fetchFileExport

    const res = await filesExport.run(ctx({ file: 'Slides', mime: 'application/x-nonsense', out: join(tmp, 'o') }))
    expect(res).toMatchObject({ ok: false, kind: 'user', code: 'http_400' })
  })
})
