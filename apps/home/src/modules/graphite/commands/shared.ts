import type { ArgSpec, RunContext, RunResult } from '../../../core/types'

export const branchArg: ArgSpec = {
  name: 'branch',
  kind: 'positional',
  required: false,
  description: 'Branch name (default: the currently checked-out branch)',
}

export const yesArg: ArgSpec = {
  name: 'yes',
  kind: 'boolean',
  description: 'Confirm the mutation — every graphite write command refuses to run without it',
}

export function optionalString(ctx: RunContext, key: string): string | undefined {
  const value = ctx.args[key]
  if (value === undefined || value === '') return undefined
  return String(value)
}

export function confirmationRequired(action: string): RunResult {
  return {
    ok: false,
    kind: 'user',
    message: `refusing to ${action} without confirmation — re-run with --yes`,
    code: 'confirmation_required',
  }
}
