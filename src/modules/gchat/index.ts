import type { ModuleManifest } from '../../core/types'
import { getCachedTokenExpiry, listSpaces, readGchatConfig } from './client'
import { spaceGet, spacesList } from './commands/spaces'
import { memberGet, membersList } from './commands/members'
import { messageGet, messagesList } from './commands/messages'

export const manifest: ModuleManifest = {
  name: 'gchat',
  description: 'List and read Google Chat spaces, members, and messages',
  whenToUse:
    'Use when the user wants to list Google Chat spaces, see who is in a space, or read messages from a space. ' +
    'REQUIRES a Google Workspace account — the Chat API rejects consumer @gmail.com accounts (everything 403s). ' +
    'This module is read-only (list/get); it does not send messages yet. Do not use for Gmail or Drive.',
  configSchema: [
    {
      key: 'clientId',
      label: 'Google OAuth Client ID',
      kind: 'string',
      required: true,
      help: 'Google Cloud → APIs & Services → Credentials → OAuth 2.0 Client (Desktop app). Enable the Google Chat API on the project. Workspace account only.',
    },
    {
      key: 'clientSecret',
      label: 'Google OAuth Client Secret',
      kind: 'secret',
      required: true,
      help: 'The "Client secret" of the same OAuth 2.0 client.',
    },
    {
      key: 'refreshToken',
      label: 'OAuth Refresh Token',
      kind: 'secret',
      required: true,
      help: 'Refresh token from a 3-legged consent granting the Chat read scopes (chat.spaces.readonly, chat.messages.readonly, chat.memberships.readonly). The shared core/google-auth loopback flow (pending — gdrive workstream) will mint this automatically; until then paste one from the OAuth 2.0 Playground.',
    },
  ],
  commands: [spacesList, spaceGet, membersList, memberGet, messagesList, messageGet],
  async status(cfg) {
    try {
      const gcfg = readGchatConfig(cfg)
      // Auth + reachability probe: smallest possible spaces.list.
      const page = await listSpaces(gcfg, { pageSize: 1 })
      const expiresAt = getCachedTokenExpiry()
      const tokenExpiresIn =
        expiresAt !== null ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : null
      return {
        ok: true,
        data: { status: 'authenticated', tokenExpiresIn, reachable: true, sampleSpaceCount: page.spaces.length },
      }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
