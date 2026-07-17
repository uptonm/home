import type { CommandSpec } from '../../../core/types'
import {
  findDomainOwner,
  getDomainConfig,
  getProjectDomain,
  listProjectDomains,
  listTeamDomains,
  readVercelConfig,
} from '../client'
import { optionalFlag, parseLimit, requiredPositional } from './shared'

export const domainsListCmd: CommandSpec = {
  path: ['domains', 'list'],
  effect: 'read',
  description:
    'List domains and verification state — the team\'s registered domains, or one project\'s domains with --project',
  args: [
    { name: 'project', kind: 'string', description: 'List domains attached to this project (id or name) instead' },
    { name: 'limit', kind: 'number', description: 'Max domains returned (default 50, cap 100)' },
  ],
  examples: [
    'home vercel domains list --json',
    'home vercel domains list --project uptonm-dev --json',
  ],
  async run(ctx) {
    const limit = parseLimit(ctx, 50, 100)
    if (limit.error) return { ok: false, kind: 'user', message: limit.error, code: 'bad_arg' }
    const cfg = readVercelConfig(ctx.config)
    const project = optionalFlag(ctx, 'project')
    const data = project ? await listProjectDomains(cfg, project, limit.value) : await listTeamDomains(cfg, limit.value)
    return { ok: true, data }
  },
}

export const domainsGetCmd: CommandSpec = {
  path: ['domains', 'get'],
  effect: 'read',
  description: 'Get one domain: DNS configuration, owning project, and its project-level attachment',
  args: [
    { name: 'name', kind: 'positional', description: 'Domain name (e.g. example.com)', required: true },
  ],
  examples: [
    'home vercel domains get uptonm.dev --json',
  ],
  async run(ctx) {
    const name = requiredPositional(ctx, 'name')
    if (!name) return { ok: false, kind: 'user', message: 'domain name is required', code: 'missing_arg' }
    const cfg = readVercelConfig(ctx.config)
    const config = await getDomainConfig(cfg, name)
    const owner = await findDomainOwner(cfg, name)
    const attachment = owner ? await getProjectDomain(cfg, owner.projectId, name) : null
    return { ok: true, data: { name, config, project: owner, attachment } }
  },
}
