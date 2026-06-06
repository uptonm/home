import type { ArgSpec, RunContext } from '../../../core/types'
import type { ListParams } from '../client'

export const DEFAULT_PAGE_SIZE = 100
export const MAX_PAGE_SIZE = 1000

/** Shared `--page-size` / `--page-token` / `--filter` args for list commands. */
export const PAGING_ARGS: ArgSpec[] = [
  { name: 'pageSize', kind: 'number', description: `Results per page (1-${MAX_PAGE_SIZE}, default ${DEFAULT_PAGE_SIZE})` },
  { name: 'pageToken', kind: 'string', description: 'nextPageToken from a previous call, to fetch the next page' },
  { name: 'filter', kind: 'string', description: 'Chat API filter expression (e.g. spaceType = "SPACE")' },
]

export const ORDER_BY_ARG: ArgSpec = {
  name: 'orderBy',
  kind: 'string',
  description: 'Sort order, e.g. "createTime desc" (messages only)',
}

/**
 * Read the shared list args off a RunContext into a `ListParams`, validating
 * pageSize. `orderBy` is only read when `opts.orderBy` is set (messages.list is
 * the only endpoint that supports it).
 */
export function listParamsFromArgs(
  args: RunContext['args'],
  opts: { orderBy?: boolean } = {},
): { params: ListParams } | { error: string } {
  const params: ListParams = {}

  if (args.pageSize !== undefined) {
    const n = Number(args.pageSize)
    if (!Number.isFinite(n) || n < 1) {
      return { error: 'pageSize must be a positive number' }
    }
    params.pageSize = Math.min(Math.floor(n), MAX_PAGE_SIZE)
  } else {
    params.pageSize = DEFAULT_PAGE_SIZE
  }
  if (args.pageToken !== undefined) params.pageToken = String(args.pageToken)
  if (args.filter !== undefined) params.filter = String(args.filter)
  if (opts.orderBy && args.orderBy !== undefined) params.orderBy = String(args.orderBy)

  return { params }
}
