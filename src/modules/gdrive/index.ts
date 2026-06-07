import type { ModuleManifest } from '../../core/types'
import { getCachedAccessTokenExpiry } from '../../core/google-auth'
import { getAbout, readGdriveCredentials } from './client'
import { filesList } from './commands/files-list'
import { filesGet } from './commands/files-get'
import { filesDownload } from './commands/files-download'
import { filesExport } from './commands/files-export'
import { authLogin, authLogout } from './commands/auth'

export const manifest: ModuleManifest = {
  name: 'gdrive',
  description: 'Browse and fetch Google Drive files — list (Drive query language), get metadata, download binaries, export Google-native docs',
  whenToUse:
    'Use when the user wants to find, inspect, download, or export files in their Google Drive. `files list --q` accepts the full Drive query language (name/mimeType/parents/modifiedTime filters). Use `files download` for uploaded/binary files and `files export` for Google-native Docs/Sheets/Slides. Requires a one-time `home gdrive configure` (OAuth client) then `home gdrive auth login` (browser) — both interactive; you cannot drive them, so ask the user to run them.',
  configSchema: [
    {
      key: 'clientId',
      label: 'Google OAuth Client ID',
      kind: 'string',
      required: true,
      help: 'Create an OAuth 2.0 "Desktop app" client at https://console.cloud.google.com/apis/credentials (enable the Google Drive API first)',
    },
    {
      key: 'clientSecret',
      label: 'Google OAuth Client Secret',
      kind: 'secret',
      required: true,
      help: 'Same credential as the Client ID — the "Client secret" field on the OAuth client',
    },
  ],
  commands: [filesList, filesGet, filesDownload, filesExport, authLogin, authLogout],
  async status(cfg) {
    const creds = readGdriveCredentials(cfg)
    if (!creds.refreshToken) {
      return {
        ok: false,
        kind: 'config',
        message: 'gdrive is configured but not authorized — run `home gdrive auth login`',
        code: 'unauthorized',
      }
    }
    try {
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
