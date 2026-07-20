import type { RunContext } from '../../../core/types'

export const DEFAULT_MAX_RESULTS = 25
// Gmail caps list endpoints at 500 results per page.
export const MAX_MAX_RESULTS = 500

export interface ParseResult<T> {
  value?: T
  error?: string
  warning?: string
}

/** Parse `--max <n>` into a 1..500 page size, defaulting when absent. */
export function parseMax(ctx: RunContext): ParseResult<number> {
  if (ctx.args.max === undefined) return { value: DEFAULT_MAX_RESULTS }
  const n = Number(ctx.args.max)
  if (!Number.isFinite(n) || n < 1) {
    return { error: 'max must be a positive number' }
  }
  const clamped = Math.min(Math.floor(n), MAX_MAX_RESULTS)
  if (clamped < n) {
    return { value: clamped, warning: `max capped at ${MAX_MAX_RESULTS} (Gmail API limit)` }
  }
  return { value: clamped }
}

/** Parse `--label a,b,c` into a label-id array (undefined when absent). */
export function parseLabels(ctx: RunContext): string[] | undefined {
  if (ctx.args.label === undefined) return undefined
  const ids = String(ctx.args.label)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return ids.length > 0 ? ids : undefined
}

/** Optional string arg, trimmed; undefined when absent or empty. */
export function optionalString(ctx: RunContext, name: string): string | undefined {
  if (ctx.args[name] === undefined) return undefined
  const s = String(ctx.args[name]).trim()
  return s.length > 0 ? s : undefined
}

/** Split a `--flag a,b,c` value into a trimmed, de-duplicated, non-empty list. */
export function parseCsv(value: string | number | boolean | undefined): string[] {
  if (value === undefined) return []
  const seen = new Set<string>()
  for (const s of String(value).split(',').map((x) => x.trim())) {
    if (s) seen.add(s)
  }
  return [...seen]
}

type Args = Record<string, string | number | boolean | undefined>

export type MessageSelection = { kind: 'query'; q: string } | { kind: 'ids'; ids: string[] }

export interface ModifyPlan {
  selection: MessageSelection
  addLabelIds: string[]
  removeLabelIds: string[]
  trash: boolean
  summary: string
}

/**
 * Turn the `messages modify` flags into a normalized plan, or an error string.
 * Pure so the selection/action rules are unit-testable without a mailbox. One
 * of `--q`/`--ids` selects; `--archive`/`--mark-read`/`--trash`/`--add`/`--remove`
 * act. Trash is exclusive — moving to Trash and relabeling in one call is
 * contradictory.
 */
export function planMessageModify(args: Args): ModifyPlan | { error: string } {
  const q = typeof args.q === 'string' ? args.q.trim() : ''
  const ids = parseCsv(args.ids)
  if (q && ids.length) return { error: 'specify either --q or --ids, not both' }
  if (!q && !ids.length) return { error: 'select messages with --q or --ids' }

  const trash = Boolean(args.trash)
  const archive = Boolean(args.archive)
  const markRead = Boolean(args['mark-read'])
  const add = parseCsv(args.add)
  const remove = parseCsv(args.remove)

  if (trash && (archive || markRead || add.length || remove.length)) {
    return { error: '--trash cannot be combined with other actions' }
  }
  if (!trash && !archive && !markRead && !add.length && !remove.length) {
    return { error: 'no action — use --archive, --mark-read, --trash, --add or --remove' }
  }

  const removeSet = new Set(remove)
  if (archive) removeSet.add('INBOX')
  if (markRead) removeSet.add('UNREAD')
  const removeLabelIds = [...removeSet]
  const addLabelIds = [...new Set(add)]

  const selection: MessageSelection = q ? { kind: 'query', q } : { kind: 'ids', ids }

  const parts: string[] = []
  if (trash) parts.push('move to Trash')
  else {
    if (archive) parts.push('archive (−INBOX)')
    if (markRead) parts.push('mark read (−UNREAD)')
    if (addLabelIds.length) parts.push(`+[${addLabelIds.join(', ')}]`)
    if (remove.length) parts.push(`−[${remove.join(', ')}]`)
  }

  return { selection, addLabelIds, removeLabelIds, trash, summary: parts.join(', ') }
}

export interface FilterSpec {
  criteria: {
    from?: string
    to?: string
    subject?: string
    query?: string
    hasAttachment?: boolean
  }
  action: {
    addLabelIds?: string[]
    removeLabelIds?: string[]
  }
  summary: string
}

/** Turn `filters create` flags into a criteria+action spec, or an error string. Pure. */
export function buildFilterSpec(args: Args): FilterSpec | { error: string } {
  const criteria: FilterSpec['criteria'] = {}
  const from = typeof args.from === 'string' ? args.from.trim() : ''
  const to = typeof args.to === 'string' ? args.to.trim() : ''
  const subject = typeof args.subject === 'string' ? args.subject.trim() : ''
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (from) criteria.from = from
  if (to) criteria.to = to
  if (subject) criteria.subject = subject
  if (query) criteria.query = query
  if (args['has-attachment']) criteria.hasAttachment = true
  if (Object.keys(criteria).length === 0) {
    return { error: 'no criterion — use --from, --to, --subject, --query or --has-attachment' }
  }

  const addLabelIds = parseCsv(args.add)
  const removeSet = new Set<string>()
  if (args.archive) removeSet.add('INBOX')
  if (args['mark-read']) removeSet.add('UNREAD')
  const removeLabelIds = [...removeSet]
  if (!addLabelIds.length && !removeLabelIds.length) {
    return { error: 'no action — use --add, --archive or --mark-read' }
  }

  const action: FilterSpec['action'] = {}
  if (addLabelIds.length) action.addLabelIds = addLabelIds
  if (removeLabelIds.length) action.removeLabelIds = removeLabelIds

  const parts: string[] = []
  if (addLabelIds.length) parts.push(`+[${addLabelIds.join(', ')}]`)
  if (removeSet.has('INBOX')) parts.push('archive')
  if (removeSet.has('UNREAD')) parts.push('mark read')

  return { criteria, action, summary: parts.join(', ') }
}

/** Validate an optional `--format` against an allow-list. */
export function parseFormat<T extends string>(
  ctx: RunContext,
  allowed: readonly T[],
): ParseResult<T | undefined> {
  if (ctx.args.format === undefined) return { value: undefined }
  const f = String(ctx.args.format).toLowerCase()
  if (!(allowed as readonly string[]).includes(f)) {
    return { error: `invalid --format: ${f} — allowed: ${allowed.join(', ')}` }
  }
  return { value: f as T }
}
