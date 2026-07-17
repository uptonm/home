import { UserError } from '../../../core/errors'
import type { ArgSpec, RunContext } from '../../../core/types'
import { DEFAULT_LIMIT, MAX_LIMIT } from '../client'

export const repoArg: ArgSpec = {
  name: 'repo',
  kind: 'string',
  description: 'Repository as owner/name (default: configured defaultRepo, else inferred from the cwd checkout)',
}

export const limitArg: ArgSpec = {
  name: 'limit',
  kind: 'number',
  description: `Max results (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT})`,
}

export function optionalString(ctx: RunContext, key: string): string | undefined {
  const value = ctx.args[key]
  if (value === undefined || value === '') return undefined
  return String(value)
}

export function parseLimit(ctx: RunContext): number {
  const raw = ctx.args.limit
  if (raw === undefined || raw === '') return DEFAULT_LIMIT
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new UserError(`--limit must be an integer between 1 and ${MAX_LIMIT}`, 'bad_arg')
  }
  return n
}

export function requiredRef(ctx: RunContext, name: string): string {
  const value = String(ctx.args[name] ?? '').trim()
  if (!value) throw new UserError(`${name} is required`, 'missing_arg')
  return value
}
