import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetGoogleTokenCache, type GoogleOAuthCredentials } from '../core/google-auth'
import {
  buildAboutUrl,
  buildExportUrl,
  buildFileDownloadUrl,
  buildFileGetUrl,
  buildFilesListUrl,
  buildNameQuery,
  DEFAULT_LIST_FIELDS,
  escapeDriveQueryValue,
  extensionForExportMime,
  isGoogleNativeMime,
  looksLikeDriveId,
  matchFileByName,
  resolveExportMime,
  resolveFile,
  type DriveFile,
} from '../modules/gdrive/client'

describe('escapeDriveQueryValue', () => {
  test('escapes single quotes and backslashes', () => {
    expect(escapeDriveQueryValue("O'Brien")).toBe("O\\'Brien")
    expect(escapeDriveQueryValue('a\\b')).toBe('a\\\\b')
    expect(escapeDriveQueryValue('plain')).toBe('plain')
  })
})

describe('buildNameQuery', () => {
  test('matches exact name or substring, escaping the value', () => {
    expect(buildNameQuery('Budget')).toBe("(name = 'Budget' or name contains 'Budget')")
    expect(buildNameQuery("Bob's")).toBe("(name = 'Bob\\'s' or name contains 'Bob\\'s')")
  })
})

describe('buildFilesListUrl', () => {
  test('defaults: pageSize 100, full field mask, shared-drive flags on', () => {
    const u = new URL(buildFilesListUrl())
    expect(u.origin + u.pathname).toBe('https://www.googleapis.com/drive/v3/files')
    expect(u.searchParams.get('pageSize')).toBe('100')
    expect(u.searchParams.get('fields')).toBe(DEFAULT_LIST_FIELDS)
    expect(u.searchParams.get('supportsAllDrives')).toBe('true')
    expect(u.searchParams.get('includeItemsFromAllDrives')).toBe('true')
    expect(u.searchParams.has('q')).toBe(false)
    expect(u.searchParams.has('orderBy')).toBe(false)
  })

  test('passes q, orderBy, pageToken and pageSize through', () => {
    const u = new URL(buildFilesListUrl({ q: "name contains 'x'", orderBy: 'modifiedTime desc', pageToken: 'PT', pageSize: 25 }))
    expect(u.searchParams.get('q')).toBe("name contains 'x'")
    expect(u.searchParams.get('orderBy')).toBe('modifiedTime desc')
    expect(u.searchParams.get('pageToken')).toBe('PT')
    expect(u.searchParams.get('pageSize')).toBe('25')
  })

  test('driveId scopes the listing to a shared drive (corpora=drive)', () => {
    const u = new URL(buildFilesListUrl({ driveId: '0ABCdef' }))
    expect(u.searchParams.get('driveId')).toBe('0ABCdef')
    expect(u.searchParams.get('corpora')).toBe('drive')
  })

  test('honors a custom fields mask', () => {
    expect(new URL(buildFilesListUrl({ fields: 'files(id)' })).searchParams.get('fields')).toBe('files(id)')
  })
})

describe('single-file URL builders', () => {
  test('get defaults to the full resource and supports shared drives', () => {
    const u = new URL(buildFileGetUrl('a b/c'))
    expect(u.pathname).toBe('/drive/v3/files/' + encodeURIComponent('a b/c'))
    expect(u.searchParams.get('fields')).toBe('*')
    expect(u.searchParams.get('supportsAllDrives')).toBe('true')
  })

  test('get honors a custom field mask', () => {
    expect(new URL(buildFileGetUrl('id1', { fields: 'id,name' })).searchParams.get('fields')).toBe('id,name')
  })

  test('download requests alt=media', () => {
    const u = new URL(buildFileDownloadUrl('id1'))
    expect(u.pathname).toBe('/drive/v3/files/id1')
    expect(u.searchParams.get('alt')).toBe('media')
    expect(u.searchParams.get('supportsAllDrives')).toBe('true')
  })

  test('export targets the export endpoint with the mime type', () => {
    const u = new URL(buildExportUrl('id1', 'application/pdf'))
    expect(u.pathname).toBe('/drive/v3/files/id1/export')
    expect(u.searchParams.get('mimeType')).toBe('application/pdf')
  })

  test('about asks for user + storageQuota', () => {
    expect(buildAboutUrl()).toBe('https://www.googleapis.com/drive/v3/about?fields=user,storageQuota')
  })
})

describe('isGoogleNativeMime', () => {
  test('true for vnd.google-apps.* types', () => {
    expect(isGoogleNativeMime('application/vnd.google-apps.document')).toBe(true)
    expect(isGoogleNativeMime('application/vnd.google-apps.spreadsheet')).toBe(true)
    expect(isGoogleNativeMime('application/vnd.google-apps.folder')).toBe(true)
  })

  test('false for binary/uploaded types and undefined', () => {
    expect(isGoogleNativeMime('application/pdf')).toBe(false)
    expect(isGoogleNativeMime('image/png')).toBe(false)
    expect(isGoogleNativeMime(undefined)).toBe(false)
  })
})

