import type { ModuleManifest } from '../../core/types'
import { checkLinearStatus } from './client'
import { issuesGet, issuesList, issuesSearch } from './commands/issues'
import { issuesComment, issuesCreate, issuesUpdate, projectsUpdate } from './commands/mutations'
import { projectsGet, projectsList } from './commands/projects'
import { cyclesList } from './commands/cycles'
import { teamsList } from './commands/teams'
import { myWorkList } from './commands/my-work'
import { summaryCmd } from './commands/summary'

export const manifest: ModuleManifest = {
  name: 'linear',
  description:
    'Linear — read issues (list/get/search), projects with milestones, cycles, teams, your assigned work, a planning summary; guarded writes (issue create/update/comment, project update) that require --yes',
  whenToUse:
    'Use when the user asks about work planning or issue state in Linear. "What am I working on?" / "what should I pick up next?" → `my-work list`, your assigned issues in actionable order (in-progress first, then triage/todo/backlog, higher priority first). "Where does the team stand?" → `summary`, one snapshot of your active issues, which of them are blocked, the active cycle with progress, and projects at risk. Look up a specific issue by identifier (`issues get UPT-123`), filter issues by team/state/assignee/project (`issues list`), or full-text search (`issues search`). Projects, cycles, and teams each have list commands; `projects get` includes milestones. This module owns Linear work planning and issue state. It can also create and update issues WITH confirmation: every mutation requires an explicit `--yes` (`issues create --title … --team UPT --yes`, `issues update UPT-123 --state Done --yes`, `issues comment UPT-123 --body-stdin --yes`, `projects update`) and refuses ambiguous team/state/assignee/project names; body/description text arrives via stdin, and there are no delete or archive commands. Requires one-time setup: `home linear configure` with a personal API key.',
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
  commands: [
    issuesList,
    issuesGet,
    issuesSearch,
    issuesCreate,
    issuesUpdate,
    issuesComment,
    projectsList,
    projectsGet,
    projectsUpdate,
    cyclesList,
    teamsList,
    myWorkList,
    summaryCmd,
  ],
  async status(cfg) {
    return checkLinearStatus(cfg)
  },
}

export default manifest
