/**
 * Resolve a Protect entity from a bootstrap collection by id or name. Pure +
 * synchronous so it can be unit-tested without touching the controller, and
 * shared by every `get` command. Resolution order:
 *   1. exact id
 *   2. exact name (case-insensitive)
 *   3. unique name substring (case-insensitive)
 * A substring that matches more than one entity is reported as ambiguous so the
 * caller can list the candidates instead of silently picking one.
 */
export type ResolveResult<T> =
  | { kind: 'ok'; item: T }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; matches: T[] }

export function resolve<T extends { id?: string; name?: string }>(coll: T[], ref: string): ResolveResult<T> {
  const q = ref.trim()
  if (!q) return { kind: 'not_found' }
  const ql = q.toLowerCase()

  const byId = coll.find((item) => item.id === q)
  if (byId) return { kind: 'ok', item: byId }

  const byName = coll.filter((item) => (item.name ?? '').toLowerCase() === ql)
  if (byName.length === 1) return { kind: 'ok', item: byName[0]! }
  if (byName.length > 1) return { kind: 'ambiguous', matches: byName }

  const bySub = coll.filter((item) => (item.name ?? '').toLowerCase().includes(ql))
  if (bySub.length === 1) return { kind: 'ok', item: bySub[0]! }
  if (bySub.length > 1) return { kind: 'ambiguous', matches: bySub }

  return { kind: 'not_found' }
}