describe('resolveExportMime', () => {
  test('maps friendly aliases (case-insensitive, trimmed) to MIME types', () => {
    expect(resolveExportMime('pdf')).toBe('application/pdf')
    expect(resolveExportMime('XLSX')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(resolveExportMime('  csv ')).toBe('text/csv')
  })

  test('passes a full MIME type through unchanged', () => {
    expect(resolveExportMime('application/pdf')).toBe('application/pdf')
    expect(resolveExportMime('application/x-custom')).toBe('application/x-custom')
  })
})

describe('extensionForExportMime', () => {
  test('reverses known export MIME types to an extension', () => {
    expect(extensionForExportMime('application/pdf')).toBe('pdf')
    expect(extensionForExportMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx')
    expect(extensionForExportMime('text/csv')).toBe('csv')
  })

  test('falls back to bin for unknown types', () => {
    expect(extensionForExportMime('application/x-weird')).toBe('bin')
  })
})

describe('looksLikeDriveId', () => {
  test('true for long opaque id-shaped strings', () => {
    expect(looksLikeDriveId('1AbCdEfGhIjKlMnOpQrStUvWxYz0')).toBe(true)
    expect(looksLikeDriveId('0ABcdEfGhIjKl_Uk9PVA-xyz')).toBe(true)
  })

  test('false for names (spaces, dots) and short strings', () => {
    expect(looksLikeDriveId('Q3 Budget')).toBe(false)
    expect(looksLikeDriveId('report.pdf')).toBe(false)
    expect(looksLikeDriveId('short')).toBe(false)
  })
})

describe('matchFileByName', () => {
  const files: DriveFile[] = [
    { id: 'a1', name: 'Budget' },
    { id: 'b2', name: 'Budget 2024' },
    { id: 'c3', name: 'Roadmap' },
  ]

  test('exact name (case-insensitive) wins over substring', () => {
    const r = matchFileByName(files, 'budget')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.file.id).toBe('a1')
  })

  test('unique substring resolves', () => {
    const r = matchFileByName(files, 'road')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.file.id).toBe('c3')
  })

  test('multiple substring hits are ambiguous', () => {
    const r = matchFileByName(files, 'budget 2')
    expect(r.kind).toBe('ok') // only "Budget 2024" contains it
    const amb = matchFileByName(files, 'budg')
    expect(amb.kind).toBe('ambiguous')
    if (amb.kind === 'ambiguous') expect(amb.matches.length).toBe(2)
  })

  test('no match / empty query → not_found', () => {
    expect(matchFileByName(files, 'nope').kind).toBe('not_found')
    expect(matchFileByName(files, '   ').kind).toBe('not_found')
  })
})

describe('resolveFile', () => {
  const creds: GoogleOAuthCredentials = { clientId: 'c', clientSecret: 's', refreshToken: 'r' }
  const originalFetch = globalThis.fetch

  beforeEach(() => resetGoogleTokenCache())
  afterEach(() => {
    globalThis.fetch = originalFetch
    resetGoogleTokenCache()
  })

  const tokenRes = () => new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  test('id-shaped ref is fetched directly via files.get', async () => {
    const seen: string[] = []
    globalThis.fetch = (async (url: string) => {
      const s = String(url)
      if (s.startsWith('https://oauth2.googleapis.com/token')) return tokenRes()
      seen.push(s)
      return new Response(JSON.stringify({ id: '1AbCdEfGhIjKlMnOpQrStUvWxYz0', name: 'Found', mimeType: 'application/pdf' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const r = await resolveFile(creds, '1AbCdEfGhIjKlMnOpQrStUvWxYz0')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.file.name).toBe('Found')
    expect(seen.some((u) => u.includes('/files/1AbCdEfGhIjKlMnOpQrStUvWxYz0'))).toBe(true)
    expect(seen.some((u) => u.includes('/files?'))).toBe(false) // no list call
  })

  test('an id-shaped ref that 404s falls back to a name search', async () => {
    let listed = false
    globalThis.fetch = (async (url: string) => {
      const s = String(url)
      if (s.startsWith('https://oauth2.googleapis.com/token')) return tokenRes()
      if (s.includes('/files/') && !s.includes('/files?')) return new Response('not found', { status: 404 })
      listed = true
      return new Response(JSON.stringify({ files: [{ id: 'z9', name: 'aaaaaaaaaaaaaaaaaaaaaaaa' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    // 24 'a's: id-shaped, so it tries get → 404 → name search finds the one file.
    const r = await resolveFile(creds, 'aaaaaaaaaaaaaaaaaaaaaaaa')
    expect(listed).toBe(true)
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.file.id).toBe('z9')
  })

  test('a name ref goes straight to a scoped list and can be ambiguous', async () => {
    let queried = ''
    globalThis.fetch = (async (url: string) => {
      const s = String(url)
      if (s.startsWith('https://oauth2.googleapis.com/token')) return tokenRes()
      queried = new URL(s).searchParams.get('q') ?? ''
      return new Response(JSON.stringify({ files: [{ id: 'p1', name: 'Plan A' }, { id: 'p2', name: 'Plan B' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const r = await resolveFile(creds, 'Plan')
    expect(queried).toContain("name contains 'Plan'")
    expect(queried).toContain('trashed = false')
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.matches.length).toBe(2)
  })
})
