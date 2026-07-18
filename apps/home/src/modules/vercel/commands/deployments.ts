import type { CommandSpec } from '../../../core/types'
import {
  DEPLOYMENT_STATES,
  getDeployment,
  listDeploymentEvents,
  listDeployments,
  readVercelConfig,
} from '../client'
import { optionalFlag, parseLimit, requiredPositional } from './shared'

export const deploymentsListCmd: CommandSpec = {
  path: ['deployments', 'list'],
  effect: 'read',
  description:
    'List recent deployments (id, url, state, environment, commit, creator, createdAt), newest first',
  args: [
    { name: 'project', kind: 'string', description: 'Filter to one project by id (prj_…) or name' },
    { name: 'environment', kind: 'string', description: 'Filter by target: production, preview, or a custom environment' },
    {
      name: 'state',
      kind: 'string',
      description: `Filter by normalized state: ${DEPLOYMENT_STATES.join(' | ')}`,
      enum: DEPLOYMENT_STATES,
    },
    { name: 'limit', kind: 'number', description: 'Max deployments returned (default 20, cap 100)' },
  ],
  examples: [
    'home vercel deployments list --json',
    'home vercel deployments list --project uptonm-dev --environment production --json',
    'home vercel deployments list --state error --limit 5 --json',
  ],
  async run(ctx) {
    const limit = parseLimit(ctx, 20, 100)
    if (limit.error) return { ok: false, kind: 'user', message: limit.error, code: 'bad_arg' }
    const cfg = readVercelConfig(ctx.config)
    const data = await listDeployments(cfg, {
      project: optionalFlag(ctx, 'project'),
      target: optionalFlag(ctx, 'environment'),
      state: optionalFlag(ctx, 'state'),
      limit: limit.value,
    })
    return { ok: true, data }
  },
}

export const deploymentsGetCmd: CommandSpec = {
  path: ['deployments', 'get'],
  effect: 'read',
  description: 'Get one deployment: state, commit, aliases, timing (created/building/ready), creator',
  args: [
    { name: 'deployment', kind: 'positional', description: 'Deployment id (dpl_…) or URL', required: true },
  ],
  examples: [
    'home vercel deployments get dpl_C6aWACLBVrErTMV7gC94YRcUzM7x --json',
    'home vercel deployments get my-app-abc123.vercel.app --json',
  ],
  async run(ctx) {
    const deployment = requiredPositional(ctx, 'deployment')
    if (!deployment) return { ok: false, kind: 'user', message: 'deployment id or URL is required', code: 'missing_arg' }
    const cfg = readVercelConfig(ctx.config)
    const data = await getDeployment(cfg, deployment)
    return { ok: true, data }
  },
}

export const deploymentsEventsCmd: CommandSpec = {
  path: ['deployments', 'events'],
  effect: 'read',
  description: 'List a deployment\'s build/deployment events (bounded; mostly build log lines)',
  args: [
    { name: 'deployment', kind: 'positional', description: 'Deployment id (dpl_…) or URL', required: true },
    { name: 'limit', kind: 'number', description: 'Max events returned (default 50, cap 200)' },
  ],
  examples: [
    'home vercel deployments events dpl_C6aWACLBVrErTMV7gC94YRcUzM7x --json',
    'home vercel deployments events my-app-abc123.vercel.app --limit 100 --json',
  ],
  async run(ctx) {
    const deployment = requiredPositional(ctx, 'deployment')
    if (!deployment) return { ok: false, kind: 'user', message: 'deployment id or URL is required', code: 'missing_arg' }
    const limit = parseLimit(ctx, 50, 200)
    if (limit.error) return { ok: false, kind: 'user', message: limit.error, code: 'bad_arg' }
    const cfg = readVercelConfig(ctx.config)
    const data = await listDeploymentEvents(cfg, deployment, limit.value)
    return { ok: true, data }
  },
}
