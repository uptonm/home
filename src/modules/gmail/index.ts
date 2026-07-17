import type { ModuleManifest } from '../../core/types'
import { NotConfiguredError } from '../../core/errors'
import { GMAIL_MODULE, getProfile, readGmailCredentials } from './client'
import { configureGmail } from './configure'
import { messagesGet, messagesList } from './commands/messages'
import { threadsGet, threadsList } from './commands/threads'
import { labelsGet, labelsList } from './commands/labels'
import { draftsGet, draftsList } from './commands/drafts'
import { profileGet } from './commands/profile'

export const manifest: ModuleManifest = {
  name: GMAIL_MODULE,
  description: 'Read Gmail — search messages, threads, labels, and drafts (list/get)',
  whenToUse:
    'Use when the user wants to search or read their Gmail: find messages by query (from:, subject:, is:unread, newer_than:, has:attachment), read a specific message or thread, list labels, or inspect drafts. The killer feature is `messages list --q` with Gmail search syntax (add --hydrate to get From/Subject/snippet in one call). Works on consumer @gmail.com and Workspace accounts. Read-only — it does not send, delete, or modify mail. Requires one-time setup: `home google configure` (shared OAuth client, see docs/google-setup.md) then `home gmail configure` (browser consent).',
  configSchema: [
    {
      // Declared, though only `configure` writes it: an undeclared secret is
      // invisible to `secrets export` and the vercel sync.
      key: 'refreshToken',
      label: 'OAuth refresh token',
      kind: 'secret',
      required: false,
      help: 'Written by `home gmail configure` (browser consent) — not typed by hand.',
    },
  ],
  requiresConfig: false,
  configure: configureGmail,
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
  ],
  async status() {
    try {
      const profile = await getProfile(readGmailCredentials())
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
      if (err instanceof NotConfiguredError) {
        return { ok: false, kind: 'config', code: 'not_configured', message: err.message }
      }
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
