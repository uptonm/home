import type { ArgSpec, RunContext } from '../../../core/types'

export const branchArg: ArgSpec = {
  name: 'branch',
  kind: 'positional',
  required: false,
  description: 'Branch name (default: the currently checked-out branch)',
}

export function optionalString(ctx: RunContext, key: string): string | undefined {
  const value = ctx.args[key]
  if (value === undefined || value === '') return undefined
  return String(value)
}
