/**
 * Resolve an entity by exact id, then exact case-insensitive name. No
 * substring matching: a monitoring CLI must never act on a guessed host.
 * Ambiguity reports the candidates instead of picking one.
 */
export type ResolveResult<T> =
  | { kind: 'ok'; item: T }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; matches: T[] }

export function resolveExact<T extends { id: string; name: string }>(coll: T[], ref: string): ResolveResult<T> {
  const q = ref.trim()
  if (!q) return { kind: 'not_found' }

  const byId = coll.find((item) => item.id === q)
  if (byId) return { kind: 'ok', item: byId }

  const ql = q.toLowerCase()
  const byName = coll.filter((item) => item.name.toLowerCase() === ql)
  if (byName.length === 1) return { kind: 'ok', item: byName[0]! }
  if (byName.length > 1) return { kind: 'ambiguous', matches: byName }

  return { kind: 'not_found' }
}
