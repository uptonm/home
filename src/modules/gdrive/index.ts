import type { ModuleManifest } from '../../core/types'
import { getCachedAccessTokenExpiry } from '../../core/google-auth'
import { getAbout, readGdriveCredentials } from './client'
import { configureGdrive } from './configure'
import { filesList } from './commands/files-list'
import { filesGet } from './commands/files-get'
import { filesDownload } from './commands/files-download'
import { filesExport } from './commands/files-export'

export const manifest: ModuleManifest = {
  name: 'gdrive',
  description: 'Browse and fetch Google Drive files — list (Drive query language), get metadata, download binaries, export Google-native docs',
  whenToUse:
    'Use when the user wants to find, inspect, download, or export files in their Google Drive. `files list --q` accepts the full Drive query language (name/mimeType/parents/modifiedTime filters). Use `files download` for uploaded/binary files and `files export` for Google-native Docs/Sheets/Slides. Requires a one-time `home google configure` (shared OAuth client, see docs/google-setup.md) then `home gdrive configure` (browser consent) — both interactive; you cannot drive them, so ask the user to run them.',
  configSchema: [
    {
      // Written by `home gdrive configure`, not typed — declared here (like
      // gmail's) so `secrets export` and vercel sync can see it. An undeclared
      // secret is invisible to every schema-driven inventory.
      key: 'refreshToken',
      label: 'OAuth refresh token',
      kind: 'secret',
      required: false,
      help: 'Written by `home gdrive configure` (browser consent) — not typed by hand.',
    },
  ],
  requiresConfig: false,
  configure: configureGdrive,
  commands: [filesList, filesGet, filesDownload, filesExport],
  async status() {
    try {
      const creds = readGdriveCredentials()
      const about = await getAbout(creds)
      const expiresAt = getCachedAccessTokenExpiry(creds)
      const tokenExpiresIn = expiresAt !== null ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : null
      const quota = about.storageQuota
      return {
        ok: true,
        data: {
          status: 'authenticated',
          user: about.user?.emailAddress ?? null,
          storageUsage: quota?.usage ?? null,
          storageLimit: quota?.limit ?? null,
          tokenExpiresIn,
        },
      }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
