import type { ModuleManifest } from '../../core/types'
import { checkLinearStatus } from './client'
import { issuesGet, issuesList, issuesSearch } from './commands/issues'
import { projectsGet, projectsList } from './commands/projects'
import { cyclesList } from './commands/cycles'
import { teamsList } from './commands/teams'
import { myWorkList } from './commands/my-work'
import { summaryCmd } from './commands/summary'

export const manifest: ModuleManifest = {
  name: 'linear',
  description:
    'Read Linear — issues (list/get/search), projects with milestones, cycles, teams, your assigned work, and a planning summary',
  whenToUse:
    'Use when the user asks about work planning or issue state in Linear. "What am I working on?" / "what should I pick up next?" → `my-work list`, your assigned issues in actionable order (in-progress first, then triage/todo/backlog, higher priority first). "Where does the team stand?" → `summary`, one snapshot of your active issues, which of them are blocked, the active cycle with progress, and projects at risk. Look up a specific issue by identifier (`issues get UPT-123`), filter issues by team/state/assignee/project (`issues list`), or full-text search (`issues search`). Projects, cycles, and teams each have list commands; `projects get` includes milestones. This module owns Linear work planning and issue state. Read-only — it does not create, update, or comment on issues. Requires one-time setup: `home linear configure` with a personal API key.',
  configSchema: [
    {
      key: 'apiKey',
      label: 'Personal API key',
      kind: 'secret',
      required: true,
      help: 'linear.app → Settings → Security & access → Personal API keys. Sent verbatim in the Authorization header (personal keys take no Bearer prefix).',
    },
    {
      key: 'defaultTeam',
      label: 'Default team',
      kind: 'string',
      required: false,
      help: 'Team key (e.g. UPT) or exact name, used when --team is omitted.',
    },
  ],
  commands: [issuesList, issuesGet, issuesSearch, projectsList, projectsGet, cyclesList, teamsList, myWorkList, summaryCmd],
  async status(cfg) {
    return checkLinearStatus(cfg)
  },
}

export default manifest
