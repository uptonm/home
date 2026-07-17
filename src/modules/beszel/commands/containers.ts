import type { CommandSpec, RunContext, RunResult } from '../../../core/types'
import { createTransport, pbQuote, readBeszelConfig, type BeszelTransport } from '../client'
import { normalizeContainer, type BeszelContainer } from '../adapter'
import { resolveExact } from '../resolve'
import { fetchSystems, parseLimit, pickSystem, requiredPositional } from './shared'

const CONTAINERS_DEFAULT = 200
const CONTAINERS_MAX = 500

async function fetchContainers(t: BeszelTransport, systemId: string, limit: number): Promise<BeszelContainer[]> {
  const raw = await t.list('containers', limit, { filter: `system=${pbQuote(systemId)}`, sort: 'name' })
  return raw.map(normalizeContainer)
}

async function resolveSystemArg(
  ctx: RunContext,
  t: BeszelTransport,
): Promise<{ ok: true; system: { id: string; name: string } } | { ok: false; error: RunResult }> {
  const ref = requiredPositional(ctx, 'system')
  if (!ref) {
    return { ok: false, error: { ok: false, kind: 'user', message: 'system id or name is required', code: 'missing_arg' } }
  }
  return pickSystem(await fetchSystems(t), ref)
}

export const containersListCmd: CommandSpec = {
  path: ['containers', 'list'],
  effect: 'read',
  description: 'List a system\'s containers: status, health, cpu %, memory MB, network bytes/s',
  args: [
    { name: 'system', kind: 'positional', description: 'System id or exact name', required: true },
    { name: 'limit', kind: 'number', description: `Max containers returned (default ${CONTAINERS_DEFAULT}, cap ${CONTAINERS_MAX})` },
  ],
  examples: ['home beszel containers list boris --json'],
  async run(ctx) {
    const limit = parseLimit(ctx, CONTAINERS_DEFAULT, CONTAINERS_MAX)
    if (limit.error) return { ok: false, kind: 'user', message: limit.error, code: 'bad_arg' }
    const t = createTransport(readBeszelConfig(ctx.config))
    const picked = await resolveSystemArg(ctx, t)
    if (!picked.ok) return picked.error
    const containers = await fetchContainers(t, picked.system.id, limit.value)
    return { ok: true, data: { system: { id: picked.system.id, name: picked.system.name }, containers } }
  },
}

export const containersGetCmd: CommandSpec = {
  path: ['containers', 'get'],
  effect: 'read',
  description: 'One container on a system, by container id or exact name',
  args: [
    { name: 'system', kind: 'positional', description: 'System id or exact name', required: true },
    { name: 'container', kind: 'positional', description: 'Container id or exact name', required: true },
  ],
  examples: ['home beszel containers get boris caddy --json'],
  async run(ctx) {
    const containerRef = requiredPositional(ctx, 'container')
    if (!containerRef) {
      return { ok: false, kind: 'user', message: 'container id or name is required', code: 'missing_arg' }
    }
    const t = createTransport(readBeszelConfig(ctx.config))
    const picked = await resolveSystemArg(ctx, t)
    if (!picked.ok) return picked.error
    const containers = await fetchContainers(t, picked.system.id, CONTAINERS_MAX)
    const result = resolveExact(containers, containerRef)
    if (result.kind === 'not_found') {
      return {
        ok: false,
        kind: 'user',
        message: `no container matching ${JSON.stringify(containerRef)} on ${picked.system.name} (exact id or exact name)`,
        code: 'not_found',
      }
    }
    if (result.kind === 'ambiguous') {
      const candidates = result.matches.map((m) => `${m.name} (${m.id})`).join(', ')
      return {
        ok: false,
        kind: 'user',
        message: `${result.matches.length} containers match ${JSON.stringify(containerRef)}: ${candidates} — use the id`,
        code: 'ambiguous',
      }
    }
    return { ok: true, data: result.item }
  },
}
