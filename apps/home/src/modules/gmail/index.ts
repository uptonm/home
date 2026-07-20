import type { ModuleManifest } from '../../core/types'
import { NotConfiguredError } from '../../core/errors'
import { getGrantedScopes } from '../../core/google-auth'
import { GMAIL_MODULE, GMAIL_SCOPES, getProfile, readGmailCredentials } from './client'
import { configureGmail } from './configure'
import { messagesGet, messagesList, messagesModify, messagesUntrash } from './commands/messages'
import { threadsGet, threadsList } from './commands/threads'
import { labelsCreate, labelsGet, labelsList } from './commands/labels'
import { draftsGet, draftsList } from './commands/drafts'
import { filtersCreate, filtersDelete, filtersList } from './commands/filters'
import { profileGet } from './commands/profile'

export const manifest: ModuleManifest = {
  name: GMAIL_MODULE,
  description: 'Read and triage Gmail — search/read plus bulk archive/label/mark-read/trash and routing rules',
  whenToUse:
    'Use to search, read, or triage Gmail. Read: find messages by query (from:, subject:, is:unread, newer_than:, has:attachment), read a message/thread, list labels/filters, inspect drafts. `messages list --q` with Gmail search syntax (add --hydrate for From/Subject/snippet) is the read workhorse. Write (all mutating commands are dry-run unless you pass --yes): `messages modify` bulk-archives/labels/marks-read/trashes everything matching a query or id list; `labels create` makes a label; `filters create|delete` manage routing rules for FUTURE mail (they do not touch the existing backlog — use `messages modify` for that). Delete is trash-only (recoverable ~30 days); there is no permanent-delete or send. Works on consumer @gmail.com and Workspace accounts. Requires one-time setup: `home google configure` then `home gmail configure` (browser consent). If `gmail status` reports insufficient_scope, an old read-only grant needs re-running `home gmail configure`.',
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
    messagesModify,
    messagesUntrash,
    threadsList,
    threadsGet,
    labelsList,
    labelsGet,
    labelsCreate,
    draftsList,
    draftsGet,
    filtersList,
    filtersCreate,
    filtersDelete,
    profileGet,
  ],
  async status() {
    try {
      const cfg = readGmailCredentials()
      const profile = await getProfile(cfg)
      const base = {
        emailAddress: profile.emailAddress ?? '?',
        messagesTotal: profile.messagesTotal,
        threadsTotal: profile.threadsTotal,
      }

      // A valid token that reads fine can still lack the write scopes — surface
      // that here rather than let every write fail later with a 403.
      const granted = await getGrantedScopes(cfg)
      if (granted === null) {
        return { ok: true, data: { status: 'authenticated', ...base, scopes: 'unknown' } }
      }
      const missing = GMAIL_SCOPES.filter((s) => !granted.includes(s))
      if (missing.length > 0) {
        return {
          ok: false,
          kind: 'config',
          code: 'insufficient_scope',
          message: `authenticated as ${base.emailAddress} but missing scope(s): ${missing.join(', ')} — run \`home gmail configure\` to re-grant`,
        }
      }
      return { ok: true, data: { status: 'authenticated', ...base, scopes: { granted, missing } } }
    } catch (err) {
      if (err instanceof NotConfiguredError) {
        return { ok: false, kind: 'config', code: 'not_configured', message: err.message }
      }
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
