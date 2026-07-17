import type { CommandSpec } from '../../../core/types'
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  buildIssueFilter,
  isUuid,
  listMyIssues,
  orderMyWork,
  toIssueRow,
  type IssueFilterInput,
} from '../client'
import { getLinearConfig, optionalString, parseLimit, withWarnings } from './shared'

export const myWorkList: CommandSpec = {
  path: ['my-work', 'list'],
  effect: 'read',
  description:
    'List issues assigned to you in actionable order — in-progress first, then triage, todo, backlog; higher priority first within each.',
  args: [
    { name: 'state', kind: 'string', description: 'Workflow state name (case-insensitive) or state id — default excludes completed/canceled' },
    { name: 'limit', kind: 'number', description: `Max results (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT})` },
  ],
  examples: ['home linear my-work list --json', 'home linear my-work list --state "In Review" --json'],
  async run(ctx) {
    const limit = parseLimit(ctx)
    if (limit.error) return { ok: false, kind: 'user', message: limit.error, code: 'bad_arg' }
    if (limit.warning) ctx.log.warn(limit.warning)

    const cfg = getLinearConfig(ctx)
    const input: IssueFilterInput = {}
    const stateRef = optionalString(ctx, 'state')
    if (stateRef) {
      if (isUuid(stateRef)) input.stateId = stateRef.toLowerCase()
      else input.stateName = stateRef
    } else {
      input.stateTypes = { nin: ['completed', 'canceled'] }
    }
    const page = await listMyIssues(cfg, buildIssueFilter(input), limit.value!)
    return { ok: true, data: withWarnings({ issues: orderMyWork(page.nodes.map(toIssueRow)) }, page.warnings) }
  },
}
