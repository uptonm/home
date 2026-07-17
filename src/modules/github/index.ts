import { HomeError } from '../../core/errors'
import type { ModuleManifest } from '../../core/types'
import { checkAuth, readGithubConfig } from './client'
import { issuesGet, issuesList } from './commands/issues'
import { notificationsList } from './commands/notifications'
import { prsChecks, prsDiff, prsGet, prsList } from './commands/prs'
import { releasesList } from './commands/releases'
import { reposGet } from './commands/repos'
import { runsGet, runsList } from './commands/runs'
import { searchCode } from './commands/search'
import { summary } from './commands/summary'

export const manifest: ModuleManifest = {
  name: 'github',
  description:
    'Read GitHub remote state via the gh CLI — repos, pull requests (reviews, checks, diffs), Actions runs, issues, notifications, releases, code search, and a one-shot summary briefing',
  whenToUse:
    'Use for what the GitHub *remote* knows: repository metadata, pull requests (detail, reviews, mergeability, CI check summaries, diffs), Actions workflow runs, issues, unread notifications, releases, and code search — all read-only, authenticated through the `gh` CLI (`gh auth login`). Start a work session with `summary`: one briefing of my open PRs with failing-check rollups, PRs awaiting my review, and recent failed runs, each item carrying the pr number / run id / repo the follow-up command needs; use `notifications list` for the inbox (filter by --reason, e.g. review_requested). When `--repo` is omitted it falls back to the configured defaultRepo, then to the git remotes of the current directory (except `search code`, which is global by default). This module owns remote repo state — PRs, reviews, checks, runs, issues, releases; local stacked-branch topology (creating, restacking, navigating stacks) is the graphite module\'s job, not this one\'s. Do not use to mutate anything — it never writes.',
  configSchema: [
    {
      key: 'host',
      label: 'GitHub host',
      kind: 'string',
      required: true,
      default: 'github.com',
      help: 'GitHub Enterprise hostname if not github.com',
    },
    {
      key: 'binaryPath',
      label: 'gh binary path',
      kind: 'string',
      required: true,
      default: 'gh',
      help: 'Path to the GitHub CLI binary (bare `gh` resolves via PATH)',
      hostLocal: true,
    },
    {
      key: 'defaultRepo',
      label: 'Default repository (owner/name)',
      kind: 'string',
      help: 'Used when --repo is omitted and the cwd is not the checkout you mean; leave empty to rely on the cwd',
      validate: (v) =>
        v === '' || /^[\w.-]+\/[\w.-]+$/.test(v) ? null : 'must be owner/name',
    },
  ],
  commands: [
    summary,
    reposGet,
    prsList,
    prsGet,
    prsChecks,
    prsDiff,
    runsList,
    runsGet,
    issuesList,
    issuesGet,
    notificationsList,
    releasesList,
    searchCode,
  ],
  async status(cfg) {
    try {
      const gc = readGithubConfig(cfg)
      const auth = await checkAuth(gc)
      if (!auth.authenticated) {
        return {
          ok: false,
          kind: 'config',
          message: `gh has no authenticated account for ${gc.host} — run \`gh auth login --hostname ${gc.host}\``,
          code: 'github_auth',
        }
      }
      return { ok: true, data: { host: gc.host, account: auth.login, auth: 'ok' } }
    } catch (err) {
      if (err instanceof HomeError) {
        return { ok: false, kind: 'system', message: err.message, code: err.code }
      }
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
