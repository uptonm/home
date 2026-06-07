import type { ModuleManifest } from '../../core/types'
import { GMAIL_MODULE, getProfile, readGmailConfig } from './client'
import { messagesGet, messagesList } from './commands/messages'
import { threadsGet, threadsList } from './commands/threads'
import { labelsGet, labelsList } from './commands/labels'
import { draftsGet, draftsList } from './commands/drafts'
import { profileGet } from './commands/profile'
import { authLogin } from './commands/auth'

export const manifest: ModuleManifest = {
  name: GMAIL_MODULE,
  description: 'Read Gmail — search messages, threads, labels, and drafts (list/get)',
  whenToUse:
    'Use when the user wants to search or read their Gmail: find messages by query (from:, subject:, is:unread, newer_than:, has:attachment), read a specific message or thread, list labels, or inspect drafts. The killer feature is `messages list --q` with Gmail search syntax (add --hydrate to get From/Subject/snippet in one call). Works on consumer @gmail.com and Workspace accounts. Read-only — it does not send, delete, or modify mail. Requires one-time setup: `home gmail configure` then `home gmail auth login`.',
  configSchema: [
    {
      key: 'clientId',
      label: 'Google OAuth Client ID',
      kind: 'string',
      required: true,
      help: 'Google Cloud Console → APIs & Services → Credentials → OAuth client ID (type "Desktop app"). Enable the Gmail API first.',
    },
    {
      key: 'clientSecret',
      label: 'Google OAuth Client Secret',
      kind: 'secret',
      required: true,
      help: 'The "Client secret" shown next to the Desktop-app OAuth client',
    },
    {
      key: 'refreshToken',
      label: 'OAuth refresh token',
      kind: 'secret',
      required: false,
      help: 'Leave blank — populated automatically by `home gmail auth login` (browser consent).',
    },
  ],
  commands: [
    messagesList,
    messagesGet,
    threadsList,
    threadsGet,
    labelsList,
    labelsGet,
    draftsList,
    draftsGet,
    profileGet,
    authLogin,
  ],
  async status(cfg) {
    try {
      const profile = await getProfile(readGmailConfig(cfg))
      return {
        ok: true,
        data: {
          status: 'authenticated',
          emailAddress: profile.emailAddress ?? '?',
          messagesTotal: profile.messagesTotal,
          threadsTotal: profile.threadsTotal,
        },
      }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
