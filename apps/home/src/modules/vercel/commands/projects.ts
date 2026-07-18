import type { CommandSpec } from '../../../core/types'
import { getProject, listProjects, readVercelConfig } from '../client'
import { parseLimit, requiredPositional } from './shared'

export const projectsListCmd: CommandSpec = {
  path: ['projects', 'list'],
  effect: 'read',
  description: 'List the team\'s projects (id, name, framework, linked repo, updatedAt)',
  args: [
    { name: 'limit', kind: 'number', description: 'Max projects returned (default 50, cap 100)' },
  ],
  examples: [
    'home vercel projects list --json',
    'home vercel projects list --limit 10 --json',
  ],
  async run(ctx) {
    const limit = parseLimit(ctx, 50, 100)
    if (limit.error) return { ok: false, kind: 'user', message: limit.error, code: 'bad_arg' }
    const cfg = readVercelConfig(ctx.config)
    const data = await listProjects(cfg, limit.value)
    return { ok: true, data }
  },
}

export const projectsGetCmd: CommandSpec = {
  path: ['projects', 'get'],
  effect: 'read',
  description: 'Get one project: framework, linked repo, production/preview targets, domains',
  args: [
    { name: 'project', kind: 'positional', description: 'Project id (prj_…) or name', required: true },
  ],
  examples: [
    'home vercel projects get uptonm-dev --json',
    'home vercel projects get prj_39ukbKw9ynwxvpUyPfIisarROKAS --json',
  ],
  async run(ctx) {
    const project = requiredPositional(ctx, 'project')
    if (!project) return { ok: false, kind: 'user', message: 'project id or name is required', code: 'missing_arg' }
    const cfg = readVercelConfig(ctx.config)
    const data = await getProject(cfg, project)
    return { ok: true, data }
  },
}
